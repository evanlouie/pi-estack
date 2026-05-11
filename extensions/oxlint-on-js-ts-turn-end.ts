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
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { match, P } from "ts-pattern";
import {
  execErrorMessage,
  inputPath,
  missingBinaryReason,
  notify,
  projectAndPackageBinSearchDirectories,
  resolveToCwd,
  runCommand,
  summarizeOutput,
  type ToolResultPatch,
} from "./lib/command-runner.js";

const EXTENSION_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const JS_TS_FILE_RE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const OXLINT_COMMAND = "oxlint";
/** @internal exported for focused tests. */
export const OXLINT_TYPE_CHECK_ARGS = ["--type-aware", "--type-check"] as const;
const OXLINT_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 4_000;

/** @internal exported for focused tests. */
export type PendingOxlintFile = {
  absolutePath: string;
  displayPath: string;
};

/** @internal exported for focused tests. */
export type PendingOxlintFiles = Map<string, PendingOxlintFile>;

function targetPath(event: ToolResultEvent): string | undefined {
  return match({ event, path: inputPath(event.input) })
    .with({ event: P.when(isEditToolResult), path: P.string }, ({ path }) => path)
    .with({ event: P.when(isWriteToolResult), path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function isSuccessfulJsTsMutation(
  event: ToolResultEvent,
  path: string | undefined,
): path is string {
  return !event.isError && typeof path === "string" && JS_TS_FILE_RE.test(path);
}

function missingBinaryMessage(): string {
  return [
    `${OXLINT_COMMAND} is not installed or is not on PATH.`,
    "Agent action: install oxlint (for example `bun add -D oxlint` in JavaScript/TypeScript projects) or ensure the running pi/agent process PATH can find it, then retry the JavaScript/TypeScript file edit.",
  ].join("\n");
}

function missingTypeAwareBackendMessage(): string {
  return [
    "oxlint type-aware/type-check mode requires oxlint-tsgolint to be installed alongside the selected oxlint binary.",
    "Agent action: install oxlint-tsgolint in the target project or ensure pi-estack's package-local oxlint is selected, then retry the JavaScript/TypeScript file edit.",
  ].join("\n");
}

function typeAwareBackendReason(output: string): string {
  return match(output)
    .when(
      (value) =>
        /(?:oxlint-tsgolint|tsgolint).*(?:not found|missing|required|requires|install)/i.test(
          value,
        ),
      () => missingTypeAwareBackendMessage(),
    )
    .otherwise((value) => value);
}

function oxlintFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .with({ code: 127 }, () => missingBinaryMessage())
    .otherwise(({ stderr, stdout, code }) =>
      typeAwareBackendReason(
        summarizeOutput(OXLINT_COMMAND, stderr || stdout || `exit code ${code}`, OUTPUT_LIMIT),
      ),
    );
}

function turnEndFailureMessage(paths: PendingOxlintFile[], reason: string): string {
  const files = paths.map(({ displayPath }) => `- ${displayPath}`).join("\n");
  return [
    `${OXLINT_COMMAND} ${OXLINT_TYPE_CHECK_ARGS.join(
      " ",
    )} failed after the last turn for ${paths.length} changed JavaScript/TypeScript file(s):`,
    files,
    "",
    reason,
    "",
    "Please fix these diagnostics before continuing.",
  ].join("\n");
}

function turnEndSuccessMessage(paths: PendingOxlintFile[]): string {
  return `Ran ${OXLINT_COMMAND} ${OXLINT_TYPE_CHECK_ARGS.join(
    " ",
  )} on ${paths.length} changed JavaScript/TypeScript file(s)`;
}

function recordPendingFile(
  pendingFiles: PendingOxlintFiles,
  ctx: ExtensionContext,
  path: string,
): void {
  const absolutePath = resolveToCwd(path, ctx.cwd);
  pendingFiles.set(absolutePath, { absolutePath, displayPath: path });
}

async function runOxlint(
  pi: ExtensionAPI,
  absolutePaths: string[],
  ctx: ExtensionContext,
): Promise<ExecResult> {
  return runCommand(pi, ctx, {
    command: OXLINT_COMMAND,
    args: [...OXLINT_TYPE_CHECK_ARGS, ...absolutePaths],
    timeoutMs: OXLINT_TIMEOUT_MS,
    searchDirectories: projectAndPackageBinSearchDirectories(ctx.cwd, EXTENSION_DIRECTORY),
  });
}

function absolutePaths(paths: PendingOxlintFile[]): string[] {
  return paths.map(({ absolutePath }) => absolutePath);
}

function sendFailureMessage(
  pi: ExtensionAPI,
  paths: PendingOxlintFile[],
  reason: string,
  result?: ExecResult,
): void {
  pi.sendMessage(
    {
      customType: "oxlint-turn-end",
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
  pendingFiles: PendingOxlintFiles,
): ExtensionHandler<ToolResultEvent, ToolResultPatch> {
  return (event, ctx) =>
    match({ event, path: targetPath(event) })
      .with({ path: P.when((path) => isSuccessfulJsTsMutation(event, path)) }, ({ path }) => {
        recordPendingFile(pendingFiles, ctx, path);
      })
      .otherwise(() => undefined);
}

/** @internal exported for focused tests. */
function notifyTurnEndFailure(ctx: ExtensionContext): void {
  notify(
    ctx,
    `${OXLINT_COMMAND} failed after turn; diagnostics were sent to the agent.`,
    "warning",
  );
}

function handleOxlintError(
  pi: ExtensionAPI,
  paths: PendingOxlintFile[],
  ctx: ExtensionContext,
  error: string,
): void {
  match(ctx.signal?.aborted)
    .with(true, () => undefined)
    .otherwise(() => {
      sendFailureMessage(
        pi,
        paths,
        missingBinaryReason(OXLINT_COMMAND, error, missingBinaryMessage()),
      );
      notifyTurnEndFailure(ctx);
    });
}

function handleOxlintResult(
  pi: ExtensionAPI,
  paths: PendingOxlintFile[],
  ctx: ExtensionContext,
  result: ExecResult,
): void {
  match({ aborted: ctx.signal?.aborted, result })
    .with({ aborted: true }, () => undefined)
    .with({ result: { code: 0, killed: false } }, () => {
      notify(ctx, turnEndSuccessMessage(paths), "info");
    })
    .otherwise(({ result }) => {
      sendFailureMessage(pi, paths, oxlintFailureReason(result), result);
      notifyTurnEndFailure(ctx);
    });
}

async function runPendingOxlint(
  pi: ExtensionAPI,
  paths: PendingOxlintFile[],
  ctx: ExtensionContext,
): Promise<void> {
  return ResultAsync.fromPromise(runOxlint(pi, absolutePaths(paths), ctx), execErrorMessage).match(
    (result) => handleOxlintResult(pi, paths, ctx, result),
    (error) => handleOxlintError(pi, paths, ctx, error),
  );
}

export function createTurnEndHandler(
  pi: ExtensionAPI,
  pendingFiles: PendingOxlintFiles,
): ExtensionHandler<TurnEndEvent> {
  return async (_event, ctx) => {
    const paths = [...pendingFiles.values()];
    pendingFiles.clear();
    await match({ aborted: ctx.signal?.aborted, paths })
      .with({ paths: [] }, () => Promise.resolve())
      .with({ aborted: true }, () => Promise.resolve())
      .otherwise(({ paths }) => runPendingOxlint(pi, paths, ctx));
  };
}

export default function (pi: ExtensionAPI) {
  const pendingFiles: PendingOxlintFiles = new Map();
  pi.on("turn_start", () => {
    pendingFiles.clear();
  });
  pi.on("tool_result", createToolResultHandler(pendingFiles));
  pi.on("turn_end", createTurnEndHandler(pi, pendingFiles));
}
