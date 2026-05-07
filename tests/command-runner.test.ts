import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { match, P } from "ts-pattern";
import {
  commandInvocation,
  resolveToCwd,
  runCommand,
} from "../extensions/lib/command-runner.js";

type ExecCall = {
  command: string;
  args: string[];
  options?: ExecOptions;
};

function createMockPi(result: ExecResult): { pi: ExtensionAPI; calls: ExecCall[] } {
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

void describe("command runner helpers", () => {
  void test("wraps Windows cmd and bat files with cmd.exe", () => {
    assert.deepEqual(
      commandInvocation("C:\\tools\\oxlint.cmd", ["--fix", "C:\\repo\\src\\main.ts"], "win32"),
      {
        command: "cmd.exe",
        args: [
          "/d",
          "/s",
          "/c",
          '"C:\\tools\\oxlint.cmd" "--fix" "C:\\repo\\src\\main.ts"',
        ],
      },
    );
  });

  void test("keeps non-Windows invocations direct", () => {
    assert.deepEqual(commandInvocation("/usr/local/bin/oxlint", ["src/main.ts"], "darwin"), {
      command: "/usr/local/bin/oxlint",
      args: ["src/main.ts"],
    });
  });

  void test("resolves relative paths against cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-runner-path-test-"));

    assert.equal(resolveToCwd("src/main.ts", cwd), resolve(cwd, "src/main.ts"));
  });

  void test("returns a missing binary result without calling exec", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-estack-runner-missing-test-"));
    const { pi, calls } = createMockPi({ stdout: "", stderr: "", code: 0, killed: false });
    const result = await runCommand(pi, createContext(cwd), {
      command: "definitely-not-installed-pi-estack-test-command",
      args: ["--version"],
      timeoutMs: 1_000,
      searchDirectories: [cwd],
    });

    assert.equal(calls.length, 0);
    assert.deepEqual(result, {
      stdout: "",
      stderr: "definitely-not-installed-pi-estack-test-command: command not found",
      code: 127,
      killed: false,
    });
  });
});
