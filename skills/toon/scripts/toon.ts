#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PACKAGE = "@toon-format/cli@2.2.0";

const HELP = `TOON helper for agents

This script wraps the official ${CLI_PACKAGE} package with agent-friendly
commands, pinned versioning, structured validation output, and a round-trip check.

Usage:
  bun run scripts/toon.ts encode [input.json|-] [options]
  bun run scripts/toon.ts decode [input.toon|-] [options]
  bun run scripts/toon.ts validate [input.toon|-] [options]
  bun run scripts/toon.ts roundtrip [input.json|-] [options]

Commands:
  encode      Convert JSON to TOON.
  decode      Convert TOON to pretty JSON.
  validate    Strict-decode TOON and print a structured validity result.
  roundtrip   Encode JSON to TOON, decode it back, compare, and optionally write outputs.

Options:
  -o, --output <file>          Output path. For roundtrip, this writes restored JSON.
  --toon-output <file>         Roundtrip-only: write encoded TOON to this path.
  --delimiter <value>          comma, ",", tab, "\\t", pipe, or "|" (default: comma)
  --indent <number>            Spaces per indentation level (default: 2)
  --keyFolding <off|safe>      Encode option for safe dotted-key folding (default: off)
  --flattenDepth <number>      Maximum folded path length when keyFolding=safe
  --expandPaths <off|safe>     Decode option for safe dotted-path expansion (default: off)
  --no-strict                  Decode without strict validation
  --compact                    Decode JSON output without indentation (wrapper output only)
  --stats                      Pass through official CLI token statistics for encode
  -h, --help                   Show this help

Examples:
  bun run scripts/toon.ts encode data.json -o data.toon
  bun run scripts/toon.ts encode data.json --delimiter tab --keyFolding safe -o data.toon
  bun run scripts/toon.ts decode data.toon --expandPaths safe -o data.json
  bun run scripts/toon.ts validate data.toon
  cat data.json | bun run scripts/toon.ts encode > data.toon
`;

type Command = "encode" | "decode" | "validate" | "roundtrip";
type Mode = "off" | "safe";

interface ParsedArgs {
  command: Command;
  input?: string;
  output?: string;
  toonOutput?: string;
  delimiter?: string;
  indent?: number;
  keyFolding?: Mode;
  flattenDepth?: number;
  expandPaths?: Mode;
  strict: boolean;
  compact: boolean;
  stats: boolean;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function fail(message: string, exitCode = 1): never {
  console.error(`Error: ${message}`);
  process.exit(exitCode);
}

function parseMode(value: string, name: string): Mode {
  if (value === "off" || value === "safe") return value;
  fail(`${name} must be "off" or "safe"; received ${JSON.stringify(value)}`);
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) fail(`${name} must be a positive integer; received ${JSON.stringify(value)}`);
  const number = Number(value);
  if (number <= 0) fail(`${name} must be greater than 0; received ${JSON.stringify(value)}`);
  return number;
}

function parseNumberLike(value: string, name: string): number {
  if (value === "Infinity") return Infinity;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    fail(`${name} must be a non-negative number or Infinity; received ${JSON.stringify(value)}`);
  }
  return number;
}

function normalizeDelimiter(value: string | undefined): "," | "\t" | "|" {
  if (value == null || value === "" || value === "comma" || value === ",") return ",";
  if (value === "tab" || value === "\\t" || value === "\t") return "\t";
  if (value === "pipe" || value === "|") return "|";
  fail(`--delimiter must be one of comma, ",", tab, "\\t", pipe, or "|"; received ${JSON.stringify(value)}`);
}

