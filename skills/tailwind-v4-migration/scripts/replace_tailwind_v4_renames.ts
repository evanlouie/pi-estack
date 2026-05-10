#!/usr/bin/env -S deno run --allow-read --allow-write
/// <reference types="deno" />
/*
  Conservative Tailwind CSS v3 -> v4 class-token rename codemod.

  By default this script runs in dry-run mode and prints the files/tokens it would change.
  It only rewrites deterministic class-token changes that do not require design judgment.
*/

import { extname, join, relative, resolve, sep } from "node:path";

type ParsedArgs = Record<string, string | boolean>;

type Change = {
  from: string;
  to: string;
  line: number;
};

type FileReport = {
  file: string;
  changes: Change[];
};

type Report = {
  projectRoot: string;
  dryRun: boolean;
  filesScanned: number;
  totalChanges: number;
  fileReports: FileReport[];
};

type TransformRange = {
  start: number;
  end: number;
};

type TransformResult = {
  updated: string;
  changes: Change[];
};

const EXCLUDED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".output",
  "out",
  "target",
  "vendor",
]);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
  ".htm",
  ".mdx",
  ".css",
  ".pcss",
  ".postcss",
  ".scss",
  ".sass",
  ".less",
  ".styl",
]);

const BASE_RENAMES = new Map<string, string>([
  ["shadow-sm", "shadow-xs"],
  ["shadow", "shadow-sm"],
  ["drop-shadow-sm", "drop-shadow-xs"],
  ["drop-shadow", "drop-shadow-sm"],
  ["blur-sm", "blur-xs"],
  ["blur", "blur-sm"],
  ["backdrop-blur-sm", "backdrop-blur-xs"],
  ["backdrop-blur", "backdrop-blur-sm"],
  ["rounded-sm", "rounded-xs"],
  ["rounded", "rounded-sm"],
  ["outline-none", "outline-hidden"],
  ["ring", "ring-3"],
  ["flex-shrink", "shrink"],
  ["flex-shrink-0", "shrink-0"],
  ["flex-grow", "grow"],
  ["flex-grow-0", "grow-0"],
  ["overflow-ellipsis", "text-ellipsis"],
  ["decoration-slice", "box-decoration-slice"],
  ["decoration-clone", "box-decoration-clone"],
]);

const DISPLAY_UTILITIES = new Set([
  "absolute",
  "block",
  "container",
  "fixed",
  "flex",
  "grid",
  "hidden",
  "inline",
  "inline-block",
  "relative",
  "sr-only",
  "sticky",
]);

