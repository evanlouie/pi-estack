#!/usr/bin/env -S deno run --allow-read
/// <reference types="deno" />
// Self-contained Deno TypeScript script. No package manifest or external packages needed.

import { basename, extname, join, relative, resolve } from "node:path";

type Severity = "info" | "warning" | "error";

type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  files: string[];
};

type Summary = {
  project: string;
  inspectedFiles: number;
  dependencies: Record<string, string | null>;
  findings: Finding[];
};

const argv = Deno.args;
const json = argv.includes("--json");
const help = argv.includes("--help") || argv.includes("-h");
const positional = argv.filter((arg: string) => !arg.startsWith("--"));

if (help) {
  console.log(
    `Usage: deno run --allow-read scripts/audit-tailwind-v4.ts [project-dir] [--json]

Non-destructively scans a project for common Tailwind CSS v4 setup and migration issues.

Options:
  --json    Print machine-readable JSON
  --help    Show this help message

Examples:
  deno run --allow-read scripts/audit-tailwind-v4.ts .
  deno run --allow-read scripts/audit-tailwind-v4.ts /path/to/project --json`,
  );
  Deno.exit(0);
}

const root = resolve(positional[0] || Deno.cwd());

try {
  const stat = Deno.statSync(root);
  if (!stat.isDirectory) {
    console.error(`Error: project-dir must be a directory. Received: ${root}`);
    Deno.exit(2);
  }
} catch {
  console.error(
    `Error: project-dir does not exist or cannot be read. Received: ${root}`,
  );
  Deno.exit(2);
}

function exists(file: string): boolean {
  try {
    Deno.statSync(join(root, file));
    return true;
  } catch {
    return false;
  }
}

function read(file: string): string {
  try {
    return Deno.readTextFileSync(join(root, file));
  } catch {
    return "";
  }
}

function safeJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(read(file));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".turbo",
  ".output",
]);

const textExts = new Set([
  ".css",
  ".pcss",
  ".postcss",
  ".html",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".mdx",
  ".mjs",
  ".cjs",
  ".json",
]);

function walk(dir: string, out: string[] = [], limit = 3000): string[] {
  if (out.length >= limit) return out;

  let entries: Deno.DirEntry[] = [];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (out.length >= limit) break;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      if (!ignoredDirs.has(entry.name)) walk(fullPath, out, limit);
    } else if (entry.isFile) {
      const ext = extname(entry.name);
      if (textExts.has(ext)) out.push(fullPath);
    }
  }

  return out;
}

function rel(file: string): string {
  return relative(root, file).replaceAll(/\\/g, "/");
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") result[key] = raw;
  }
  return result;
}

const files = walk(root);
const findings: Finding[] = [];

function add(
  severity: Severity,
  title: string,
  detail: string,
  files: string[] = [],
): void {
  findings.push({ severity, title, detail, files });
}

const pkg = safeJson("package.json");
const deps = {
  ...asStringMap(pkg?.["dependencies"]),
  ...asStringMap(pkg?.["devDependencies"]),
};
const scripts = asStringMap(pkg?.["scripts"]);

const hasTailwind = Object.hasOwn(deps, "tailwindcss");
const hasVitePlugin = Object.hasOwn(deps, "@tailwindcss/vite");
const hasPostcssPlugin = Object.hasOwn(deps, "@tailwindcss/postcss");
const hasCli = Object.hasOwn(deps, "@tailwindcss/cli");
const hasVite = Object.hasOwn(deps, "vite") ||
  files.some((file: string) => /vite\.config\.[cm]?[jt]s$/.test(file));

if (!exists("package.json")) {
  add(
    "info",
    "No package.json found",
    "The script could not inspect dependencies or scripts.",
  );
} else if (!hasTailwind) {
  add(
    "warning",
    "tailwindcss package not found",
    "Install tailwindcss before using Tailwind v4 in this project.",
  );
}

if (hasVite && !hasVitePlugin) {
  add(
    "warning",
    "Vite project without @tailwindcss/vite",
    "Tailwind v4 recommends the first-party Vite plugin for Vite projects.",
  );
}

const postcssFiles = files.filter(
  (file: string) =>
    /postcss\.config\.[cm]?[jt]s$/.test(file) ||
    /\.postcssrc/.test(basename(file)),
);