function parseArgs(argv: string[]): ParsedArgs | "help" {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return "help";

  const command = argv[0] as Command;
  if (!["encode", "decode", "validate", "roundtrip"].includes(command)) {
    fail(`first argument must be one of encode, decode, validate, roundtrip; received ${JSON.stringify(argv[0])}`);
  }

  const parsed: ParsedArgs = {
    command,
    strict: true,
    compact: false,
    stats: false,
  };

  const positionals: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    const requireValue = (flag: string): string => {
      const value = argv[++i];
      if (value == null || value.startsWith("--") || value === "-o" || value === "-h") {
        fail(`${flag} requires a value`);
      }
      return value;
    };

    if (arg === "-o" || arg === "--output") {
      parsed.output = requireValue(arg);
    } else if (arg === "--toon-output") {
      parsed.toonOutput = requireValue(arg);
    } else if (arg === "--delimiter") {
      parsed.delimiter = requireValue(arg);
    } else if (arg === "--indent") {
      parsed.indent = parsePositiveInteger(requireValue(arg), "--indent");
    } else if (arg === "--keyFolding") {
      parsed.keyFolding = parseMode(requireValue(arg), "--keyFolding");
    } else if (arg === "--flattenDepth") {
      parsed.flattenDepth = parseNumberLike(requireValue(arg), "--flattenDepth");
    } else if (arg === "--expandPaths") {
      parsed.expandPaths = parseMode(requireValue(arg), "--expandPaths");
    } else if (arg === "--no-strict") {
      parsed.strict = false;
    } else if (arg === "--compact") {
      parsed.compact = true;
    } else if (arg === "--stats") {
      parsed.stats = true;
    } else if (arg.startsWith("-")) {
      fail(`unknown option ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) {
    fail(`expected at most one input path; received ${positionals.join(", ")}`);
  }

  parsed.input = positionals[0];
  return parsed;
}

async function readInput(path?: string): Promise<string> {
  if (!path || path === "-") return await Bun.stdin.text();
  return await readFile(path, "utf8");
}

function encodeCliOptions(args: ParsedArgs): string[] {
  const out: string[] = ["--encode", "--delimiter", normalizeDelimiter(args.delimiter)];
  if (args.indent !== undefined) out.push("--indent", String(args.indent));
  if (args.keyFolding !== undefined) out.push("--keyFolding", args.keyFolding);
  if (args.flattenDepth !== undefined) out.push("--flattenDepth", String(args.flattenDepth));
  if (args.stats) out.push("--stats");
  return out;
}

function decodeCliOptions(args: ParsedArgs, forRoundtrip = false): string[] {
  const out: string[] = ["--decode"];
  if (args.indent !== undefined) out.push("--indent", String(args.indent));
  if (!args.strict) out.push("--no-strict");

  let expandPaths = args.expandPaths;
  if (forRoundtrip && expandPaths === undefined && args.keyFolding === "safe") {
    expandPaths = "safe";
  }
  if (expandPaths !== undefined) out.push("--expandPaths", expandPaths);
  return out;
}

function addInputAndOutput(base: string[], input: string | undefined, output: string | undefined): string[] {
  const args = [...base];
  if (input && input !== "-") args.push(input);
  if (output) args.push("-o", output);
  return args;
}

async function runOfficialCli(cliArgs: string[], stdinText?: string): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", CLI_PACKAGE, ...cliArgs], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.end(stdinText ?? "");
  });
}

function printCliResult(result: RunResult, outputPath?: string): void {
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) {
    if (outputPath) process.stderr.write(result.stdout);
    else process.stdout.write(result.stdout);
  }
  if (result.code !== 0) process.exit(result.code);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function errorSummary(stderr: string, stdout: string): Record<string, unknown> {
  const text = (stderr || stdout || "TOON validation failed").trim();
  const lineMatch = text.match(/line\s+(\d+)/i);
  return {
    valid: false,
    error: text,
    ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
  };
}

async function encodeCommand(args: ParsedArgs): Promise<void> {
  const cliArgs = addInputAndOutput(encodeCliOptions(args), args.input, args.output);
  const stdinText = !args.input || args.input === "-" ? await Bun.stdin.text() : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);
  printCliResult(result, args.output);
}

async function decodeCommand(args: ParsedArgs): Promise<void> {
  const cliArgs = addInputAndOutput(decodeCliOptions(args), args.input, args.output);
  const stdinText = !args.input || args.input === "-" ? await Bun.stdin.text() : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);

  if (args.compact && result.code === 0 && !args.output) {
    try {
      process.stdout.write(JSON.stringify(JSON.parse(result.stdout)));
      return;
    } catch {
      // Fall through to normal forwarding if the CLI output is not parseable JSON.
    }
  }

  printCliResult(result, args.output);
}

async function validateCommand(args: ParsedArgs): Promise<void> {
  const cliArgs = addInputAndOutput(decodeCliOptions(args), args.input, undefined);
  const stdinText = !args.input || args.input === "-" ? await Bun.stdin.text() : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);

  if (result.code === 0) {
    let value: unknown = undefined;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      value = result.stdout;
    }
    process.stdout.write(`${JSON.stringify({ valid: true, type: jsonType(value) }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(errorSummary(result.stderr, result.stdout), null, 2)}\n`);
  process.exit(result.code);
}

async function roundtripCommand(args: ParsedArgs): Promise<void> {
  const originalText = await readInput(args.input);

  let original: unknown;
  try {
    original = JSON.parse(originalText);
  } catch (error) {
    fail(`input is not valid JSON: ${(error as Error).message}`);
  }

  const temp = await mkdtemp(join(tmpdir(), "toon-skill-"));
  try {
    const inputJson = join(temp, "input.json");
    const encodedToon = join(temp, "encoded.toon");
    const restoredJson = join(temp, "restored.json");
    await writeFile(inputJson, originalText, "utf8");

    const encodeArgs = addInputAndOutput(
      encodeCliOptions({ ...args, stats: false }),
      inputJson,
      encodedToon,
    );
    const encodeResult = await runOfficialCli(encodeArgs);
    if (encodeResult.code !== 0) {
      if (encodeResult.stderr) process.stderr.write(encodeResult.stderr);
      if (encodeResult.stdout) process.stderr.write(encodeResult.stdout);
      process.exit(encodeResult.code);
    }

    const decodeArgs = addInputAndOutput(
      decodeCliOptions(args, true),
      encodedToon,
      restoredJson,
    );
    const decodeResult = await runOfficialCli(decodeArgs);
    if (decodeResult.code !== 0) {
      if (decodeResult.stderr) process.stderr.write(decodeResult.stderr);
      if (decodeResult.stdout) process.stderr.write(decodeResult.stdout);
      process.exit(decodeResult.code);
    }

    const toon = await readFile(encodedToon, "utf8");
    const restoredText = await readFile(restoredJson, "utf8");
    const restored = JSON.parse(restoredText);
    const equal = JSON.stringify(original) === JSON.stringify(restored);

    if (args.toonOutput) await writeFile(args.toonOutput, toon, "utf8");
    if (args.output) {
      const finalJson = args.compact ? JSON.stringify(restored) : `${JSON.stringify(restored, null, 2)}\n`;
      await writeFile(args.output, finalJson, "utf8");
    }

    const result = {
      equal,
      toon_bytes: new TextEncoder().encode(toon).length,
      restored_type: jsonType(restored),
      toon_output: args.toonOutput ?? null,
      restored_output: args.output ?? null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!equal) process.exit(1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args === "help") {
    console.log(HELP);
    return;
  }

  if (args.command === "encode") return await encodeCommand(args);
  if (args.command === "decode") return await decodeCommand(args);
  if (args.command === "validate") return await validateCommand(args);
  if (args.command === "roundtrip") return await roundtripCommand(args);
}

main().catch((error) => {
  const err = error as Error;
  console.error(err.stack ?? err.message ?? String(error));
  process.exit(1);
});
