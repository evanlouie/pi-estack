import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { ResultAsync } from "neverthrow";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { match, P } from "ts-pattern";

const CLOJURE_FILE_RE = /\.(clj|cljs|cljc|cljd|edn|bb)$/i;
const MUTATING_TOOLS = new Set(["edit", "write"]);
const REPAIR_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2_000;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

type ToolResultContent = ToolResultEvent["content"];
type ToolResultReplacement = {
  content?: ToolResultContent;
};
type NotificationLevel = "info" | "warning";

function targetPath(input: unknown): string | undefined {
  return match(input)
    .with({ path: P.string }, ({ path }) => path)
    .with({ file_path: P.string }, ({ file_path }) => file_path)
    .otherwise(() => undefined);
}

function expandPath(path: string): string {
  const normalized = path.replace(/^@/, "").replace(UNICODE_SPACES, " ");
  return match(normalized)
    .with("~", () => homedir())
    .when(
      (value) => value.startsWith("~/"),
      (value) => homedir() + value.slice(1),
    )
    .otherwise((value) => value);
}

function resolveToCwd(path: string, cwd: string): string {
  const expanded = expandPath(path);
  return match(expanded)
    .when(isAbsolute, (value) => value)
    .otherwise((value) => resolve(cwd, value));
}

function summarizeOutput(output: string): string {
  return match(output.trim())
    .with("", () => "no output; is clj-paren-repair on PATH?")
    .when(
      (trimmed) => trimmed.length > OUTPUT_LIMIT,
      (trimmed) => `${trimmed.slice(0, OUTPUT_LIMIT)}… [truncated]`,
    )
    .otherwise((trimmed) => trimmed);
}

function execErrorMessage(error: unknown): string {
  return match(error)
    .with(P.instanceOf(Error), ({ message }) => message)
    .otherwise((value) => String(value));
}

function appendMessage(
  content: ToolResultContent,
  message: string,
): ToolResultReplacement {
  return {
    content: [...content, { type: "text", text: `\n\n${message}` }],
  };
}

function notify(
  ctx: ExtensionContext,
  message: string,
  level: NotificationLevel,
): void {
  match(ctx)
    .with({ hasUI: true }, ({ ui }) => ui.notify(message, level))
    .otherwise(() => undefined);
}

function repairFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .otherwise(({ stderr, stdout, code }) =>
      summarizeOutput(stderr || stdout || `exit code ${code}`),
    );
}

function failedRepairResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  reason: string,
): ToolResultReplacement {
  const message = `clj-paren-repair failed for ${path}: ${reason}`;
  notify(ctx, message, "warning");
  return appendMessage(content, message);
}

function repairResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  result: ExecResult,
): ToolResultReplacement {
  return match(result)
    .with({ code: 0, killed: false }, () => {
      const message = `Ran clj-paren-repair on ${path}`;
      notify(ctx, message, "info");
      return appendMessage(content, message);
    })
    .otherwise((failedResult) =>
      failedRepairResponse(
        path,
        content,
        ctx,
        repairFailureReason(failedResult),
      ),
    );
}

function repairErrorResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  error: string,
): ToolResultReplacement {
  return failedRepairResponse(path, content, ctx, error);
}

function createToolResultHandler(
  pi: ExtensionAPI,
): ExtensionHandler<ToolResultEvent, ToolResultReplacement> {
  return async (event, ctx) =>
    match({ event, path: targetPath(event.input) })
      .with(
        {
          event: {
            isError: false,
            toolName: P.when((toolName) => MUTATING_TOOLS.has(toolName)),
          },
          path: P.when(
            (path): path is string =>
              typeof path === "string" && CLOJURE_FILE_RE.test(path),
          ),
        },
        ({ event, path }) => {
          const absolutePath = resolveToCwd(path, ctx.cwd);
          return ResultAsync.fromPromise(
            withFileMutationQueue(absolutePath, () =>
              pi.exec("clj-paren-repair", [absolutePath], {
                cwd: ctx.cwd,
                timeout: REPAIR_TIMEOUT_MS,
                ...match(ctx.signal)
                  .with(P.nonNullable, (signal) => ({ signal }))
                  .otherwise(() => ({})),
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
