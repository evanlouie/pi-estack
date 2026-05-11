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
import { join } from "node:path";
import { match, P } from "ts-pattern";
import registerCljKondoExtension, {
  CLJ_KONDO_LINT_ARGS,
  createToolResultHandler,
  createTurnEndHandler,
  type PendingCljKondoFiles,
} from "../extensions/clj-kondo-on-clojure-turn-end.js";

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

function expectedCljKondoArgs(...paths: string[]): string[] {
  return [...CLJ_KONDO_LINT_ARGS, ...paths];
}

function okResult(): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false };
}

function failureResult(): ExecResult {
  return {
    stdout: "",
    stderr: "src/core.clj:3:1: warning: unused namespace clojure.string",
    code: 2,
    killed: false,
  };
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
  input: Record<string, unknown>,
  isError = false,
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "tool-call-1",
    toolName,
    input,
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
  return toolResultEvent("write", { path }, isError);
}

function writeFilePathEvent(filePath: string, isError = false): ToolResultEvent {
  return toolResultEvent("write", { file_path: filePath }, isError);
}

function editEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("edit", { path }, isError);
}

function cljKondoExecutableName(): string {
  return match(process.platform)
    .with("win32", () => "clj-kondo.EXE")
    .otherwise(() => "clj-kondo");
}

async function withCljKondoOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-clj-kondo-test-"));
  const executable = join(directory, cljKondoExecutableName());
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  process.env["PATH"] = directory;
  return directory;
}

async function collectAndRunTurnEnd(
  pi: ExtensionAPI,
  pendingFiles: PendingCljKondoFiles,
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

void describe("clj-kondo on Clojure turn end extension", () => {
  void test("runs clj-kondo at turn end for a successful Clojure write", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/core.clj"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, cljKondoExecutableName()));
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "src/core.clj")));
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("collects edits without running clj-kondo before turn end", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { calls, pi } = createMockPi();
    const result = await createToolResultHandler(pendingFiles)(
      editEvent("src/app.cljs"),
      createContext(cwd),
    );

    assert.equal(result, undefined);
    assert.equal(calls.length, 0);
    assert.equal(pendingFiles.size, 1);

    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "src/app.cljs")));
  });

  void test("accepts file_path inputs", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls } = createMockPi();
    await collectAndRunTurnEnd(
      pi,
      pendingFiles,
      writeFilePathEvent("deps.edn"),
      createContext(cwd),
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "deps.edn")));
  });

  void test("runs clj-kondo once for supported Clojure file extensions", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls } = createMockPi();
    const supportedPaths = [
      "src/core.clj",
      "src/app.cljs",
      "src/shared.cljc",
      "src/mobile.cljd",
      "deps.edn",
      "script.bb",
    ];
    for (const path of supportedPaths) {
      await createToolResultHandler(pendingFiles)(writeEvent(path), createContext(cwd));
    }
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0]?.args,
      expectedCljKondoArgs(...supportedPaths.map((path) => join(cwd, path))),
    );
  });

  void test("deduplicates files changed multiple times in one turn", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("src/core.clj"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(editEvent("src/core.clj"), createContext(cwd));
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "src/core.clj")));
  });

  void test("ignores non-Clojure writes and failed Clojure writes", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls } = createMockPi();
    await createToolResultHandler(pendingFiles)(writeEvent("main.ts"), createContext(cwd));
    await createToolResultHandler(pendingFiles)(
      writeEvent("src/core.clj", true),
      createContext(cwd),
    );
    await createTurnEndHandler(pi, pendingFiles)(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);
  });

  void test("does not run or trigger a new turn after abort", async () => {
    const cwd = await withCljKondoOnPath();
    const abortController = new AbortController();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await createToolResultHandler(pendingFiles)(writeEvent("src/core.clj"), createContext(cwd));
    abortController.abort();
    await createTurnEndHandler(pi, pendingFiles)(
      turnEndEvent(),
      createContext(cwd, abortController.signal),
    );

    assert.equal(calls.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(pendingFiles.size, 0);
  });

  void test("sends clj-kondo failures to the agent at turn end", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls, messages } = createMockPi(failureResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/core.clj"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "src/core.clj")));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.options, {
      deliverAs: "steer",
      triggerTurn: true,
    });
    assert.equal(messages[0]?.message.customType, "clj-kondo-turn-end");
    assert.equal(messages[0]?.message.display, true);
    assert.match(firstMessageContent(messages), /clj-kondo --lint failed/);
    assert.match(firstMessageContent(messages), /- src\/core\.clj/);
    assert.match(firstMessageContent(messages), /unused namespace clojure\.string/);
  });

  void test("reports missing clj-kondo guidance to the agent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-clj-kondo-test-empty-path-"));
    const pendingFiles: PendingCljKondoFiles = new Map();
    process.env["PATH"] = "";
    const { pi, calls, messages } = createMockPi();
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/core.clj"), createContext(cwd));

    assert.equal(calls.length, 0);
    assert.equal(messages.length, 1);
    assert.match(firstMessageContent(messages), /clj-kondo is not installed or is not on PATH/);
    assert.match(firstMessageContent(messages), /brew install borkdude\/brew\/clj-kondo/);
  });

  void test("reports killed or timed out clj-kondo runs to the agent", async () => {
    const cwd = await withCljKondoOnPath();
    const pendingFiles: PendingCljKondoFiles = new Map();
    const { pi, calls, messages } = createMockPi(killedResult());
    await collectAndRunTurnEnd(pi, pendingFiles, writeEvent("src/core.clj"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.options, {
      deliverAs: "steer",
      triggerTurn: true,
    });
    assert.match(firstMessageContent(messages), /process was killed or timed out/);
  });

  void test("default export registers handlers and turn_start clears pending files", async () => {
    const cwd = await withCljKondoOnPath();
    const { pi, calls, handlers } = createRegistrationMockPi();
    registerCljKondoExtension(pi);
    const toolResult = handlers.toolResult;
    const turnStart = handlers.turnStart;
    const turnEnd = handlers.turnEnd;

    assert.ok(toolResult);
    assert.ok(turnStart);
    assert.ok(turnEnd);

    await toolResult(writeEvent("src/core.clj"), createContext(cwd));
    turnStart();
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 0);

    await toolResult(writeEvent("src/core.clj"), createContext(cwd));
    await turnEnd(turnEndEvent(), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedCljKondoArgs(join(cwd, "src/core.clj")));
  });
});
