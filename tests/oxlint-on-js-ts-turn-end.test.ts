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
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, normalize } from "node:path";
import { match, P } from "ts-pattern";
import { commandPathExtensions } from "../extensions/lib/command-runner.js";
import registerOxlintExtension, {
  createToolResultHandler,
  createTurnEndHandler,
  OXLINT_TYPE_CHECK_ARGS,
  type PendingOxlintFiles,
} from "../extensions/oxlint-on-js-ts-turn-end.js";

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

function expectedOxlintArgs(...paths: string[]): string[] {
  return [...OXLINT_TYPE_CHECK_ARGS, ...paths];
}

function okResult(): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false };
}

function failureResult(): ExecResult {
  return { stdout: "", stderr: "lint error", code: 1, killed: false };
}

function missingTypeAwareBackendResult(): ExecResult {
  return {
    stdout: "",
    stderr: "oxlint-tsgolint is required for --type-aware, but it is not installed",
    code: 1,
    killed: false,
  };
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
    message: { role: "assistant", content: [], timestamp: Date.now() } as unknown as TurnEndEvent["message"],
    toolResults: [],
  };
}

function writeEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("write", path, isError);
}

function editEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("edit", path, isError);
}

async function withOxlintOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-oxlint-test-"));
  const executable = join(directory, "oxlint");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  process.env["PATH"] = directory;
  return directory;
}

async function collectAndRunTurnEnd(
  pi: ExtensionAPI,
  pendingFiles: PendingOxlintFiles,
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

void describe("oxlint on JavaScript/TypeScript turn end extension", () => {
  void test("runs oxlint at turn end for a successful TypeScript write", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "oxlint"));
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("collects edits without running oxlint before turn end", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { calls, pi } = createMockPi();
    const result = await createToolResultHandler(pendingFiles)(
      editEvent("src/App.jsx"),
      createContext(cwd),
    );

    assert.equal(result, undefined);
    assert.equal(calls.length, 0);
    assert.equal(pendingFiles.size, 1);

    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/App.jsx")));
  });

  void test("runs oxlint once for supported JavaScript and TypeScript file extensions", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls } = createMockPi();
    const supportedPaths = [
      "src/main.js",
      "src/main.cjs",
      "src/main.mjs",
      "src/App.jsx",
      "src/main.ts",
      "src/main.cts",
      "src/main.mts",
      "src/App.tsx",
    ];
    for (const path of supportedPaths) {
      await createToolResultHandler(pendingFiles)(writeEvent(path), createContext(cwd));
    }
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0]?.args,
      expectedOxlintArgs(...supportedPaths.map((path) => join(cwd, path))),
    );
  });

  void test("deduplicates files changed multiple times in one turn", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.ts"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(editEvent("src/main.ts"), createContext(cwd));
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
  });

  void test("ignores non-JavaScript and non-TypeScript writes", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("main.go"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(
      writeEvent("src/not-standard.mjsx"),
      createContext(cwd),
    );
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);
  });

  void test("ignores failed original writes", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.ts", true), createContext(cwd));
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);
  });

  void test("does not run or trigger a new turn after abort", async () => {
    const cwd = await withOxlintOnPath();
    const abortController = new AbortController();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await createToolResultHandler(pendingFiles)(writeEvent("src/main.ts"), createContext(cwd));
    abortController.abort();
    await createTurnEndHandler(pi, pendingFiles)(
      turnEndEvent(),
      createContext(cwd, abortController.signal),
    );

    assert.equal(calls.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("sends oxlint failures to the agent at turn end", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.options, { deliverAs: "steer", triggerTurn: true });
    assert.equal(messages[0]?.message.customType, "oxlint-turn-end");
    assert.equal(messages[0]?.message.display, true);
    assert.match(firstMessageContent(messages), /oxlint --type-aware --type-check failed/);
    assert.match(firstMessageContent(messages), /- src\/main\.ts/);
    assert.match(firstMessageContent(messages), /lint error/);
  });

  void test("reports missing type-aware backend guidance to the agent", async () => {
    const cwd = await withOxlintOnPath();
    const pendingFiles: PendingOxlintFiles = new Map();
    const { pi, calls, messages } = createMockPi(missingTypeAwareBackendResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
    assert.equal(messages.length, 1);
    assert.match(
      firstMessageContent(messages),
      /oxlint type-aware\/type-check mode requires oxlint-tsgolint/,
    );
    assert.match(firstMessageContent(messages), /install oxlint-tsgolint/);
  });

  void test("default export registers handlers and turn_start clears pending files", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls, handlers } = createRegistrationMockPi();
    registerOxlintExtension(pi);
    const toolResult = handlers.toolResult;
    const turnStart = handlers.turnStart;
    const turnEnd = handlers.turnEnd;

    assert.ok(toolResult);
    assert.ok(turnStart);
    assert.ok(turnEnd);

    await toolResult(writeEvent("src/main.ts"), createContext(cwd));
    turnStart();
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);

    await toolResult(writeEvent("src/main.ts"), createContext(cwd));
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
  });

  void test("falls back to the package-local oxlint binary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-oxlint-test-empty-path-"));
    const pendingFiles: PendingOxlintFiles = new Map();
    process.env["PATH"] = "";
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/main.ts"), createContext(cwd));
    const normalizedCommand = normalize(calls[0]?.command ?? "");

    assert.equal(calls.length, 1);
    match(process.platform)
      .with("win32", () => {
        const commandLine = calls[0]?.args.at(-1) ?? "";
        assert.equal(basename(normalizedCommand).toLowerCase(), "cmd.exe");
        assert.match(commandLine, /node_modules.*\.bin.*oxlint/i);
        assert.match(commandLine, /--type-aware/);
        assert.match(commandLine, /--type-check/);
        assert.match(commandLine, /src[\\/]main\.ts/);
      })
      .otherwise(() => {
        assert.equal(basename(normalizedCommand), "oxlint");
        assert.equal(basename(normalize(join(normalizedCommand, "..", ".."))), "node_modules");
        assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
      });
    assert.equal(messages.length, 0);
  });

  void test("prefers Windows executable extensions before extensionless npm shims", () => {
    assert.deepEqual(commandPathExtensions("oxlint", "win32", ".EXE;.CMD;.BAT;.COM"), [
      ".EXE",
      ".CMD",
      ".BAT",
      ".COM",
      "",
    ]);
  });
});
