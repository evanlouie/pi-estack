import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  ToolResultEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, normalize } from "node:path";
import { match, P } from "ts-pattern";
import registerRuffExtension, {
  createToolResultHandler,
  createTurnEndHandler,
  RUFF_CHECK_ARGS,
  type PendingRuffFiles,
} from "../extensions/ruff-on-python-turn-end.js";

type ExecCall = {
  command: string;
  args: string[];
  options?: ExecOptions;
};

type SentMessage = {
  message: Parameters<ExtensionAPI["sendMessage"]>[0];
  options?: Parameters<ExtensionAPI["sendMessage"]>[1];
};

type MockPi = {
  pi: ExtensionAPI;
  calls: ExecCall[];
  messages: SentMessage[];
};

type RegisteredHandlers = {
  turnStart?: () => void;
  toolResult?: ExtensionHandler<ToolResultEvent, unknown>;
  turnEnd?: ExtensionHandler<TurnEndEvent>;
};

const originalPath = process.env["PATH"];

function expectedRuffArgs(...paths: string[]): string[] {
  return [...RUFF_CHECK_ARGS, ...paths];
}

function okResult(): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false };
}

function failureResult(): ExecResult {
  return { stdout: "", stderr: "F401 imported but unused", code: 1, killed: false };
}

function killedResult(): ExecResult {
  return { stdout: "", stderr: "", code: 1, killed: true };
}

function createMockPi(result: ExecResult = okResult()): MockPi {
  const calls: ExecCall[] = [];
  const messages: SentMessage[] = [];
  const pi = {
    exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
      calls.push(
        match(options)
          .with(P.nonNullable, (options) => ({ command, args, options }))
          .otherwise(() => ({ command, args })),
      );
      return Promise.resolve(result);
    },
    sendMessage(
      message: Parameters<ExtensionAPI["sendMessage"]>[0],
      options?: Parameters<ExtensionAPI["sendMessage"]>[1],
    ): void {
      messages.push(
        match(options)
          .with(P.nonNullable, (options) => ({ message, options }))
          .otherwise(() => ({ message })),
      );
    },
  } as unknown as ExtensionAPI;
  return { pi, calls, messages };
}

function createRegistrationMockPi(result: ExecResult = okResult()): MockPi & {
  handlers: RegisteredHandlers;
} {
  const mock = createMockPi(result);
  const handlers: RegisteredHandlers = {};
  const pi = {
    ...mock.pi,
    on(event: string, handler: unknown): void {
      match(event)
        .with("turn_start", () => {
          handlers.turnStart = handler as () => void;
        })
        .with("tool_result", () => {
          handlers.toolResult = handler as ExtensionHandler<ToolResultEvent, unknown>;
        })
        .with("turn_end", () => {
          handlers.turnEnd = handler as ExtensionHandler<TurnEndEvent>;
        })
        .otherwise(() => undefined);
    },
  } as unknown as ExtensionAPI;
  return { ...mock, pi, handlers };
}

function createContext(cwd: string, signal?: AbortSignal): ExtensionContext {
  return { cwd, hasUI: false, signal } as unknown as ExtensionContext;
}

function toolResultEvent(
  toolName: "edit" | "write",
  path: string,
  isError = false,
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "tool-call-1",
    toolName,
    input: { path },
    content: [{ type: "text", text: `${toolName} file` }],
    isError,
    details: undefined,
  };
}

function turnEndEvent(): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex: 1,
    message: {
      role: "assistant",
      content: [],
      timestamp: Date.now(),
    } as unknown as TurnEndEvent["message"],
    toolResults: [],
  };
}

function writeEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("write", path, isError);
}

function editEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("edit", path, isError);
}

function ruffExecutableName(): string {
  return match(process.platform)
    .with("win32", () => "ruff.EXE")
    .otherwise(() => "ruff");
}

function virtualEnvBinDirectory(cwd: string, directoryName: ".venv" | "venv"): string {
  const binDirectory = match(process.platform)
    .with("win32", () => "Scripts")
    .otherwise(() => "bin");
  return join(cwd, directoryName, binDirectory);
}

async function writeRuffExecutable(directory: string): Promise<string> {
  const executable = join(directory, ruffExecutableName());
  await mkdir(directory, { recursive: true });
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  return executable;
}

async function withRuffOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-ruff-test-"));
  await writeRuffExecutable(directory);
  process.env["PATH"] = directory;
  return directory;
}

async function withRuffInVirtualEnv(directoryName: ".venv" | "venv" = ".venv"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-estack-ruff-venv-test-"));
  await writeRuffExecutable(virtualEnvBinDirectory(cwd, directoryName));
  process.env["PATH"] = "";
  return cwd;
}

async function collectAndRunTurnEnd(
  pi: ExtensionAPI,
  pendingFiles: PendingRuffFiles,
  event: ToolResultEvent,
  ctx: ExtensionContext,
): Promise<void> {
  await createToolResultHandler(pendingFiles)(event, ctx);
  await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), ctx);
}

function firstMessageContent(messages: SentMessage[]): string {
  return match(messages[0]?.message.content)
    .with(P.string, (content) => content)
    .otherwise(() => "");
}