const TOKEN_RE = /[A-Za-z0-9_@!:/\[\]().%#,$-]+/g;

const args = parseArgs(Deno.args);

if (hasFlag(args, "help") || hasFlag(args, "h")) {
  printHelp();
  Deno.exit(0);
}

const projectRoot = resolve(stringArg(args, "project", Deno.cwd()));
const writeRequested = hasFlag(args, "write");
const dryRun = !writeRequested || hasFlag(args, "dry-run");
const shouldWrite = writeRequested && !dryRun;
const maxFileSize = numberArg(args, "max-file-size", 1_000_000, 0);

if (!isDirectory(projectRoot)) {
  console.error(
    `Error: --project must point to an existing directory. Received: ${projectRoot}`,
  );
  Deno.exit(2);
}

const files = walk(projectRoot, maxFileSize);
const fileReports: FileReport[] = [];
let totalChanges = 0;

for (const file of files) {
  const original = Deno.readTextFileSync(file);
  const { updated, changes } = transformFile(original);
  if (changes.length) {
    totalChanges += changes.length;
    fileReports.push({
      file: relative(projectRoot, file).replaceAll(sep, "/"),
      changes,
    });
    if (shouldWrite && updated !== original) {
      Deno.writeTextFileSync(file, updated);
    }
  }
}

printReport({
  projectRoot,
  dryRun,
  filesScanned: files.length,
  totalChanges,
  fileReports,
});

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-h") {
      out["h"] = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex >= 0) {
      out[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function hasFlag(parsedArgs: ParsedArgs, key: string): boolean {
  return parsedArgs[key] === true;
}

function stringArg(
  parsedArgs: ParsedArgs,
  key: string,
  defaultValue: string,
): string {
  const value = parsedArgs[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== "string") {
    console.error(`Error: --${key} requires a value.`);
    Deno.exit(2);
  }
  return value;
}

function numberArg(
  parsedArgs: ParsedArgs,
  key: string,
  defaultValue: number,
  minimum: number,
): number {
  const value = parsedArgs[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== "string") {
    console.error(`Error: --${key} requires a numeric value.`);
    Deno.exit(2);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    console.error(`Error: --${key} must be a number >= ${minimum}.`);
    Deno.exit(2);
  }
  return number;
}

function printHelp(): void {
  console.log(
    `Usage: deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts [OPTIONS]

Conservatively rewrites deterministic Tailwind v3 class tokens to v4 equivalents.
Runs as a dry run unless --write is provided.

Options:
  --project DIR          Project directory to scan (default: current directory)
  --dry-run              Preview changes without writing (default)
  --write                Write changes to files
  --max-file-size BYTES  Skip larger files (default: 1000000)
  --help                Show this help

Examples:
  deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts --project ~/app --dry-run
  deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts --project ~/app --write

Important:
  This script does not rewrite opacity utilities like bg-opacity-50 because those
  require knowing the paired color utility. Run the audit script for manual items.`,
  );
}

function walk(root: string, maxBytes: number): string[] {
  const results: string[] = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;

    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(current)];
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory) {
        if (!EXCLUDED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      let size = 0;
      try {
        size = Deno.statSync(full).size;
      } catch {
        continue;
      }
      if (size <= maxBytes) results.push(full);
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function transformFile(text: string): TransformResult {
  const changes: Change[] = [];
  const ranges = collectTransformRanges(text);
  if (ranges.length === 0) return { updated: text, changes };

  let updated = "";
  let cursor = 0;
  for (const range of ranges) {
    updated += text.slice(cursor, range.start);
    updated += transformSegment(
      text.slice(range.start, range.end),
      range.start,
    );
    cursor = range.end;
  }
  updated += text.slice(cursor);
  return { updated, changes };

  function transformSegment(segment: string, baseOffset: number): string {
    return segment.replace(
      TOKEN_RE,
      (token: string, offset: number): string => {
        const next = transformToken(token);
        if (next !== token) {
          changes.push({
            from: token,
            to: next,
            line: lineAt(text, baseOffset + offset),
          });
        }
        return next;
      },
    );
  }
}

function collectTransformRanges(text: string): TransformRange[] {
  const ranges: TransformRange[] = [];

  // Transform string literal contents, where class lists usually live in JSX,
  // templates, JSON, HTML attributes, and framework component files. Skip
  // interpolated template literals because their embedded expressions can
  // contain ordinary JavaScript that must not be rewritten as class tokens.
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "/" && isLikelyRegexStart(text, i)) {
      i = skipRegexLiteral(text, i);
      continue;
    }

    const quote = text[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;

    const start = i + 1;
    i++;
    let escaped = false;
    while (i < text.length) {
      const char = text[i];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        const content = text.slice(start, i);
        if (quote !== "`" || !content.includes("${")) addRange(start, i);
        break;
      }
      i++;
    }
  }

  // Transform tokens inside CSS @apply declarations, which are not quoted.
  const applyRegex = /@apply\s+([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = applyRegex.exec(text)) !== null) {
    const appliedClasses = match[1] ?? "";
    if (!appliedClasses) continue;
    const classesStart = match.index + match[0].indexOf(appliedClasses);
    addRange(classesStart, classesStart + appliedClasses.length);
  }

  return ranges
    .sort((a, b) => a.start - b.start)
    .filter((range, index, sorted) => {
      const previous = sorted[index - 1];
      return !previous || range.start >= previous.end;
    });

  function addRange(start: number, end: number): void {
    if (start < end) ranges.push({ start, end });
  }
}

function isLikelyRegexStart(text: string, index: number): boolean {
  const next = text[index + 1];
  if (next === "/" || next === "*") return false;
  const prev = previousNonWhitespace(text, index - 1);
  return prev === "" || "([{=,:;!&|?".includes(prev);
}

function previousNonWhitespace(text: string, index: number): string {
  for (let i = index; i >= 0; i--) {
    const char = text[i] ?? "";
    if (!/\s/.test(char)) return char;
  }
  return "";
}

function skipRegexLiteral(text: string, start: number): number {
  let escaped = false;
  let inCharacterClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "[") {
      inCharacterClass = true;
    } else if (char === "]") {
      inCharacterClass = false;
    } else if (char === "/" && !inCharacterClass) {
      while (/[a-z]/i.test(text[i + 1] ?? "")) i++;
      return i;
    }
  }
  return start;
}

