#!/usr/bin/env -S deno run --no-lock --node-modules-dir=none --allow-read --allow-write
/// <reference types="deno" />

const TOON_PACKAGE = "@toon-format/toon@2.2.0";
const TOON_SPECIFIER = `npm:${TOON_PACKAGE}`;
const textEncoder = new TextEncoder();

const HELP = `TOON helper for agents

This self-contained Deno script uses the pinned npm:${TOON_PACKAGE} package for
agent-friendly TOON encoding, decoding, validation, and round-trip checks.

The recommended Deno flags avoid local side effects: --node-modules-dir=none
prevents a local node_modules directory, and --no-lock prevents creating or
updating a lockfile. First run may need network access to populate Deno's cache.

Usage:
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts encode [input.json|-] [options]
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts decode [input.toon|-] [options]
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts validate [input.toon|-] [options]
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts roundtrip [input.json|-] [options]

Commands:
  encode      Convert JSON to TOON.
  decode      Convert TOON to pretty JSON.
  validate    Strict-decode TOON and print a structured validity result.
  roundtrip   Encode JSON to TOON, decode it back, compare, and optionally write outputs.

Options:
  -o, --output <file>          Output path (use "-" for stdout). For validate, writes the JSON result. For roundtrip, writes restored JSON.
  --toon-output <file>         Roundtrip-only: write encoded TOON to this path (use "-" for stdout).
  --delimiter <value>          comma, ",", tab, "\\t", pipe, or "|" (default: comma)
  --indent <number>            Spaces per indentation level (default: 2)
  --keyFolding <off|safe>      Encode option for safe dotted-key folding (default: off)
  --flattenDepth <number>      Maximum folded path length when keyFolding=safe
  --expandPaths <off|safe>     Decode option for safe dotted-path expansion (default: off)
  --no-strict                  Decode without strict validation
  --compact                    Decode JSON output without indentation
  --stats                      Encode-only: print JSON/TOON size statistics to stderr
  -h, --help                   Show this help

Exit codes (encode, decode, validate, roundtrip):
  0  success (for validate: input is valid TOON; for roundtrip: JSON round-tripped equal)
  1  error (invalid TOON, invalid JSON input, IO failure, round-trip mismatch, etc.)

Note: roundtrip always writes its JSON status report (equal, byte count, output paths)
to stdout, even when --output is given. The --output path receives the restored JSON,
--toon-output receives the encoded TOON, and the status report still goes to stdout.

Examples:
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts encode data.json -o data.toon
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts encode data.json --delimiter tab --keyFolding safe -o data.toon
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts decode data.toon --expandPaths safe -o data.json
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts validate data.toon
  cat data.json | deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts encode > data.toon
`;

type Command = "encode" | "decode" | "validate" | "roundtrip";
type Mode = "off" | "safe";
type Delimiter = "," | "\t" | "|";

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

interface ToonModule {
  encode(data: unknown, options?: Record<string, unknown>): string;
  decode(text: string, options?: Record<string, unknown>): unknown;
}

let toonModulePromise: Promise<ToonModule> | undefined;

function loadToonModule(): Promise<ToonModule> {
  toonModulePromise ??= import(TOON_SPECIFIER) as Promise<ToonModule>;
  return toonModulePromise;
}

function writeStdout(text: string): void {
  Deno.stdout.writeSync(textEncoder.encode(text));
}

function writeStderr(text: string): void {
  Deno.stderr.writeSync(textEncoder.encode(text));
}

function fail(message: string, exitCode = 1): never {
  writeStderr(`Error: ${message}\n`);
  Deno.exit(exitCode);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function normalizeDelimiter(value: string | undefined): Delimiter {
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

  if (parsed.stats && parsed.command !== "encode") {
    fail("--stats is only supported by the encode command");
  }
  if (parsed.toonOutput && parsed.command !== "roundtrip") {
    fail("--toon-output is only supported by the roundtrip command");
  }

  return parsed;
}

async function readStdin(): Promise<string> {
  return await new Response(Deno.stdin.readable).text();
}

async function readInput(path?: string): Promise<string> {
  if (!path || path === "-") return await readStdin();
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    fail(`failed to read ${JSON.stringify(path)}: ${errorMessage(error)}`);
  }
}

async function writeOutput(text: string, outputPath?: string): Promise<void> {
  if (!outputPath || outputPath === "-") {
    writeStdout(text);
    return;
  }
  try {
    await Deno.writeTextFile(outputPath, text);
  } catch (error) {
    fail(
      `failed to write ${JSON.stringify(outputPath)}: ${errorMessage(error)}`,
    );
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function parseJsonInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`input is not valid JSON: ${errorMessage(error)}`);
  }
}

