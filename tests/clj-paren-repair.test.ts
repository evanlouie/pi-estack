import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { match, P } from "ts-pattern";
import { createToolResultHandler } from "../extensions/clj-paren-repair.js";

type ExecCall = {
  command: string;
  args: string[];
  options?: ExecOptions;
};

type MockPi = {
  pi: ExtensionAPI;
  calls: ExecCall[];
};

const originalPath = process.env["PATH"];

function okResult(): ExecResult {
  return { stdout: "", stderr: "", code: 0, killed: false };
}

function createMockPi(result: ExecResult = okResult()): MockPi {
  const calls: ExecCall[] = [];
  const pi = {
    exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
      calls.push(
        match(options)
          .with(P.nonNullable, (options) => ({ command, args, options }))
          .otherwise(() => ({ command, args })),
      );
      return Promise.resolve(result);
    },
  } as unknown as ExtensionAPI;
  return { pi, calls };
}

function createContext(cwd: string): ExtensionContext {
  return { cwd, hasUI: false } as unknown as ExtensionContext;
}

function toolResultEvent(input: Record<string, unknown>, isError = false): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "tool-call-1",
    toolName: "write",
    input,
    content: [{ type: "text", text: "write file" }],
    isError,
    details: undefined,
  };
}

async function withRepairOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-clj-repair-test-"));
  const executable = join(directory, "clj-paren-repair");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  process.env["PATH"] = directory;
  return directory;
}

afterEach(() => {
  match(originalPath)
    .with(undefined, () => Reflect.deleteProperty(process.env, "PATH"))
    .otherwise((path) => {
      process.env["PATH"] = path;
    });
});

void describe("clj-paren-repair extension", () => {
  void test("runs repair for a successful Clojure write", async () => {
    const cwd = await withRepairOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(
      toolResultEvent({ path: "src/core.clj" }),
      createContext(cwd),
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "clj-paren-repair"));
    assert.deepEqual(calls[0]?.args, [join(cwd, "src/core.clj")]);
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan clj-paren-repair on src/core.clj",
    });
  });

  void test("accepts file_path inputs", async () => {
    const cwd = await withRepairOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(
      toolResultEvent({ file_path: "deps.edn" }),
      createContext(cwd),
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, [join(cwd, "deps.edn")]);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan clj-paren-repair on deps.edn",
    });
  });

  void test("reports missing clj-paren-repair without calling exec", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-clj-repair-empty-path-test-"));
    process.env["PATH"] = "";
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(
      toolResultEvent({ path: "src/core.cljc" }),
      createContext(cwd),
    );

    assert.equal(calls.length, 0);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: [
        "\n\nclj-paren-repair failed for src/core.cljc: clj-paren-repair is not installed or is not on PATH.",
        "Agent action: use `/skill:clj-paren-repair-install` for installation guidance if available. If the skill is unavailable, load or install the pi-estack package so its skills are discovered. Install clj-paren-repair, verify the running pi/agent process can find it, then retry Clojure delimiter repair.",
      ].join("\n"),
    });
  });
});
