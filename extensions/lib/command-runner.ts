import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { match, P } from "ts-pattern";

const DEFAULT_OUTPUT_LIMIT = 2_000;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export type NotificationLevel = "info" | "warning";
export type ToolResultContent = ToolResultEvent["content"];
export type ToolResultPatch = {
  content?: ToolResultContent;
  details?: unknown;
  isError?: boolean;
};
export type CommandInvocation = {
  command: string;
  args: string[];
};
export type RunCommandConfig = {
  command: string;
  args: string[];
  timeoutMs: number;
  searchDirectories?: string[];
};

export function inputPath(input: ToolResultEvent["input"]): string | undefined {
  return match(input)
    .with({ path: P.string }, ({ path }) => path)
    .otherwise(() => undefined);
}

export function targetPath(input: unknown): string | undefined {
  return match(input)
    .with({ path: P.string }, ({ path }) => path)
    .with({ file_path: P.string }, ({ file_path }) => file_path)
    .otherwise(() => undefined);
}

export function expandPath(path: string): string {
  const normalized = path.replace(/^@/, "").replace(UNICODE_SPACES, " ");
  return match(normalized)
    .with("~", () => homedir())
    .when(
      (value) => value.startsWith("~/"),
      (value) => homedir() + value.slice(1),
    )
    .otherwise((value) => value);
}

export function resolveToCwd(path: string, cwd: string): string {
  const expanded = expandPath(path);
  return match(expanded)
    .when(isAbsolute, (value) => value)
    .otherwise((value) => resolve(cwd, value));
}

export function summarizeOutput(
  command: string,
  output: string,
  limit = DEFAULT_OUTPUT_LIMIT,
): string {
  return match(output.trim())
    .with("", () => `no output; is ${command} on PATH?`)
    .when(
      (trimmed) => trimmed.length > limit,
      (trimmed) => `${trimmed.slice(0, limit)}… [truncated]`,
    )
    .otherwise((trimmed) => trimmed);
}

export function execErrorMessage(error: unknown): string {
  return match(error)
    .with(P.instanceOf(Error), ({ message }) => message)
    .otherwise((value) => String(value));
}

function missingBinaryPattern(command: string): RegExp {
  return new RegExp(
    [
      `ENOENT.*${command}`,
      `${command}.*(?:not found|command not found|no such file or directory)`,
      `command not found:\\s*${command}`,
    ].join("|"),
    "i",
  );
}

export function missingBinaryReason(
  command: string,
  output: string,
  missingBinaryMessage: string,
): string {
  return match(output)
    .when(
      (value) => missingBinaryPattern(command).test(value),
      () => missingBinaryMessage,
    )
    .otherwise((value) => value);
}

export function commandPathExtensions(
  command: string,
  platform: NodeJS.Platform = process.platform,
  pathExt = process.env["PATHEXT"] || ".EXE;.CMD;.BAT;.COM",
): string[] {
  return match(platform)
    .with("win32", () => {
      const extensions = pathExt.split(";").filter(Boolean);
      const commandHasExtension = extensions.some((extension) =>
        command.toLowerCase().endsWith(extension.toLowerCase()),
      );
      return match(commandHasExtension)
        .with(true, () => [""])
        .with(false, () => [...extensions, ""])
        .exhaustive();
    })
    .otherwise(() => [""]);
}

function executableAccessMode(): number {
  return match(process.platform)
    .with("win32", () => constants.F_OK)
    .otherwise(() => constants.X_OK);
}

export function pathEntries(cwd: string): string[] {
  return (process.env["PATH"] || "").split(delimiter).map((directory) =>
    match(directory)
      .with("", () => cwd)
      .when(isAbsolute, (value) => value)
      .otherwise((value) => resolve(cwd, value)),
  );
}

export function projectAndPackageBinSearchDirectories(
  cwd: string,
  extensionDirectory: string,
): string[] {
  const packageBinDirectory = join(extensionDirectory, "..", "node_modules", ".bin");
  return [join(cwd, "node_modules", ".bin"), ...pathEntries(cwd), packageBinDirectory];
}

export function commandCandidates(command: string, searchDirectories: string[]): string[] {
  return searchDirectories.flatMap((directory) =>
    commandPathExtensions(command).map((extension) => join(directory, `${command}${extension}`)),
  );
}

async function canAccessExecutable(path: string): Promise<boolean> {
  return access(path, executableAccessMode())
    .then(() => true)
    .catch(() => false);
}

export async function resolveCommandPath(
  command: string,
  searchDirectories: string[],
): Promise<string | undefined> {
  const candidates = commandCandidates(command, searchDirectories);
  const checks = await Promise.all(candidates.map(canAccessExecutable));
  return candidates.find((_candidate, index) => checks[index] === true);
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function commandInvocation(
  commandPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CommandInvocation {
  return match({ commandPath, platform })
    .with(
      {
        platform: "win32",
        commandPath: P.when((path) => /\.(?:bat|cmd)$/i.test(path)),
      },
      ({ commandPath }) => ({
        command: "cmd.exe",
        args: ["/d", "/s", "/c", [cmdQuote(commandPath), ...args.map(cmdQuote)].join(" ")],
      }),
    )
    .otherwise(({ commandPath }) => ({ command: commandPath, args }));
}

export function missingBinaryResult(command: string): ExecResult {
  return {
    stdout: "",
    stderr: `${command}: command not found`,
    code: 127,
    killed: false,
  };
}

export function abortedResult(): ExecResult {
  return { stdout: "", stderr: "", code: 1, killed: true };
}

export function appendMessage(content: ToolResultContent, message: string): ToolResultPatch {
  return {
    content: [...content, { type: "text", text: `\n\n${message}` }],
  };
}

export function notify(
  ctx: ExtensionContext,
  message: string,
  level: NotificationLevel,
): void {
  match(ctx)
    .with({ hasUI: true }, ({ ui }) => ui.notify(message, level))
    .otherwise(() => undefined);
}

function execOptions(ctx: ExtensionContext, timeoutMs: number): ExecOptions {
  return match(ctx.signal)
    .with(P.nonNullable, (signal) => ({ cwd: ctx.cwd, timeout: timeoutMs, signal }))
    .otherwise(() => ({ cwd: ctx.cwd, timeout: timeoutMs }));
}

export async function runCommand(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: RunCommandConfig,
): Promise<ExecResult> {
  const searchDirectories = config.searchDirectories ?? pathEntries(ctx.cwd);
  const commandPath = await match(ctx.signal?.aborted)
    .with(true, async () => undefined)
    .otherwise(() => resolveCommandPath(config.command, searchDirectories));
  return match({ aborted: ctx.signal?.aborted, commandPath })
    .with({ aborted: true }, () => abortedResult())
    .with({ commandPath: undefined }, () => missingBinaryResult(config.command))
    .with({ commandPath: P.string }, ({ commandPath }) => {
      const invocation = commandInvocation(commandPath, config.args);
      return pi.exec(invocation.command, invocation.args, execOptions(ctx, config.timeoutMs));
    })
    .exhaustive();
}