for (const file of postcssFiles) {
  const body = Deno.readTextFileSync(file);
  const usesDirectTailwindPostcss =
    /(?:^|[\s{[,])tailwindcss\s*[:(,\]}]/m.test(body) ||
    /["']tailwindcss["']/.test(body);

  if (usesDirectTailwindPostcss && !body.includes("@tailwindcss/postcss")) {
    add(
      "error",
      "PostCSS config uses tailwindcss directly",
      "In v4, the PostCSS plugin is @tailwindcss/postcss.",
      [rel(file)],
    );
  }
  if (body.includes("@tailwindcss/postcss") && !hasPostcssPlugin) {
    add(
      "warning",
      "PostCSS plugin referenced but dependency missing",
      "Install @tailwindcss/postcss.",
      [rel(file)],
    );
  }
}

const viteFiles = files.filter((file: string) =>
  /vite\.config\.[cm]?[jt]s$/.test(file)
);
for (const file of viteFiles) {
  const body = Deno.readTextFileSync(file);
  if (body.includes("@tailwindcss/vite") && !hasVitePlugin) {
    add(
      "warning",
      "Vite plugin referenced but dependency missing",
      "Install @tailwindcss/vite.",
      [rel(file)],
    );
  }
}

for (const [name, command] of Object.entries(scripts)) {
  if (/\btailwindcss\b/.test(command) && !/@tailwindcss\/cli/.test(command)) {
    add(
      "warning",
      `package script '${name}' may use old CLI`,
      "Tailwind v4 CLI commands should use @tailwindcss/cli.",
    );
  }
  if (/@tailwindcss\/cli/.test(command) && !hasCli) {
    add(
      "warning",
      `package script '${name}' references @tailwindcss/cli but dependency is missing`,
      "Install @tailwindcss/cli.",
    );
  }
}

const tailwindConfigs = files.filter((file: string) =>
  /tailwind\.config\.[cm]?[jt]s$/.test(file)
);
for (const file of tailwindConfigs) {
  const body = Deno.readTextFileSync(file);
  const unsupported: string[] = [];
  if (/\bcontent\s*:/.test(body)) unsupported.push("content");
  if (/\bsafelist\s*:/.test(body)) unsupported.push("safelist");
  if (/\bcorePlugins\s*:/.test(body)) unsupported.push("corePlugins");
  if (/\bseparator\s*:/.test(body)) unsupported.push("separator");

  if (unsupported.length) {
    add(
      "warning",
      "JavaScript Tailwind config contains v3-style options",
      `Review these options for v4 CSS-first migration: ${
        unsupported.join(
          ", ",
        )
      }.`,
      [rel(file)],
    );
  } else {
    add(
      "info",
      "JavaScript Tailwind config found",
      "v4 supports JS configs only when loaded explicitly with @config; prefer CSS-first configuration.",
      [rel(file)],
    );
  }
}

const cssFiles = files.filter((file: string) =>
  /\.(css|pcss|postcss)$/.test(file)
);
let hasImportTailwind = false;

for (const file of cssFiles) {
  const body = Deno.readTextFileSync(file);
  if (/@import\s+["']tailwindcss["']/.test(body)) hasImportTailwind = true;

  if (/@tailwind\s+(base|components|utilities)\s*;/.test(body)) {
    add(
      "error",
      "Old @tailwind directives found",
      'In v4, replace @tailwind directives with @import "tailwindcss";',
      [rel(file)],
    );
  }

  if (
    /@apply\b/.test(body) &&
    file.endsWith(".module.css") &&
    !/@reference\b/.test(body)
  ) {
    add(
      "warning",
      "@apply may need @reference",
      "Component-scoped CSS in v4 needs @reference to access theme variables and custom utilities.",
      [rel(file)],
    );
  }
}

const componentStyleFiles = files.filter((file: string) =>
  /\.(vue|svelte|astro)$/.test(file)
);
for (const file of componentStyleFiles) {
  const body = Deno.readTextFileSync(file);
  if (/@apply\b/.test(body) && !/@reference\b/.test(body)) {
    add(
      "warning",
      "@apply may need @reference",
      "Component-scoped CSS in v4 needs @reference to access theme variables and custom utilities.",
      [rel(file)],
    );
  }
}

if (cssFiles.length > 0 && !hasImportTailwind) {
  add(
    "warning",
    'No @import "tailwindcss" found',
    "At least one app stylesheet should import Tailwind v4.",
  );
}

const dynamicPattern =
  /(?:bg|text|border|ring|from|via|to|fill|stroke)-\$\{|\$\{[^}]+\}-(?:50|100|200|300|400|500|600|700|800|900|950)/;
const dynamicFiles: string[] = [];

for (
  const file of files.filter((candidate: string) =>
    /\.(jsx|tsx|vue|svelte|astro|js|ts)$/.test(candidate)
  )
) {
  const body = Deno.readTextFileSync(file);
  if (dynamicPattern.test(body)) dynamicFiles.push(rel(file));
  if (dynamicFiles.length >= 20) break;
}

if (dynamicFiles.length) {
  add(
    "warning",
    "Possible dynamic Tailwind class fragments",
    "Tailwind scans source as text. Map props to complete static utility strings instead of constructing class fragments.",
    dynamicFiles,
  );
}

const summary: Summary = {
  project: root,
  inspectedFiles: files.length,
  dependencies: {
    tailwindcss: deps["tailwindcss"] || null,
    "@tailwindcss/vite": deps["@tailwindcss/vite"] || null,
    "@tailwindcss/postcss": deps["@tailwindcss/postcss"] || null,
    "@tailwindcss/cli": deps["@tailwindcss/cli"] || null,
  },
  findings,
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Tailwind CSS v4 audit: ${root}`);
  console.log(`Inspected files: ${files.length}`);
  console.log("");

  if (findings.length === 0) {
    console.log("No common Tailwind v4 issues detected.");
  } else {
    for (const finding of findings) {
      console.log(`[${finding.severity.toUpperCase()}] ${finding.title}`);
      console.log(`  ${finding.detail}`);
      if (finding.files.length) {
        console.log(`  Files: ${finding.files.join(", ")}`);
      }
      console.log("");
    }
  }
}
