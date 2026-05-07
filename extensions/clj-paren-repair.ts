import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { ResultAsync } from "neverthrow";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { match, P } from "ts-pattern";

const CLOJURE_FILE_RE = /\.(clj|cljs|cljc|cljd|edn|bb)$/i;
const MUTATING_TOOLS = new Set(["edit", "write"]);
const REPAIR_COMMAND = "clj-paren-repair";
const INSTALL_SKILL = "clj-paren-repair-install";
const REPAIR_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2_000;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const MISSING_BINARY_RE = new RegExp(
  [
    `ENOENT.*${REPAIR_COMMAND}`,
    `${REPAIR_COMMAND}.*(?:not found|command not found|no such file or directory)`,
    `command not found:\\s*${REPAIR_COMMAND}`,
  ].join("|"),
  "i",
);

type ToolResultContent = ToolResultEvent["content"];
type ToolResultReplacement = {
  content?: ToolResultContent;
};
type NotificationLevel = "info" | "warning";
type RepairInvocation = {
  command: string;
  args: string[];
};

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
    .with("", () => `no output; is ${REPAIR_COMMAND} on PATH?`)
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

function missingBinaryMessage(): string {
  return [
    `${REPAIR_COMMAND} is not installed or is not on PATH.`,
    `Agent action: use \`/skill:${INSTALL_SKILL}\` for installation guidance if available. If the skill is unavailable, load or install the pi-estack package so its skills are discovered. Install ${REPAIR_COMMAND}, verify the running pi/agent process can find it, then retry Clojure delimiter repair.`,
  ].join("\n");
}

function missingBinaryReason(output: string): string {
  return match(output)
    .when(
      (value) => MISSING_BINARY_RE.test(value),
      () => missingBinaryMessage(),
    )
    .otherwise((value) => value);
}

function pathExtensions(command: string): string[] {
  return match(process.platform)
    .with("win32", () => {
      const extensions = (process.env["PATHEXT"] || ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean);
      const commandHasExtension = extensions.some((extension) =>
        command.toLowerCase().endsWith(extension.toLowerCase()),
      );
      return match(commandHasExtension)
        .with(true, () => [""])
        .with(false, () => ["", ...extensions])
        .exhaustive();
    })
    .otherwise(() => [""]);
}

function executableAccessMode(): number {
  return match(process.platform)
    .with("win32", () => constants.F_OK)
    .otherwise(() => constants.X_OK);
}

function pathEntries(cwd: string): string[] {
  return (process.env["PATH"] || "").split(delimiter).map((directory) =>
    match(directory)
      .with("", () => cwd)
      .when(isAbsolute, (value) => value)
      .otherwise((value) => resolve(cwd, value)),
  );
}

function commandCandidates(command: string, cwd: string): string[] {
  return pathEntries(cwd).flatMap((directory) =>
    pathExtensions(command).map((extension) => join(directory, `${command}${extension}`)),
  );
}

async function canAccessExecutable(path: string): Promise<boolean> {
  return access(path, executableAccessMode())
    .then(() => true)
    .catch(() => false);
}

async function resolveCommandPath(command: string, cwd: string): Promise<string | undefined> {
  const candidates = commandCandidates(command, cwd);
  const checks = await Promise.all(candidates.map(canAccessExecutable));
  return candidates.find((_candidate, index) => checks[index]);
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function repairInvocation(commandPath: string, targetPath: string): RepairInvocation {
  return match({ commandPath, platform: process.platform })
    .with(
      {
        platform: "win32",
        commandPath: P.when((path) => /\.(?:bat|cmd)$/i.test(path)),
      },
      ({ commandPath }) => ({
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `${cmdQuote(commandPath)} ${cmdQuote(targetPath)}`],
      }),
    )
    .otherwise(({ commandPath }) => ({ command: commandPath, args: [targetPath] }));
}

function missingBinaryResult(): ExecResult {
  return {
    stdout: "",
    stderr: `${REPAIR_COMMAND}: command not found`,
    code: 127,
    killed: false,
  };
}

function abortedResult(): ExecResult {
  return { stdout: "", stderr: "", code: 1, killed: true };
}

function appendMessage(content: ToolResultContent, message: string): ToolResultReplacement {
  return {
    content: [...content, { type: "text", text: `\n\n${message}` }],
  };
}

function notify(ctx: ExtensionContext, message: string, level: NotificationLevel): void {
  match(ctx)
    .with({ hasUI: true }, ({ ui }) => ui.notify(message, level))
    .otherwise(() => undefined);
}

function repairFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .otherwise(({ stderr, stdout, code }) =>
      missingBinaryReason(summarizeOutput(stderr || stdout || `exit code ${code}`)),
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
): ToolResultReplacement {
  const message = `${REPAIR_COMMAND} failed for ${path}: ${reason}`;
  notify(ctx, repairFailureNotification(path, reason), "warning");
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
): ToolResultReplacement {
  return failedRepairResponse(path, content, ctx, missingBinaryReason(error));
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
            (path): path is string => typeof path === "string" && CLOJURE_FILE_RE.test(path),
          ),
        },
        ({ event, path }) => {
          const absolutePath = resolveToCwd(path, ctx.cwd);
          const execOptions = {
            cwd: ctx.cwd,
            timeout: REPAIR_TIMEOUT_MS,
            ...match(ctx.signal)
              .with(P.nonNullable, (signal) => ({ signal }))
              .otherwise(() => ({})),
          };
          return ResultAsync.fromPromise(
            withFileMutationQueue(absolutePath, async () => {
              const commandPath = await match(ctx.signal?.aborted)
                .with(true, async () => undefined)
                .otherwise(() => resolveCommandPath(REPAIR_COMMAND, ctx.cwd));
              return match({ aborted: ctx.signal?.aborted, commandPath })
                .with({ aborted: true }, () => abortedResult())
                .with({ commandPath: undefined }, () => missingBinaryResult())
                .with({ commandPath: P.string }, ({ commandPath }) => {
                  const invocation = repairInvocation(commandPath, absolutePath);
                  return pi.exec(invocation.command, invocation.args, execOptions);
                })
                .exhaustive();
            }),
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
