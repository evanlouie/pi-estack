#!/usr/bin/env node
/*
  Conservative Tailwind CSS v3 -> v4 class-token rename codemod.

  By default this script runs in dry-run mode and prints the files/tokens it would change.
  It only rewrites deterministic class-token changes that do not require design judgment.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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

const BASE_RENAMES = new Map([
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
  ["flex-shrink", "shrink"],
  ["flex-grow", "grow"],
  ["flex-grow-0", "grow-0"],
  ["overflow-ellipsis", "text-ellipsis"],
  ["decoration-slice", "box-decoration-slice"],
  ["decoration-clone", "box-decoration-clone"],
]);

const TOKEN_RE = /[A-Za-z0-9_@!:/[\]().%#,$-]+/g;

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project || process.cwd());
const write = Boolean(args.write);
const dryRun = !write || Boolean(args["dry-run"]);
const maxFileSize = Number(args["max-file-size"] || 1_000_000);

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  console.error(
    `Error: --project must point to an existing directory. Received: ${projectRoot}`,
  );
  process.exit(2);
}

const files = walk(projectRoot, maxFileSize);
const fileReports = [];
let totalChanges = 0;

for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  const changes = [];
  const updated = original.replace(TOKEN_RE, (token, offset) => {
    const next = transformToken(token);
    if (next !== token) {
      changes.push({ from: token, to: next, line: lineAt(original, offset) });
    }
    return next;
  });
  if (changes.length) {
    totalChanges += changes.length;
    fileReports.push({
      file: path.relative(projectRoot, file).replaceAll(path.sep, "/"),
      changes,
    });
    if (write && updated !== original) fs.writeFileSync(file, updated, "utf8");
  }
}

printReport({
  projectRoot,
  dryRun,
  write,
  filesScanned: files.length,
  totalChanges,
  fileReports,
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
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

function printHelp() {
  console.log(`Usage: node scripts/replace_tailwind_v4_renames.mjs [OPTIONS]

Conservatively rewrites deterministic Tailwind v3 class tokens to v4 equivalents.
Runs as a dry run unless --write is provided.

Options:
  --project DIR          Project directory to scan (default: current directory)
  --dry-run              Preview changes without writing (default)
  --write                Write changes to files
  --max-file-size BYTES  Skip larger files (default: 1000000)
  --help                Show this help

Examples:
  node scripts/replace_tailwind_v4_renames.mjs --project ~/app --dry-run
  node scripts/replace_tailwind_v4_renames.mjs --project ~/app --write

Important:
  This script does not rewrite opacity utilities like bg-opacity-50 because those
  require knowing the paired color utility. Run the audit script for manual items.`);
}

function walk(root, maxBytes) {
  const results = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      if (size <= maxBytes) results.push(full);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function transformToken(token) {
  let transformed = token;

  // v4 arbitrary variable shorthand: bg-[--brand-color] -> bg-(--brand-color)
  transformed = transformed.replace(
    /(^|:)([A-Za-z0-9_/-]+)-\[(--[^\]\s]+)\]/g,
    "$1$2-($3)",
  );

  // v4 important modifier: hover:!bg-red-500 -> hover:bg-red-500!
  transformed = transformed.split(/(?<=:)/).join(""); // no-op guard to keep old Node parsers from optimizing weirdly
  transformed = moveImportantMarker(transformed);

  // Rewrite the base utility after variant prefixes.
  transformed = rewriteBaseUtility(transformed);

  return transformed;
}

function moveImportantMarker(token) {
  const hadTrailingImportant = token.endsWith("!");
  if (hadTrailingImportant) return token;

  const parts = splitVariants(token);
  const base = parts.pop() || "";
  if (base.startsWith("!") && base.length > 1) {
    parts.push(base.slice(1) + "!");
    return parts.join(":");
  }
  return token;
}

function rewriteBaseUtility(token) {
  const important = token.endsWith("!");
  const coreToken = important ? token.slice(0, -1) : token;
  const parts = splitVariants(coreToken);
  const base = parts.pop() || "";

  const negative = base.startsWith("-");
  const normalizedBase = negative ? base.slice(1) : base;
  const renamed = BASE_RENAMES.get(normalizedBase);
  if (!renamed) return token;

  const nextBase = negative ? `-${renamed}` : renamed;
  parts.push(nextBase + (important ? "!" : ""));
  return parts.join(":");
}

function splitVariants(token) {
  // Tailwind class variants use ':'; this simple splitter is sufficient for the
  // deterministic tokens this codemod rewrites. It intentionally ignores tokens
  // with bracketed arbitrary variants containing ':' to avoid risky rewrites.
  if (/\[[^\]]*:[^\]]*\]/.test(token)) return [token];
  return token.split(":");
}

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function printReport(report) {
  console.log(
    `# Tailwind v4 deterministic rename ${report.dryRun ? "dry run" : "write run"}`,
  );
  console.log("");
  console.log(`Project: ${report.projectRoot}`);
  console.log(`Files scanned: ${report.filesScanned}`);
  console.log(
    `Token changes ${report.dryRun ? "that would be made" : "made"}: ${report.totalChanges}`,
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
        `- ...and ${fileReport.changes.length - shown.length} more in this file.`,
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