afterEach(() => {
  match(originalPath)
    .with(undefined, () => Reflect.deleteProperty(process.env, "PATH"))
    .otherwise((path) => {
      process.env["PATH"] = path;
    });
});

void describe("ruff on Python turn end extension", () => {
  void test("runs ruff at turn end for a successful Python write", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, ruffExecutableName()));
    assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("collects edits without running ruff before turn end", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { calls, pi } = createMockPi();
    const result = await createToolResultHandler(pendingFiles)(
      editEvent("src/app.py"),
      createContext(cwd),
    );

    assert.equal(result, undefined);
    assert.equal(calls.length, 0);
    assert.equal(pendingFiles.size, 1);

    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/app.py")));
  });

  void test("runs ruff once for Python source and stub files", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls } = createMockPi();
    const supportedPaths = ["src/main.py", "src/types.pyi"];
    for (const path of supportedPaths) {
      await createToolResultHandler(pendingFiles)(writeEvent(path), createContext(cwd));
    }
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0]?.args,
      expectedRuffArgs(...supportedPaths.map((path) => join(cwd, path))),
    );
  });

  void test("deduplicates files changed multiple times in one turn", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.py"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(editEvent("src/main.py"), createContext(cwd));
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
  });

  void test("ignores non-Python writes and failed Python writes", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("main.ts"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.py", true), createContext(cwd));
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);
  });

  void test("does not run or trigger a new turn after abort", async () => {
    const cwd = await withRuffOnPath();
    const abortController = new AbortController();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.py"), createContext(cwd));
    abortController.abort();
    await createTurnEndHandler(pi, pendingFiles)(
      turnEndEvent(),
      createContext(cwd, abortController.signal),
    );

    assert.equal(calls.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("sends ruff failures to the agent at turn end", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.options, { deliverAs: "steer", triggerTurn: true });
    assert.equal(messages[0]?.message.customType, "ruff-turn-end");
    assert.equal(messages[0]?.message.display, true);
    assert.match(firstMessageContent(messages), /ruff check failed/);
    assert.match(firstMessageContent(messages), /- src\/main\.py/);
    assert.match(firstMessageContent(messages), /F401 imported but unused/);
  });

  void test("reports missing ruff guidance to the agent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-ruff-test-empty-path-"));
    const pendingFiles: PendingRuffFiles = new Map();
    process.env["PATH"] = "";
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 0);
    assert.equal(messages.length, 1);
    assert.match(firstMessageContent(messages), /ruff is not installed or is not on PATH/);
    assert.match(firstMessageContent(messages), /uv add --dev ruff/);
  });

  void test("reports killed or timed out ruff runs to the agent", async () => {
    const cwd = await withRuffOnPath();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls, messages } = createMockPi(killedResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.options, { deliverAs: "steer", triggerTurn: true });
    assert.match(firstMessageContent(messages), /process was killed or timed out/);
  });

  void test("default export registers handlers and turn_start clears pending files", async () => {
    const cwd = await withRuffOnPath();
    const { pi, calls, handlers } = createRegistrationMockPi();
    registerRuffExtension(pi);
    const toolResult = handlers.toolResult;
    const turnStart = handlers.turnStart;
    const turnEnd = handlers.turnEnd;

    assert.ok(toolResult);
    assert.ok(turnStart);
    assert.ok(turnEnd);

    await toolResult(writeEvent("src/main.py"), createContext(cwd));
    turnStart();
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);

    await toolResult(writeEvent("src/main.py"), createContext(cwd));
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
  });

  void test("finds ruff from the project virtual environment", async () => {
    const cwd = await withRuffInVirtualEnv();
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));
    const normalizedCommand = normalize(calls[0]?.command ?? "");

    assert.equal(calls.length, 1);
    match(process.platform)
      .with("win32", () => {
        assert.equal(basename(normalizedCommand).toLowerCase(), "ruff.exe");
        assert.match(normalizedCommand, /\.venv.*Scripts.*ruff\.EXE/i);
        assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
      })
      .otherwise(() => {
        assert.equal(basename(normalizedCommand), "ruff");
        assert.equal(basename(normalize(join(normalizedCommand, "..", ".."))), ".venv");
        assert.deepEqual(calls[0]?.args, expectedRuffArgs(join(cwd, "src/main.py")));
      });
    assert.equal(messages.length, 0);
  });

  void test("prefers project virtual environment ruff over PATH ruff", async () => {
    const cwd = await withRuffInVirtualEnv();
    const pathDirectory = await mkdtemp(join(tmpdir(), "pi-estack-ruff-path-test-"));
    await writeRuffExecutable(pathDirectory);
    process.env["PATH"] = pathDirectory;
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(
      normalize(calls[0]?.command ?? ""),
      normalize(join(virtualEnvBinDirectory(cwd, ".venv"), ruffExecutableName())),
    );
  });

  void test("falls back to ruff from a venv directory", async () => {
    const cwd = await withRuffInVirtualEnv("venv");
    const pendingFiles: PendingRuffFiles = new Map();
    const { pi, calls } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.py"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(
      normalize(calls[0]?.command ?? ""),
      normalize(join(virtualEnvBinDirectory(cwd, "venv"), ruffExecutableName())),
    );
  });
});
