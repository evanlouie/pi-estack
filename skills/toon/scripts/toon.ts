#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=npx
/// <reference types="deno" />
/// <reference lib="dom" />

const CLI_PACKAGE = "@toon-format/cli@2.2.0";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const HELP = `TOON helper for agents

This script wraps the official ${CLI_PACKAGE} package with agent-friendly
commands, pinned versioning, structured validation output, and a round-trip check.

Usage:
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode [input.json|-] [options]
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode [input.toon|-] [options]
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts validate [input.toon|-] [options]
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts roundtrip [input.json|-] [options]

Commands:
  encode      Convert JSON to TOON.
  decode      Convert TOON to pretty JSON.
  validate    Strict-decode TOON and print a structured validity result.
  roundtrip   Encode JSON to TOON, decode it back, compare, and optionally write outputs.

Options:
  -o, --output <file>          Output path. For validate, writes the JSON result. For roundtrip, writes restored JSON.
  --toon-output <file>         Roundtrip-only: write encoded TOON to this path.
  --delimiter <value>          comma, ",", tab, "\\t", pipe, or "|" (default: comma)
  --indent <number>            Spaces per indentation level (default: 2)
  --keyFolding <off|safe>      Encode option for safe dotted-key folding (default: off)
  --flattenDepth <number>      Maximum folded path length when keyFolding=safe
  --expandPaths <off|safe>     Decode option for safe dotted-path expansion (default: off)
  --no-strict                  Decode without strict validation
  --compact                    Decode JSON output without indentation
  --stats                      Pass through official CLI token statistics for encode
  -h, --help                   Show this help

Examples:
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode data.json -o data.toon
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode data.json --delimiter tab --keyFolding safe -o data.toon
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode data.toon --expandPaths safe -o data.json
  deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts validate data.toon
  cat data.json | deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode > data.toon
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

function writeStdout(text: string): void {
  Deno.stdout.writeSync(textEncoder.encode(text));
}

function writeStderr(text: string): void {
  Deno.stderr.writeSync(textEncoder.encode(text));
}

function fail(message: string, exitCode = 1): never {
  console.error(`Error: ${message}`);
  Deno.exit(exitCode);
}

function parseMode(value: string, name: string): Mode {
  if (value === "off" || value === "safe") return value;
  fail(`${name} must be "off" or "safe"; received ${JSON.stringify(value)}`);
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    fail(
      `${name} must be a positive integer; received ${JSON.stringify(value)}`,
    );
  }
  const number = Number(value);
  if (number <= 0) {
    fail(`${name} must be greater than 0; received ${JSON.stringify(value)}`);
  }
  return number;
}

function parseNumberLike(value: string, name: string): number {
  if (value === "Infinity") return Infinity;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    fail(
      `${name} must be a non-negative number or Infinity; received ${
        JSON.stringify(
          value,
        )
      }`,
    );
  }
  return number;
}

function normalizeDelimiter(value: string | undefined): "," | "\t" | "|" {
  if (value == null || value === "" || value === "comma" || value === ",") {
    return ",";
  }
  if (value === "tab" || value === "\\t" || value === "\t") return "\t";
  if (value === "pipe" || value === "|") return "|";
  fail(
    `--delimiter must be one of comma, ",", tab, "\\t", pipe, or "|"; received ${
      JSON.stringify(
        value,
      )
    }`,
  );
}

function parseArgs(argv: string[]): ParsedArgs | "help" {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }

  const command = argv[0] as Command;
  if (!["encode", "decode", "validate", "roundtrip"].includes(command)) {
    fail(
      `first argument must be one of encode, decode, validate, roundtrip; received ${
        JSON.stringify(
          argv[0],
        )
      }`,
    );
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
    if (arg === undefined) continue;

    const requireValue = (flag: string): string => {
      const value = argv[++i];
      if (
        value == null ||
        value.startsWith("--") ||
        value === "-o" ||
        value === "-h"
      ) {
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
      parsed.flattenDepth = parseNumberLike(
        requireValue(arg),
        "--flattenDepth",
      );
    } else if (arg === "--expandPaths") {
      parsed.expandPaths = parseMode(requireValue(arg), "--expandPaths");
    } else if (arg === "--no-strict") {
      parsed.strict = false;
    } else if (arg === "--compact") {
      parsed.compact = true;
    } else if (arg === "--stats") {
      parsed.stats = true;
    } else if (arg === "-") {
      positionals.push(arg);
    } else if (arg.startsWith("-")) {
      fail(`unknown option ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) {
    fail(`expected at most one input path; received ${positionals.join(", ")}`);
  }

  const input = positionals[0];
  if (input !== undefined) parsed.input = input;
  return parsed;
}

async function readStdin(): Promise<string> {
  return await new Response(Deno.stdin.readable).text();
}

async function readInput(path?: string): Promise<string> {
  if (!path || path === "-") return await readStdin();
  return await Deno.readTextFile(path);
}

