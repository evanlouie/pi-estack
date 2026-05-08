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
import { join } from "node:path";
import { match, P } from "ts-pattern";
import {
  execErrorMessage,
  inputPath,
  missingBinaryReason,
  notify,
  pathEntries,
  resolveToCwd,
  runCommand,
  summarizeOutput,
  type ToolResultPatch,
} from "./lib/command-runner.js";

const PYTHON_FILE_RE = /\.(?:py|pyi)$/i;
const RUFF_COMMAND = "ruff";
/** @internal exported for focused tests. */
export const RUFF_CHECK_ARGS = ["check"] as const;
const RUFF_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 4_000;

/** @internal exported for focused tests. */
export type PendingRuffFile = {
  absolutePath: string;
  displayPath: string;
};

/** @internal exported for focused tests. */
export type PendingRuffFiles = Map<string, PendingRuffFile>;

function targetPath(event: ToolResultEvent): string | undefined {
  return match({ event, path: inputPath(event.input) })
    .with({ event: P.when(isEditToolResult), path: P.string }, ({ path }) => path)
    .with({ event: P.when(isWriteToolResult), path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function isSuccessfulPythonMutation(
  event: ToolResultEvent,
  path: string | undefined,
): path is string {
  return !event.isError && typeof path === "string" && PYTHON_FILE_RE.test(path);
}

function missingBinaryMessage(): string {
  return [
    `${RUFF_COMMAND} is not installed or is not on PATH.`,
    "Agent action: install ruff (for example `uv add --dev ruff`, `pip install ruff`, or `uv tool install ruff`) or ensure the running pi/agent process PATH can find it, then retry the Python file edit.",
  ].join("\n");
}

function ruffFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .with({ code: 127 }, () => missingBinaryMessage())
    .otherwise(({ stderr, stdout, code }) =>
      summarizeOutput(RUFF_COMMAND, stderr || stdout || `exit code ${code}`, OUTPUT_LIMIT),
    );
}

function turnEndFailureMessage(paths: PendingRuffFile[], reason: string): string {
  const files = paths.map(({ displayPath }) => `- ${displayPath}`).join("\n");
  return [
    `${RUFF_COMMAND} ${RUFF_CHECK_ARGS.join(" ")} failed after the last turn for ${paths.length} changed Python file(s):`,
    files,
    "",
    reason,
    "",
    "Please fix these diagnostics before continuing.",
  ].join("\n");
}

function turnEndSuccessMessage(paths: PendingRuffFile[]): string {
  return `Ran ${RUFF_COMMAND} ${RUFF_CHECK_ARGS.join(" ")} on ${paths.length} changed Python file(s)`;
}

function pythonVirtualEnvBinDirectories(cwd: string): string[] {
  const binDirectory = match(process.platform)
    .with("win32", () => "Scripts")
    .otherwise(() => "bin");
  return [join(cwd, ".venv", binDirectory), join(cwd, "venv", binDirectory)];
}

function ruffSearchDirectories(cwd: string): string[] {
  return [...pythonVirtualEnvBinDirectories(cwd), ...pathEntries(cwd)];
}

function recordPendingFile(
  pendingFiles: PendingRuffFiles,
  ctx: ExtensionContext,
  path: string,
): void {
  const absolutePath = resolveToCwd(path, ctx.cwd);
  pendingFiles.set(absolutePath, { absolutePath, displayPath: path });
}

async function runRuff(
  pi: ExtensionAPI,
  absolutePaths: string[],
  ctx: ExtensionContext,
): Promise<ExecResult> {
  return runCommand(pi, ctx, {
    command: RUFF_COMMAND,
    args: [...RUFF_CHECK_ARGS, ...absolutePaths],
    timeoutMs: RUFF_TIMEOUT_MS,
    searchDirectories: ruffSearchDirectories(ctx.cwd),
  });
}

function absolutePaths(paths: PendingRuffFile[]): string[] {
  return paths.map(({ absolutePath }) => absolutePath);
}

function sendFailureMessage(
  pi: ExtensionAPI,
  paths: PendingRuffFile[],
  reason: string,
  result?: ExecResult,
): void {
  pi.sendMessage(
    {
      customType: "ruff-turn-end",
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
  pendingFiles: PendingRuffFiles,
): ExtensionHandler<ToolResultEvent, ToolResultPatch> {
  return (event, ctx) =>
    match({ event, path: targetPath(event) })
      .with({ path: P.when((path) => isSuccessfulPythonMutation(event, path)) }, ({ path }) => {
        recordPendingFile(pendingFiles, ctx, path);
      })
      .otherwise(() => undefined);
}

function notifyTurnEndFailure(ctx: ExtensionContext): void {
  notify(ctx, `${RUFF_COMMAND} failed after turn; diagnostics were sent to the agent.`, "warning");
}

function handleRuffError(
  pi: ExtensionAPI,
  paths: PendingRuffFile[],
  ctx: ExtensionContext,
  error: string,
): void {
  match(ctx.signal?.aborted)
    .with(true, () => undefined)
    .otherwise(() => {
      sendFailureMessage(pi, paths, missingBinaryReason(RUFF_COMMAND, error, missingBinaryMessage()));
      notifyTurnEndFailure(ctx);
    });
}

function handleRuffResult(
  pi: ExtensionAPI,
  paths: PendingRuffFile[],
  ctx: ExtensionContext,
  result: ExecResult,
): void {
  match({ aborted: ctx.signal?.aborted, result })
    .with({ aborted: true }, () => undefined)
    .with({ result: { code: 0, killed: false } }, () => {
      notify(ctx, turnEndSuccessMessage(paths), "info");
    })
    .otherwise(({ result }) => {
      sendFailureMessage(pi, paths, ruffFailureReason(result), result);
      notifyTurnEndFailure(ctx);
    });
}

async function runPendingRuff(
  pi: ExtensionAPI,
  paths: PendingRuffFile[],
  ctx: ExtensionContext,
): Promise<void> {
  return ResultAsync.fromPromise(runRuff(pi, absolutePaths(paths), ctx), execErrorMessage).match(
    (result) => handleRuffResult(pi, paths, ctx, result),
    (error) => handleRuffError(pi, paths, ctx, error),
  );
}

export function createTurnEndHandler(
  pi: ExtensionAPI,
  pendingFiles: PendingRuffFiles,
): ExtensionHandler<TurnEndEvent> {
  return async (_event, ctx) => {
    const paths = [...pendingFiles.values()];
    pendingFiles.clear();
    await match({ aborted: ctx.signal?.aborted, paths })
      .with({ paths: [] }, () => Promise.resolve())
      .with({ aborted: true }, () => Promise.resolve())
      .otherwise(({ paths }) => runPendingRuff(pi, paths, ctx));
  };
}

export default function (pi: ExtensionAPI) {
  const pendingFiles: PendingRuffFiles = new Map();
  pi.on("turn_start", () => {
    pendingFiles.clear();
  });
  pi.on("tool_result", createToolResultHandler(pendingFiles));
  pi.on("turn_end", createTurnEndHandler(pi, pendingFiles));
}
