import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { ResultAsync } from "neverthrow";
import { match, P } from "ts-pattern";
import {
  appendMessage,
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

const MUTATING_TOOLS = new Set(["edit", "write"]);
const REPAIR_COMMAND = "clj-paren-repair";
const INSTALL_SKILL = "clj-paren-repair-install";
const REPAIR_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2_000;

type ToolResultContent = ToolResultEvent["content"];

function missingBinaryMessage(): string {
  return [
    `${REPAIR_COMMAND} is not installed or is not on PATH.`,
    `Agent action: use \`/skill:${INSTALL_SKILL}\` for installation guidance if available. If the skill is unavailable, load or install the pi-estack package so its skills are discovered. Install ${REPAIR_COMMAND}, verify the running pi/agent process can find it, then retry Clojure delimiter repair.`,
  ].join("\n");
}

function repairFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .otherwise(({ stderr, stdout, code }) =>
      missingBinaryReason(
        REPAIR_COMMAND,
        summarizeOutput(REPAIR_COMMAND, stderr || stdout || `exit code ${code}`, OUTPUT_LIMIT),
        missingBinaryMessage(),
      ),
    );
}

function repairFailureNotification(path: string, reason: string): string {
  return match(reason)
    .with(
      missingBinaryMessage(),
      () =>
        `${REPAIR_COMMAND} is not installed or is not on PATH; installation skill guidance was added to the tool result.`,
    )
    .otherwise(() => `${REPAIR_COMMAND} failed for ${path}: ${reason}`);
}

function failedRepairResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  reason: string,
): ToolResultPatch {
  const message = `${REPAIR_COMMAND} failed for ${path}: ${reason}`;
  notify(ctx, repairFailureNotification(path, reason), "warning");
  return appendMessage(content, message);
}

function repairResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  result: ExecResult,
): ToolResultPatch {
  return match(result)
    .with({ code: 0, killed: false }, () => {
      const message = `Ran ${REPAIR_COMMAND} on ${path}`;
      notify(ctx, message, "info");
      return appendMessage(content, message);
    })
    .otherwise((failedResult) =>
      failedRepairResponse(path, content, ctx, repairFailureReason(failedResult)),
    );
}

function repairErrorResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  error: string,
): ToolResultPatch {
  return failedRepairResponse(
    path,
    content,
    ctx,
    missingBinaryReason(REPAIR_COMMAND, error, missingBinaryMessage()),
  );
}

/** @internal exported for focused tests. */
export function createToolResultHandler(
  pi: ExtensionAPI,
): ExtensionHandler<ToolResultEvent, ToolResultPatch> {
  return async (event, ctx) =>
    match({ event, path: targetPath(event.input) })
      .with(
        {
          event: {
            isError: false,
            toolName: P.when((toolName) => MUTATING_TOOLS.has(toolName)),
          },
          path: P.when(
            (path): path is string => typeof path === "string" && isClojurePath(path),
          ),
        },
        ({ event, path }) => {
          const absolutePath = resolveToCwd(path, ctx.cwd);
          return ResultAsync.fromPromise(
            withFileMutationQueue(absolutePath, () =>
              runCommand(pi, ctx, {
                command: REPAIR_COMMAND,
                args: [absolutePath],
                timeoutMs: REPAIR_TIMEOUT_MS,
              }),
            ),
            execErrorMessage,
          ).match(
            (result) => repairResponse(path, event.content, ctx, result),
            (error) => repairErrorResponse(path, event.content, ctx, error),
          );
        },
      )
      .otherwise(() => undefined);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", createToolResultHandler(pi));
}
