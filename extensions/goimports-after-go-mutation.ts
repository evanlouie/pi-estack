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
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { match, P } from "ts-pattern";

const GO_FILE_RE = /\.go$/i;
const GOIMPORTS_COMMAND = "goimports";
const GOIMPORTS_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 2_000;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const MISSING_BINARY_RE = new RegExp(
  [
    `ENOENT.*${GOIMPORTS_COMMAND}`,
    `${GOIMPORTS_COMMAND}.*(?:not found|command not found|no such file or directory)`,
    `command not found:\\s*${GOIMPORTS_COMMAND}`,
  ].join("|"),
  "i",
);

type ToolResultContent = ToolResultEvent["content"];
type ToolResultReplacement = {
  content?: ToolResultContent;
};
type NotificationLevel = "info" | "warning";
type GoimportsInvocation = {
  command: string;
  args: string[];
};

function inputPath(input: ToolResultEvent["input"]): string | undefined {
  return match(input)
    .with({ path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function targetPath(event: ToolResultEvent): string | undefined {
  return match({ event, path: inputPath(event.input) })
    .with({ event: P.when(isEditToolResult), path: P.string }, ({ path }) => path)
    .with({ event: P.when(isWriteToolResult), path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

function isSuccessfulGoMutation(event: ToolResultEvent, path: string | undefined): path is string {
  return !event.isError && typeof path === "string" && GO_FILE_RE.test(path);
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
    .with("", () => `no output; is ${GOIMPORTS_COMMAND} on PATH?`)
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
    `${GOIMPORTS_COMMAND} is not installed or is not on PATH.`,
    "Agent action: run `go install golang.org/x/tools/cmd/goimports@latest`, ensure `$(go env GOPATH)/bin` is on the running pi/agent process PATH, then retry the Go file edit.",
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

function goimportsInvocation(commandPath: string, targetPath: string): GoimportsInvocation {
  return match({ commandPath, platform: process.platform })
    .with(
      {
        platform: "win32",
        commandPath: P.when((path) => /\.(?:bat|cmd)$/i.test(path)),
      },
      ({ commandPath }) => ({
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `${cmdQuote(commandPath)} -w ${cmdQuote(targetPath)}`],
      }),
    )
    .otherwise(({ commandPath }) => ({ command: commandPath, args: ["-w", targetPath] }));
}

function missingBinaryResult(): ExecResult {
  return {
    stdout: "",
    stderr: `${GOIMPORTS_COMMAND}: command not found`,
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

function goimportsFailureReason(result: ExecResult): string {
  return match(result)
    .with({ killed: true }, () => "process was killed or timed out")
    .with({ code: 127 }, () => missingBinaryMessage())
    .otherwise(({ stderr, stdout, code }) =>
      summarizeOutput(stderr || stdout || `exit code ${code}`),
    );
}

function goimportsFailureNotification(path: string, reason: string): string {
  return match(reason)
    .with(
      missingBinaryMessage(),
      () =>
        `${GOIMPORTS_COMMAND} is not installed or is not on PATH; guidance was added to the tool result.`,
    )
    .otherwise(() => `${GOIMPORTS_COMMAND} failed for ${path}: ${reason}`);
}

function failedGoimportsResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  reason: string,
): ToolResultReplacement {
  const message = `${GOIMPORTS_COMMAND} failed for ${path}: ${reason}`;
  notify(ctx, goimportsFailureNotification(path, reason), "warning");
  return appendMessage(content, message);
}

function goimportsResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  result: ExecResult,
): ToolResultReplacement {
  return match(result)
    .with({ code: 0, killed: false }, () => {
      const message = `Ran ${GOIMPORTS_COMMAND} -w on ${path}`;
      notify(ctx, message, "info");
      return appendMessage(
        content,
        `${message}; original tool diff may not include ${GOIMPORTS_COMMAND} changes.`,
      );
    })
    .otherwise((failedResult) =>
      failedGoimportsResponse(path, content, ctx, goimportsFailureReason(failedResult)),
    );
}

function goimportsErrorResponse(
  path: string,
  content: ToolResultContent,
  ctx: ExtensionContext,
  error: string,
): ToolResultReplacement {
  return failedGoimportsResponse(path, content, ctx, missingBinaryReason(error));
}

async function runGoimports(
  pi: ExtensionAPI,
  absolutePath: string,
  ctx: ExtensionContext,
): Promise<ExecResult> {
  const execOptions = {
    cwd: ctx.cwd,
    timeout: GOIMPORTS_TIMEOUT_MS,
    ...match(ctx.signal)
      .with(P.nonNullable, (signal) => ({ signal }))
      .otherwise(() => ({})),
  };
  const commandPath = await match(ctx.signal?.aborted)
    .with(true, async () => undefined)
    .otherwise(() => resolveCommandPath(GOIMPORTS_COMMAND, ctx.cwd));
  return match({ aborted: ctx.signal?.aborted, commandPath })
    .with({ aborted: true }, () => abortedResult())
    .with({ commandPath: undefined }, () => missingBinaryResult())
    .with({ commandPath: P.string }, ({ commandPath }) => {
      const invocation = goimportsInvocation(commandPath, absolutePath);
      return pi.exec(invocation.command, invocation.args, execOptions);
    })
    .exhaustive();
}

/** @internal exported for focused tests. */
export function createToolResultHandler(
  pi: ExtensionAPI,
): ExtensionHandler<ToolResultEvent, ToolResultReplacement> {
  return async (event, ctx) =>
    match({ event, path: targetPath(event) })
      .with({ path: P.when((path) => isSuccessfulGoMutation(event, path)) }, ({ event, path }) => {
        const absolutePath = resolveToCwd(path, ctx.cwd);
        return ResultAsync.fromPromise(
          withFileMutationQueue(absolutePath, () => runGoimports(pi, absolutePath, ctx)),
          execErrorMessage,
        ).match(
          (result) => goimportsResponse(path, event.content, ctx, result),
          (error) => goimportsErrorResponse(path, event.content, ctx, error),
        );
      })
      .otherwise(() => undefined);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", createToolResultHandler(pi));
}
