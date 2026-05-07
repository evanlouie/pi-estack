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
import { createToolResultHandler } from "../extensions/goimports-after-go-mutation.js";

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

function writeEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("write", path, isError);
}

function editEvent(path: string, isError = false): ToolResultEvent {
  return toolResultEvent("edit", path, isError);
}

async function withGoimportsOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-goimports-test-"));
  const executable = join(directory, "goimports");
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

void describe("goimports after Go mutation extension", () => {
  void test("runs goimports for a successful Go write", async () => {
    const cwd = await withGoimportsOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("main.go"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "goimports"));
    assert.deepEqual(calls[0]?.args, ["-w", join(cwd, "main.go")]);
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan goimports -w on main.go; original tool diff may not include goimports changes.",
    });
  });

  void test("runs goimports for a successful Go edit", async () => {
    const cwd = await withGoimportsOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(editEvent("main.go"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "goimports"));
    assert.deepEqual(calls[0]?.args, ["-w", join(cwd, "main.go")]);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan goimports -w on main.go; original tool diff may not include goimports changes.",
    });
  });

  void test("ignores non-Go writes", async () => {
    const cwd = await withGoimportsOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("main.ts"), createContext(cwd));

    assert.equal(calls.length, 0);
    assert.equal(result, undefined);
  });

  void test("ignores failed original writes", async () => {
    const cwd = await withGoimportsOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(
      writeEvent("main.go", true),
      createContext(cwd),
    );

    assert.equal(calls.length, 0);
    assert.equal(result, undefined);
  });

  void test("reports missing goimports without calling exec", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-goimports-test-empty-path-"));
    process.env["PATH"] = "";
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("main.go"), createContext(cwd));

    assert.equal(calls.length, 0);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: [
        "\n\ngoimports failed for main.go: goimports is not installed or is not on PATH.",
        "Agent action: run `go install golang.org/x/tools/cmd/goimports@latest`, ensure `$(go env GOPATH)/bin` is on the running pi/agent process PATH, then retry the Go file edit.",
      ].join("\n"),
    });
  });
});