function encodeOptions(args: ParsedArgs): Record<string, unknown> {
  const options: Record<string, unknown> = {
    delimiter: normalizeDelimiter(args.delimiter),
  };
  if (args.indent !== undefined) options["indent"] = args.indent;
  if (args.keyFolding !== undefined) options["keyFolding"] = args.keyFolding;
  if (args.flattenDepth !== undefined) {
    options["flattenDepth"] = args.flattenDepth;
  }
  return options;
}

function decodeOptions(
  args: ParsedArgs,
  forRoundtrip = false,
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    strict: args.strict,
  };
  if (args.indent !== undefined) options["indent"] = args.indent;

  let expandPaths = args.expandPaths;
  if (forRoundtrip && expandPaths === undefined && args.keyFolding === "safe") {
    expandPaths = "safe";
  }
  if (expandPaths !== undefined) options["expandPaths"] = expandPaths;
  return options;
}

function formatJson(value: unknown, compact: boolean): string {
  const rendered = compact
    ? JSON.stringify(value)
    : JSON.stringify(value, null, 2);
  return compact ? rendered : `${rendered}\n`;
}

function validationError(error: unknown): Record<string, unknown> {
  const maybeRecord = error as Record<string, unknown>;
  return {
    valid: false,
    error: errorMessage(error),
    ...(typeof maybeRecord["line"] === "number"
      ? { line: maybeRecord["line"] }
      : {}),
    ...(typeof maybeRecord["source"] === "string"
      ? { source: maybeRecord["source"] }
      : {}),
  };
}

function printEncodeStats(inputText: string, toonText: string): void {
  const inputBytes = textEncoder.encode(inputText).length;
  const toonBytes = textEncoder.encode(toonText).length;
  const delta = toonBytes - inputBytes;
  const percent = inputBytes === 0 ? 0 : (delta / inputBytes) * 100;
  writeStderr(
    `Stats: JSON ${inputBytes} bytes/${inputText.length} chars → TOON ${toonBytes} bytes/${toonText.length} chars (${
      delta >= 0 ? "+" : ""
    }${delta} bytes, ${percent.toFixed(1)}%).\n`,
  );
}

async function encodeCommand(args: ParsedArgs): Promise<void> {
  const inputText = await readInput(args.input);
  const data = parseJsonInput(inputText);
  const { encode } = await loadToonModule();
  const toonText = encode(data, encodeOptions(args));
  if (args.stats) printEncodeStats(inputText, toonText);
  await writeOutput(toonText, args.output);
}

async function decodeCommand(args: ParsedArgs): Promise<void> {
  const inputText = await readInput(args.input);
  const { decode } = await loadToonModule();
  try {
    const data = decode(inputText, decodeOptions(args));
    await writeOutput(formatJson(data, args.compact), args.output);
  } catch (error) {
    fail(`failed to decode TOON: ${errorMessage(error)}`);
  }
}

async function validateCommand(args: ParsedArgs): Promise<void> {
  const inputText = await readInput(args.input);
  const { decode } = await loadToonModule();
  try {
    const value = decode(inputText, decodeOptions(args));
    await writeOutput(
      `${JSON.stringify({ valid: true, type: jsonType(value) }, null, 2)}\n`,
      args.output,
    );
  } catch (error) {
    await writeOutput(
      `${JSON.stringify(validationError(error), null, 2)}\n`,
      args.output,
    );
    Deno.exit(1);
  }
}

async function roundtripCommand(args: ParsedArgs): Promise<void> {
  const originalText = await readInput(args.input);
  const original = parseJsonInput(originalText);
  const { encode, decode } = await loadToonModule();

  const toon = encode(original, encodeOptions({ ...args, stats: false }));
  let restored: unknown;
  try {
    restored = decode(toon, decodeOptions(args, true));
  } catch (error) {
    fail(`encoded TOON did not decode: ${errorMessage(error)}`);
  }

  const equal = JSON.stringify(original) === JSON.stringify(restored);

  if (args.toonOutput) await writeOutput(toon, args.toonOutput);
  if (args.output) {
    await writeOutput(formatJson(restored, args.compact), args.output);
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
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  if (args === "help") {
    writeStdout(HELP);
    return;
  }

  if (args.command === "encode") return await encodeCommand(args);
  if (args.command === "decode") return await decodeCommand(args);
  if (args.command === "validate") return await validateCommand(args);
  if (args.command === "roundtrip") return await roundtripCommand(args);
}

main().catch((unknownError) => {
  writeStderr(`${errorMessage(unknownError)}\n`);
  Deno.exit(1);
});