function transformToken(token: string): string {
  let transformed = token;

  // v4 arbitrary variable shorthand: bg-[--brand-color] -> bg-(--brand-color)
  transformed = transformed.replace(
    /(^|:)([A-Za-z0-9_/-]+)-\[(--[^\]\s]+)\]/g,
    "$1$2-($3)",
  );

  // v4 important modifier: hover:!bg-red-500 -> hover:bg-red-500!
  transformed = moveImportantMarker(transformed);

  // Rewrite the base utility after variant prefixes.
  transformed = rewriteBaseUtility(transformed);

  return transformed;
}

function moveImportantMarker(token: string): string {
  const hadTrailingImportant = token.endsWith("!");
  if (hadTrailingImportant) return token;

  const parts = splitVariants(token);
  const base = parts.pop() ?? "";
  if (base.startsWith("!") && base.length > 1) {
    const unimportantBase = base.slice(1);
    if (!isLikelyTailwindClass(unimportantBase)) return token;
    parts.push(`${unimportantBase}!`);
    return parts.join(":");
  }
  return token;
}

function rewriteBaseUtility(token: string): string {
  const important = token.endsWith("!");
  const coreToken = important ? token.slice(0, -1) : token;
  const parts = splitVariants(coreToken);
  const base = parts.pop() ?? "";

  const negative = base.startsWith("-");
  const normalizedBase = negative ? base.slice(1) : base;
  const renamed = BASE_RENAMES.get(normalizedBase);
  if (!renamed) return token;

  const nextBase = negative ? `-${renamed}` : renamed;
  parts.push(nextBase + (important ? "!" : ""));
  return parts.join(":");
}

function isLikelyTailwindClass(base: string): boolean {
  if (!base || !/^[A-Za-z0-9_@-]/.test(base)) return false;
  if (BASE_RENAMES.has(base.replace(/^-/, ""))) return true;
  if (/[-/]/.test(base)) return true;
  return DISPLAY_UTILITIES.has(base);
}

function splitVariants(token: string): string[] {
  // Tailwind class variants use ':'; this simple splitter is sufficient for the
  // deterministic tokens this codemod rewrites. It intentionally ignores tokens
  // with bracketed arbitrary variants containing ':' to avoid risky rewrites.
  if (/\[[^\]]*:[^\]]*\]/.test(token)) return [token];
  return token.split(":");
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function printReport(report: Report): void {
  console.log(
    `# Tailwind v4 deterministic rename ${
      report.dryRun ? "dry run" : "write run"
    }`,
  );
  console.log("");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Files scanned: ${report.filesScanned}`);
  console.log(
    `Token changes ${
      report.dryRun ? "that would be made" : "made"
    }: ${report.totalChanges}`,
  );
  console.log("");
  if (report.totalChanges === 0) {
    console.log("No deterministic class-token renames found.");
    return;
  }
  for (const fileReport of report.fileReports) {
    console.log(`## ${fileReport.file}`);
    const shown = fileReport.changes.slice(0, 50);
    for (const change of shown) {
      console.log(
        `- line ${change.line}: \`${change.from}\` → \`${change.to}\``,
      );
    }
    if (fileReport.changes.length > shown.length) {
      console.log(
        `- ...and ${
          fileReport.changes.length - shown.length
        } more in this file.`,
      );
    }
    console.log("");
  }
  if (report.dryRun) {
    console.log(
      "Run again with --write to apply these changes. Review the project with git diff afterward.",
    );
  } else {
    console.log(
      "Changes written. Review with git diff and run the project build.",
    );
  }
}

function isDirectory(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}
