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
import { basename, join, normalize } from "node:path";
import { match, P } from "ts-pattern";
import { commandPathExtensions } from "../extensions/lib/command-runner.js";
import {
  createToolResultHandler,
  OXLINT_TYPE_CHECK_ARGS,
} from "../extensions/oxlint-after-js-ts-mutation.js";

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

function expectedOxlintArgs(path: string): string[] {
  return [...OXLINT_TYPE_CHECK_ARGS, path];
}

function compareArgs(left: string[], right: string[]): number {
  return left.join("\0").localeCompare(right.join("\0"));
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

async function withOxlintOnPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-estack-oxlint-test-"));
  const executable = join(directory, "oxlint");
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

void describe("oxlint after JavaScript/TypeScript mutation extension", () => {
  void test("runs oxlint for a successful TypeScript write", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "oxlint"));
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
    assert.equal(calls[0]?.options?.cwd, cwd);
    assert.equal(calls[0]?.options?.timeout, 30_000);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan oxlint on src/main.ts",
    });
  });

  void test("runs oxlint for a successful JSX edit", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(editEvent("src/App.jsx"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, join(cwd, "oxlint"));
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/App.jsx")));
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan oxlint on src/App.jsx",
    });
  });

  void test("runs oxlint for supported JavaScript and TypeScript file extensions", async () => {
    const cwd = await withOxlintOnPath();
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
    await Promise.all(
      supportedPaths.map((path) =>
        Promise.resolve(createToolResultHandler(pi)(writeEvent(path), createContext(cwd))),
      ),
    );

    assert.deepEqual(
      calls.map((call) => call.args).toSorted(compareArgs),
      supportedPaths.map((path) => expectedOxlintArgs(join(cwd, path))).toSorted(compareArgs),
    );
  });

  void test("ignores non-JavaScript and non-TypeScript writes", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("main.go"), createContext(cwd));
    const nonStandardResult = await createToolResultHandler(pi)(
      writeEvent("src/not-standard.mjsx"),
      createContext(cwd),
    );

    assert.equal(calls.length, 0);
    assert.equal(result, undefined);
    assert.equal(nonStandardResult, undefined);
  });

  void test("ignores failed original writes", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(
      writeEvent("src/main.ts", true),
      createContext(cwd),
    );

    assert.equal(calls.length, 0);
    assert.equal(result, undefined);
  });

  void test("reports oxlint failures", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi(failureResult());
    const result = await createToolResultHandler(pi)(writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args, expectedOxlintArgs(join(cwd, "src/main.ts")));
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\noxlint failed for src/main.ts: lint error",
    });
  });

  void test("reports missing type-aware backend guidance", async () => {
    const cwd = await withOxlintOnPath();
    const { pi, calls } = createMockPi(missingTypeAwareBackendResult());
    const result = await createToolResultHandler(pi)(writeEvent("src/main.ts"), createContext(cwd));

    assert.equal(calls.length, 1);
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: [
        "\n\noxlint failed for src/main.ts: oxlint type-aware/type-check mode requires oxlint-tsgolint to be installed alongside the selected oxlint binary.",
        "Agent action: install oxlint-tsgolint in the target project or ensure pi-estack's package-local oxlint is selected, then retry the JavaScript/TypeScript file edit.",
      ].join("\n"),
    });
  });

  void test("falls back to the package-local oxlint binary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-oxlint-test-empty-path-"));
    process.env["PATH"] = "";
    const { pi, calls } = createMockPi();
    const result = await createToolResultHandler(pi)(writeEvent("src/main.ts"), createContext(cwd));
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
    assert.deepEqual(result?.content?.at(-1), {
      type: "text",
      text: "\n\nRan oxlint on src/main.ts",
    });
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
