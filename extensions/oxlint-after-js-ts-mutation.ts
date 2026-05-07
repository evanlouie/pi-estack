import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  isEditToolResult,
  isWriteToolResult,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { ResultAsync } from "neverthrow";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { match, P } from "ts-pattern";
import {
  appendMessage,
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

type ToolResultContent = ToolResultEvent["content"];

function targetPath(event: ToolResultEvent): string | undefined {
  return match({ event, path: inputPath(event.input) })
    .with({ event: P.when(isEditToolResult), path: P.string }, ({ path }) => path)
    .with({ event: P.when(isWriteToolResult), path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function isSuccessfulJsTsMutation(event: ToolResultEvent, path: string | undefined): path is string {
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
      (value) => /(?:oxlint-tsgolint|tsgolint).*(?:not found|missing|required|requires|install)/i.test(value),
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

function oxlintFailureNotification(path: string, reason: string): string {
  return match(reason)
    .with(
      missingBinaryMessage(),
      () =>
        `${OXLINT_COMMAND} is not installed or is not on PATH; guidance was added to the tool result.`,
    )
    .otherwise(() => `${OXLINT_COMMAND} failed for ${path}: ${reason}`);
}

function failedOxlintResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  reason: string,
): ToolResultPatch {
  const message = `${OXLINT_COMMAND} failed for ${path}: ${reason}`;
  notify(ctx, oxlintFailureNotification(path, reason), "warning");
  return appendMessage(content, message);
}

function oxlintResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  result: ExecResult,
): ToolResultPatch {
  return match(result)
    .with({ code: 0, killed: false }, () => {
      const message = `Ran ${OXLINT_COMMAND} on ${path}`;
      notify(ctx, message, "info");
      return appendMessage(content, message);
    })
    .otherwise((failedResult) =>
      failedOxlintResponse(path, content, ctx, oxlintFailureReason(failedResult)),
    );
}

function oxlintErrorResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  error: string,
): ToolResultPatch {
  return failedOxlintResponse(
    path,
    content,
    ctx,
    missingBinaryReason(OXLINT_COMMAND, error, missingBinaryMessage()),
  );
}

async function runOxlint(
  pi: ExtensionAPI,
  absolutePath: string,
  ctx: ExtensionContext,
): Promise<ExecResult> {
  return runCommand(pi, ctx, {
    command: OXLINT_COMMAND,
    args: [...OXLINT_TYPE_CHECK_ARGS, absolutePath],
    timeoutMs: OXLINT_TIMEOUT_MS,
    searchDirectories: projectAndPackageBinSearchDirectories(ctx.cwd, EXTENSION_DIRECTORY),
  });
}

/** @internal exported for focused tests. */
export function createToolResultHandler(
  pi: ExtensionAPI,
): ExtensionHandler<ToolResultEvent, ToolResultPatch> {
  return async (event, ctx) =>
    match({ event, path: targetPath(event) })
      .with({ path: P.when((path) => isSuccessfulJsTsMutation(event, path)) }, ({ event, path }) => {
        const absolutePath = resolveToCwd(path, ctx.cwd);
        return ResultAsync.fromPromise(
          withFileMutationQueue(absolutePath, () => runOxlint(pi, absolutePath, ctx)),
          execErrorMessage,
        ).match(
          (result) => oxlintResponse(path, event.content, ctx, result),
          (error) => oxlintErrorResponse(path, event.content, ctx, error),
        );
      })
      .otherwise(() => undefined);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", createToolResultHandler(pi));
}