function encodeCliOptions(args: ParsedArgs): string[] {
  const out: string[] = [
    "--encode",
    "--delimiter",
    normalizeDelimiter(args.delimiter),
  ];
  if (args.indent !== undefined) out.push("--indent", String(args.indent));
  if (args.keyFolding !== undefined) out.push("--keyFolding", args.keyFolding);
  if (args.flattenDepth !== undefined) {
    out.push("--flattenDepth", String(args.flattenDepth));
  }
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

function addInputAndOutput(
  base: string[],
  input: string | undefined,
  output: string | undefined,
): string[] {
  const args = [...base];
  if (input && input !== "-") args.push(input);
  if (output) args.push("-o", output);
  return args;
}

async function runOfficialCli(
  cliArgs: string[],
  stdinText?: string,
): Promise<RunResult> {
  const child = new Deno.Command("npx", {
    args: ["--yes", CLI_PACKAGE, ...cliArgs],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = child.stdin.getWriter();
  try {
    await writer.write(textEncoder.encode(stdinText ?? ""));
  } finally {
    await writer.close();
  }

  const output = await child.output();
  return {
    code: output.code,
    stdout: textDecoder.decode(output.stdout),
    stderr: textDecoder.decode(output.stderr),
  };
}

function printCliResult(result: RunResult, outputPath?: string): void {
  if (result.stderr) writeStderr(result.stderr);
  if (result.stdout) {
    if (outputPath) writeStderr(result.stdout);
    else writeStdout(result.stdout);
  }
  if (result.code !== 0) Deno.exit(result.code);
}

async function writeOutput(text: string, outputPath?: string): Promise<void> {
  if (outputPath) await Deno.writeTextFile(outputPath, text);
  else writeStdout(text);
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
  const cliArgs = addInputAndOutput(
    encodeCliOptions(args),
    args.input,
    args.output,
  );
  const stdinText = !args.input || args.input === "-"
    ? await readStdin()
    : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);
  printCliResult(result, args.output);
}

async function decodeCommand(args: ParsedArgs): Promise<void> {
  const cliOutput = args.compact ? undefined : args.output;
  const cliArgs = addInputAndOutput(
    decodeCliOptions(args),
    args.input,
    cliOutput,
  );
  const stdinText = !args.input || args.input === "-"
    ? await readStdin()
    : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);

  if (args.compact && result.code === 0) {
    if (result.stderr) writeStderr(result.stderr);
    try {
      await writeOutput(JSON.stringify(JSON.parse(result.stdout)), args.output);
      return;
    } catch {
      // Fall through to normal forwarding if the CLI output is not parseable JSON.
    }
  }

  printCliResult(result, args.output);
}

async function validateCommand(args: ParsedArgs): Promise<void> {
  const cliArgs = addInputAndOutput(
    decodeCliOptions(args),
    args.input,
    undefined,
  );
  const stdinText = !args.input || args.input === "-"
    ? await readStdin()
    : undefined;
  const result = await runOfficialCli(cliArgs, stdinText);

  if (result.code === 0) {
    let value: unknown = undefined;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      value = result.stdout;
    }
    await writeOutput(
      `${JSON.stringify({ valid: true, type: jsonType(value) }, null, 2)}\n`,
      args.output,
    );
    return;
  }

  await writeOutput(
    `${JSON.stringify(errorSummary(result.stderr, result.stdout), null, 2)}\n`,
    args.output,
  );
  Deno.exit(result.code);
}

async function roundtripCommand(args: ParsedArgs): Promise<void> {
  const originalText = await readInput(args.input);

  let original: unknown;
  try {
    original = JSON.parse(originalText);
  } catch (error) {
    fail(`input is not valid JSON: ${(error as Error).message}`);
  }

  const temp = await Deno.makeTempDir({ prefix: "toon-skill-" });
  try {
    const inputJson = `${temp}/input.json`;
    const encodedToon = `${temp}/encoded.toon`;
    const restoredJson = `${temp}/restored.json`;
    await Deno.writeTextFile(inputJson, originalText);

    const encodeArgs = addInputAndOutput(
      encodeCliOptions({ ...args, stats: false }),
      inputJson,
      encodedToon,
    );
    const encodeResult = await runOfficialCli(encodeArgs);
    if (encodeResult.code !== 0) {
      if (encodeResult.stderr) writeStderr(encodeResult.stderr);
      if (encodeResult.stdout) writeStderr(encodeResult.stdout);
      Deno.exit(encodeResult.code);
    }

    const decodeArgs = addInputAndOutput(
      decodeCliOptions(args, true),
      encodedToon,
      restoredJson,
    );
    const decodeResult = await runOfficialCli(decodeArgs);
    if (decodeResult.code !== 0) {
      if (decodeResult.stderr) writeStderr(decodeResult.stderr);
      if (decodeResult.stdout) writeStderr(decodeResult.stdout);
      Deno.exit(decodeResult.code);
    }

    const toon = await Deno.readTextFile(encodedToon);
    const restoredText = await Deno.readTextFile(restoredJson);
    const restored = JSON.parse(restoredText);
    const equal = JSON.stringify(original) === JSON.stringify(restored);

    if (args.toonOutput) await Deno.writeTextFile(args.toonOutput, toon);
    if (args.output) {
      const finalJson = args.compact
        ? JSON.stringify(restored)
        : `${JSON.stringify(restored, null, 2)}\n`;
      await Deno.writeTextFile(args.output, finalJson);
    }

    const result = {
      equal,
      toon_bytes: textEncoder.encode(toon).length,
      restored_type: jsonType(restored),
      toon_output: args.toonOutput ?? null,
      restored_output: args.output ?? null,
    };
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    if (!equal) Deno.exit(1);
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  if (args === "help") {
    console.log(HELP);
    return;
  }

  if (args.command === "encode") return await encodeCommand(args);
  if (args.command === "decode") return await decodeCommand(args);
  if (args.command === "validate") return await validateCommand(args);
  if (args.command === "roundtrip") return await roundtripCommand(args);
}

main().catch((unknownError) => {
  const err = unknownError as Error;
  console.error(err.stack ?? err.message ?? String(unknownError));
  Deno.exit(1);
});
