import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { ResultAsync } from "neverthrow";
import { match, P } from "ts-pattern";
import {
  execErrorMessage,
  missingBinaryReason,
  notify,
  resolveToCwd,
  runCommand,
  summarizeOutput,
  targetPath,
  type ToolResultPatch,
} from "./lib/command-runner.js";
import { isClojurePath } from "./lib/clojure.js";

const CLJ_KONDO_COMMAND = "clj-kondo";
/** @internal exported for focused tests. */
export const CLJ_KONDO_LINT_ARGS = ["--lint"] as const;
const CLJ_KONDO_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 4_000;

/** @internal exported for focused tests. */
export type PendingCljKondoFile = {
  absolutePath: string;
  displayPath: string;
};

/** @internal exported for focused tests. */
export type PendingCljKondoFiles = Map<string, PendingCljKondoFile>;

function editOrWritePath(event: ToolResultEvent): string | undefined {
  return match({ event, path: targetPath(event.input) })
    .with({ event: P.when(isEditToolResult), path: P.string }, ({ path }) => path)
    .with({ event: P.when(isWriteToolResult), path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function isSuccessfulClojureMutation(
  event: ToolResultEvent,
  path: string | undefined,
): path is string {
  return !event.isError && typeof path === "string" && isClojurePath(path);
}

function missingBinaryMessage(): string {
  return [
    `${CLJ_KONDO_COMMAND} is not installed or is not on PATH.`,
    "Agent action: install clj-kondo (for example `brew install borkdude/brew/clj-kondo`, `clojure -Ttools install-latest :lib clj-kondo/clj-kondo :as clj-kondo`, or the platform package from https://github.com/clj-kondo/clj-kondo/releases) or ensure the running pi/agent process PATH can find it, then retry the Clojure file edit.",
  ].join("\n");
}

function cljKondoFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .with({ code: 127 }, () => missingBinaryMessage())
    .otherwise(({ stderr, stdout, code }) =>
      summarizeOutput(CLJ_KONDO_COMMAND, stderr || stdout || `exit code ${code}`, OUTPUT_LIMIT),
    );
}

function turnEndFailureMessage(paths: PendingCljKondoFile[], reason: string): string {
  const files = paths.map(({ displayPath }) => `- ${displayPath}`).join("\n");
  return [
    `${CLJ_KONDO_COMMAND} ${CLJ_KONDO_LINT_ARGS.join(" ")} failed after the last turn for ${paths.length} changed Clojure file(s):`,
    files,
    "",
    reason,
    "",
    "Please fix these diagnostics before continuing.",
  ].join("\n");
}

function turnEndSuccessMessage(paths: PendingCljKondoFile[]): string {
  return `Ran ${CLJ_KONDO_COMMAND} ${CLJ_KONDO_LINT_ARGS.join(" ")} on ${paths.length} changed Clojure file(s)`;
}

function recordPendingFile(
  pendingFiles: PendingCljKondoFiles,
  ctx: ExtensionContext,
  path: string,
): void {
  const absolutePath = resolveToCwd(path, ctx.cwd);
  pendingFiles.set(absolutePath, { absolutePath, displayPath: path });
}

async function runCljKondo(
  pi: ExtensionAPI,
  absolutePaths: string[],
  ctx: ExtensionContext,
): Promise<ExecResult> {
  return runCommand(pi, ctx, {
    command: CLJ_KONDO_COMMAND,
    args: [...CLJ_KONDO_LINT_ARGS, ...absolutePaths],
    timeoutMs: CLJ_KONDO_TIMEOUT_MS,
  });
}

function absolutePaths(paths: PendingCljKondoFile[]): string[] {
  return paths.map(({ absolutePath }) => absolutePath);
}

function sendFailureMessage(
  pi: ExtensionAPI,
  paths: PendingCljKondoFile[],
  reason: string,
  result?: ExecResult,
): void {
  pi.sendMessage(
    {
      customType: "clj-kondo-turn-end",
      content: turnEndFailureMessage(paths, reason),
      display: true,
      details: match(result)
        .with(P.nonNullable, ({ code, killed }) => ({ paths, code, killed }))
        .otherwise(() => ({ paths })),
    },
    { deliverAs: "steer", triggerTurn: true },
  );
}

/** @internal exported for focused tests. */
export function createToolResultHandler(
  pendingFiles: PendingCljKondoFiles,
): ExtensionHandler<ToolResultEvent, ToolResultPatch> {
  return (event, ctx) =>
    match({ event, path: editOrWritePath(event) })
      .with({ path: P.when((path) => isSuccessfulClojureMutation(event, path)) }, ({ path }) => {
        recordPendingFile(pendingFiles, ctx, path);
      })
      .otherwise(() => undefined);
}

function notifyTurnEndFailure(ctx: ExtensionContext): void {
  notify(
    ctx,
    `${CLJ_KONDO_COMMAND} failed after turn; diagnostics were sent to the agent.`,
    "warning",
  );
}

function handleCljKondoError(
  pi: ExtensionAPI,
  paths: PendingCljKondoFile[],
  ctx: ExtensionContext,
  error: string,
): void {
  match(ctx.signal?.aborted)
    .with(true, () => undefined)
    .otherwise(() => {
      sendFailureMessage(
        pi,
        paths,
        missingBinaryReason(CLJ_KONDO_COMMAND, error, missingBinaryMessage()),
      );
      notifyTurnEndFailure(ctx);
    });
}

function handleCljKondoResult(
  pi: ExtensionAPI,
  paths: PendingCljKondoFile[],
  ctx: ExtensionContext,
  result: ExecResult,
): void {
  match({ aborted: ctx.signal?.aborted, result })
    .with({ aborted: true }, () => undefined)
    .with({ result: { code: 0, killed: false } }, () => {
      notify(ctx, turnEndSuccessMessage(paths), "info");
    })
    .otherwise(({ result }) => {
      sendFailureMessage(pi, paths, cljKondoFailureReason(result), result);
      notifyTurnEndFailure(ctx);
    });
}

async function runPendingCljKondo(
  pi: ExtensionAPI,
  paths: PendingCljKondoFile[],
  ctx: ExtensionContext,
): Promise<void> {
  return ResultAsync.fromPromise(
    runCljKondo(pi, absolutePaths(paths), ctx),
    execErrorMessage,
  ).match(
    (result) => handleCljKondoResult(pi, paths, ctx, result),
    (error) => handleCljKondoError(pi, paths, ctx, error),
  );
}

export function createTurnEndHandler(
  pi: ExtensionAPI,
  pendingFiles: PendingCljKondoFiles,
): ExtensionHandler<TurnEndEvent> {
  return async (_event, ctx) => {
    const paths = [...pendingFiles.values()];
    pendingFiles.clear();
    await match({ aborted: ctx.signal?.aborted, paths })
      .with({ paths: [] }, () => Promise.resolve())
      .with({ aborted: true }, () => Promise.resolve())
      .otherwise(({ paths }) => runPendingCljKondo(pi, paths, ctx));
  };
}

export default function (pi: ExtensionAPI) {
  const pendingFiles: PendingCljKondoFiles = new Map();
  pi.on("turn_start", () => {
    pendingFiles.clear();
  });
  pi.on("tool_result", createToolResultHandler(pendingFiles));
  pi.on("turn_end", createTurnEndHandler(pi, pendingFiles));
}
