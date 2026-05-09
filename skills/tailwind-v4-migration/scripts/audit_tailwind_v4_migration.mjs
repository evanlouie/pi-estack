#!/usr/bin/env node
/*
  Tailwind CSS v3 -> v4 migration audit.
  Scans a target project and reports likely manual migration work.
  This script never modifies files.
*/

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '.svelte-kit', '.astro', '.turbo', '.vercel', '.output', 'out', 'target', 'vendor'
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.vue', '.svelte', '.astro', '.html', '.htm', '.md', '.mdx',
  '.css', '.pcss', '.postcss', '.scss', '.sass', '.less', '.styl',
  '.json', '.jsonc', '.yml', '.yaml', '.toml', '.config'
]);

const CONFIG_FILENAMES = new Set([
  'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts', 'tailwind.config.mts', 'tailwind.config.cts',
  'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts',
  'vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts',
  'package.json'
]);

const CLASS_RENAMES = [
  ['shadow-sm', 'shadow-xs'],
  ['shadow', 'shadow-sm'],
  ['drop-shadow-sm', 'drop-shadow-xs'],
  ['drop-shadow', 'drop-shadow-sm'],
  ['blur-sm', 'blur-xs'],
  ['blur', 'blur-sm'],
  ['backdrop-blur-sm', 'backdrop-blur-xs'],
  ['backdrop-blur', 'backdrop-blur-sm'],
  ['rounded-sm', 'rounded-xs'],
  ['rounded', 'rounded-sm'],
  ['outline-none', 'outline-hidden'],
  ['ring', 'ring-3'],
];

const REMOVED_UTILITY_PATTERNS = [
  ['bg-opacity-*', /(?:^|[^\w-])bg-opacity-\d+\b/g, 'Use opacity modifiers like bg-black/50.'],
  ['text-opacity-*', /(?:^|[^\w-])text-opacity-\d+\b/g, 'Use opacity modifiers like text-black/50.'],
  ['border-opacity-*', /(?:^|[^\w-])border-opacity-\d+\b/g, 'Use opacity modifiers like border-black/50.'],
  ['divide-opacity-*', /(?:^|[^\w-])divide-opacity-\d+\b/g, 'Use opacity modifiers like divide-black/50.'],
  ['ring-opacity-*', /(?:^|[^\w-])ring-opacity-\d+\b/g, 'Use opacity modifiers like ring-black/50.'],
  ['placeholder-opacity-*', /(?:^|[^\w-])placeholder-opacity-\d+\b/g, 'Use opacity modifiers like placeholder-black/50.'],
  ['flex-shrink-*', /(?:^|[^\w-])flex-shrink(?:-\d+)?\b/g, 'Use shrink-* utilities.'],
  ['flex-grow-*', /(?:^|[^\w-])flex-grow(?:-\d+)?\b/g, 'Use grow-* utilities.'],
  ['overflow-ellipsis', /(?:^|[^\w-])overflow-ellipsis\b/g, 'Use text-ellipsis.'],
  ['decoration-slice', /(?:^|[^\w-])decoration-slice\b/g, 'Use box-decoration-slice.'],
  ['decoration-clone', /(?:^|[^\w-])decoration-clone\b/g, 'Use box-decoration-clone.'],
];

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project || process.cwd());
const format = args.format || 'markdown';
const maxFileSize = Number(args['max-file-size'] || 1_000_000);
const maxSamples = Number(args['max-samples'] || 12);

if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  console.error(`Error: --project must point to an existing directory. Received: ${projectRoot}`);
  process.exit(2);
}

const files = walk(projectRoot, maxFileSize);
const findings = [];
const stats = {
  projectRoot,
  scannedFiles: files.length,
  packageManager: detectPackageManager(projectRoot),
  hasTailwindConfig: false,
  hasPackageJson: fs.existsSync(path.join(projectRoot, 'package.json')),
};

for (const file of files) {
  const rel = path.relative(projectRoot, file).replaceAll(path.sep, '/');
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    addFinding('info', 'unreadable-file', rel, 0, `Skipped unreadable file: ${error.message}`, 'Confirm permissions or ignore if generated.');
    continue;
  }

  if (/^tailwind\.config\./.test(base)) {
    stats.hasTailwindConfig = true;
    analyzeTailwindConfig(rel, text);
  }
  if (base === 'package.json') analyzePackageJson(rel, text);
  if (/^postcss\.config\./.test(base)) analyzePostCssConfig(rel, text);
  if (/^vite\.config\./.test(base)) analyzeViteConfig(rel, text);
  if (isCssLike(ext)) analyzeCssLike(rel, text, ext);
  analyzeClassTokens(rel, text, ext);
}

const output = {
  generatedAt: new Date().toISOString(),
  stats,
  countsBySeverity: countBy(findings, 'severity'),
  countsByRule: countBy(findings, 'rule'),
  findings,
};

if (format === 'json') {
  console.log(JSON.stringify(output, null, 2));
} else if (format === 'markdown' || format === 'md') {
  console.log(renderMarkdown(output, maxSamples));
} else {
  console.error('Error: --format must be markdown or json.');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/audit_tailwind_v4_migration.mjs [OPTIONS]

Scans a Tailwind CSS v3 project for likely v4 migration work. Does not modify files.

Options:
  --project DIR          Project directory to scan (default: current directory)
  --format FORMAT       markdown or json (default: markdown)
  --max-file-size BYTES  Skip larger files (default: 1000000)
  --max-samples N        Sample findings per rule in markdown output (default: 12)
  --help                Show this help

Examples:
  node scripts/audit_tailwind_v4_migration.mjs --project ~/app --format markdown
  node scripts/audit_tailwind_v4_migration.mjs --project . --format json > audit.json`);
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
        if (!DEFAULT_EXCLUDED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext) && !CONFIG_FILENAMES.has(entry.name)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      if (size <= maxBytes) results.push(full);
    }
  }
  return results.sort();
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function analyzePackageJson(rel, text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch {
    addFinding('action', 'package-json-parse', rel, 1, 'package.json could not be parsed as JSON.', 'Fix package.json before running package-manager migration commands.');
    return;
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const tailwindVersion = deps.tailwindcss;
  if (tailwindVersion) {
    if (/\b3\./.test(tailwindVersion) || /\^3|~3|>=3/.test(tailwindVersion)) {
      addFinding('action', 'tailwind-v3-dependency', rel, 1, `tailwindcss dependency appears to target v3 (${tailwindVersion}).`, 'Upgrade Tailwind and add the v4 integration package required by the build tool.');
    }
  } else {
    addFinding('review', 'tailwind-dependency-missing', rel, 1, 'No tailwindcss dependency found in package.json.', 'Confirm Tailwind is managed elsewhere in the workspace.');
  }
  if (deps.autoprefixer) {
    addFinding('review', 'autoprefixer-present', rel, 1, 'autoprefixer is installed.', 'Tailwind v4 handles vendor prefixing for Tailwind processing; remove autoprefixer if it was only present for Tailwind.');
  }
  if (deps['postcss-import']) {
    addFinding('review', 'postcss-import-present', rel, 1, 'postcss-import is installed.', 'Tailwind v4 handles imports for Tailwind processing; remove postcss-import if it was only present for Tailwind.');
  }
  const scripts = pkg.scripts || {};
  for (const [name, command] of Object.entries(scripts)) {
    if (/\btailwindcss\b/.test(command) && !/@tailwindcss\/cli/.test(command)) {
      addFinding('action', 'cli-package-moved', rel, 1, `Script "${name}" invokes tailwindcss CLI: ${command}`, 'In v4, install/use @tailwindcss/cli for CLI builds.');
    }
  }
  if (deps.vite && !deps['@tailwindcss/vite']) {
    addFinding('review', 'vite-plugin-missing', rel, 1, 'Project depends on Vite but @tailwindcss/vite is not installed.', 'For Vite projects, prefer @tailwindcss/vite for v4.');
  }
  if ((deps.postcss || hasPostCssConfig(projectRoot)) && !deps['@tailwindcss/postcss']) {
    addFinding('review', 'postcss-plugin-missing', rel, 1, 'Project appears to use PostCSS but @tailwindcss/postcss is not installed.', 'Use @tailwindcss/postcss instead of tailwindcss as the PostCSS plugin.');
  }
}

function hasPostCssConfig(root) {
  return ['postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts'].some((name) => fs.existsSync(path.join(root, name)));
}

function analyzeTailwindConfig(rel, text) {
  addFinding('review', 'js-config-present', rel, 1, 'Found tailwind.config.*.', 'v4 does not auto-detect JS config files. Convert to CSS-first config or load explicitly with @config as a bridge.');
  const checks = [
    ['content-option', /\bcontent\s*:/, 'content configuration found.', 'v4 uses automatic content detection; only add @source/source() when the defaults miss files.'],
    ['safelist-option', /\bsafelist\s*:/, 'safelist configuration found.', 'v4 JS config safelist is unsupported. Use @source inline() or statically detectable class maps.'],
    ['separator-option', /\bseparator\s*:/, 'separator configuration found.', 'The JS config separator option is unsupported in v4.'],
    ['coreplugins-option', /\bcorePlugins\s*:/, 'corePlugins configuration found.', 'corePlugins is unsupported in v4. Remove or redesign the build.'],
    ['prefix-option', /\bprefix\s*:/, 'prefix configuration found.', 'v4 prefixes look like variants at the beginning of the class, e.g. tw:flex. Review prefixed classes.'],
    ['darkmode-option', /\bdarkMode\s*:/, 'darkMode configuration found.', 'Review dark mode strategy; convert custom selector behavior to @custom-variant if needed.'],
    ['theme-extend', /\btheme\s*:[\s\S]*?\bextend\s*:/, 'theme.extend found.', 'Move token-driven theme values to @theme variables.'],
    ['plugins-option', /\bplugins\s*:/, 'plugins configuration found.', 'Review plugin compatibility. Use @plugin for legacy JS plugins when needed.'],
    ['presets-option', /\bpresets\s*:/, 'presets configuration found.', 'Review preset compatibility and consider importing shared CSS theme files.'],
  ];
  for (const [rule, regex, message, recommendation] of checks) {
    const line = lineOf(text, regex);
    if (line) addFinding('review', rule, rel, line, message, recommendation);
  }
}

function analyzePostCssConfig(rel, text) {
  if (/tailwindcss/.test(text) && !/@tailwindcss\/postcss/.test(text)) {
    addFinding('action', 'postcss-tailwind-plugin-v3', rel, lineOf(text, /tailwindcss/), 'PostCSS config appears to use tailwindcss directly.', 'Replace with @tailwindcss/postcss for v4.');
  }
  if (/autoprefixer/.test(text)) {
    addFinding('review', 'postcss-autoprefixer', rel, lineOf(text, /autoprefixer/), 'PostCSS config includes autoprefixer.', 'Remove if it was only used for Tailwind processing.');
  }
  if (/postcss-import/.test(text)) {
    addFinding('review', 'postcss-import', rel, lineOf(text, /postcss-import/), 'PostCSS config includes postcss-import.', 'Remove if it was only used for Tailwind imports.');
  }
}

function analyzeViteConfig(rel, text) {
  if (!/@tailwindcss\/vite/.test(text)) {
    addFinding('review', 'vite-tailwind-plugin-missing', rel, 1, 'Vite config does not reference @tailwindcss/vite.', 'For v4 Vite builds, prefer the dedicated @tailwindcss/vite plugin.');
  }
}

function analyzeCssLike(rel, text, ext) {
  if (/@tailwind\s+(base|components|utilities|screens)\b/.test(text)) {
    addFinding('action', 'tailwind-directives-v3', rel, lineOf(text, /@tailwind\s+(base|components|utilities|screens)\b/), 'Found v3 @tailwind directives.', 'Replace v3 directives with @import "tailwindcss";.');
  }
  if (/theme\(/.test(text)) {
    addFinding('review', 'theme-function', rel, lineOf(text, /theme\(/), 'Found theme() usage.', 'Prefer CSS theme variables such as var(--color-red-500); update media-query usage to theme(--breakpoint-*) if theme() remains necessary.');
  }
  if (/@layer\s+(utilities|components)\b/.test(text)) {
    addFinding('review', 'custom-layer-utilities', rel, lineOf(text, /@layer\s+(utilities|components)\b/), 'Found @layer utilities/components.', 'Custom variant-aware utilities should use @utility in v4; keep @layer only for ordinary cascade-layer CSS.');
  }
  if (/@apply\b/.test(text) && /\.(vue|svelte|astro|module\.css|module\.scss|module\.sass|module\.less)$/.test(rel)) {
    addFinding('action', 'apply-needs-reference', rel, lineOf(text, /@apply\b/), 'Found @apply in separately bundled component/module stylesheet.', 'Add @reference to the main Tailwind CSS file or replace @apply with CSS variables.');
  }
  if (['.scss', '.sass', '.less', '.styl'].includes(ext)) {
    addFinding('review', 'css-preprocessor', rel, 1, `Found ${ext} stylesheet.`, 'Tailwind v4 is not designed for Sass/Less/Stylus processing. Prefer plain CSS for Tailwind entry and component styles.');
  }
  if (/@config\b/.test(text)) {
    addFinding('info', 'config-bridge', rel, lineOf(text, /@config\b/), 'Found @config bridge.', 'Keep only as long as legacy JS config is needed; move supported values to CSS over time.');
  }
  if (/@plugin\b/.test(text)) {
    addFinding('info', 'legacy-plugin', rel, lineOf(text, /@plugin\b/), 'Found @plugin legacy plugin directive.', 'Verify the plugin supports Tailwind v4 or that the @plugin bridge is sufficient.');
  }
  if (/@source\b/.test(text)) {
    addFinding('info', 'source-directive', rel, lineOf(text, /@source\b/), 'Found @source directive.', 'Verify source paths are relative to the stylesheet and that safelists use @source inline() where needed.');
  }
}

function analyzeClassTokens(rel, text, ext) {
  for (const [label, regex, recommendation] of REMOVED_UTILITY_PATTERNS) {
    const line = lineOf(text, regex);
    if (line) addFinding('action', `removed-${label}`, rel, line, `Found removed/deprecated utility pattern ${label}.`, recommendation);
  }
  for (const [from, to] of CLASS_RENAMES) {
    const regex = classTokenRegex(from);
    const line = lineOf(text, regex);
    if (line) addFinding('action', `renamed-${from}`, rel, line, `Found v3 utility ${from}.`, `Use ${to} to preserve v3 appearance where applicable.`);
  }
  const classChecks = [
    ['important-prefix', /(?:^|[\s"'`{=])(?:[A-Za-z0-9_@\-]+:)*![A-Za-z0-9_@\-\[\]()./%#]+/m, 'Found v3-style leading important modifier.', 'Move ! to the end of the utility in v4, e.g. hover:bg-red-500!.'],
    ['css-var-arbitrary-shorthand', /[A-Za-z0-9_:@!\-/]+-\[--[^\]\s]+\]/m, 'Found arbitrary value CSS variable shorthand like bg-[--token].', 'Use parenthesis shorthand like bg-(--token).'],
    ['grid-object-arbitrary-comma', /(?:grid-cols|grid-rows|object)-\[[^\]\n]*,[^\]\n]*\]/m, 'Found comma inside grid/object arbitrary value.', 'In v4, use underscores for spaces, e.g. grid-cols-[max-content_auto].'],
    ['space-between-utility', /(?:^|[\s"'`])space-[xy]-\d/m, 'Found space-x-* or space-y-* utilities.', 'Review visual spacing because v4 changed the selector; consider flex/grid gap for affected layouts.'],
    ['divide-utility', /(?:^|[\s"'`])divide-[xy](?:-|\b)/m, 'Found divide-x/divide-y utilities.', 'Review divider layout behavior and default color after v4 migration.'],
    ['border-default-risk', /(?:^|[\s"'`])border(?:-[xytrblse])?(?:\s|["'`]|$)/m, 'Found border utility without an obvious color.', 'v4 default border color is currentColor; add an explicit border color or compatibility base style if needed.'],
    ['dynamic-tailwind-class', /(?:bg|text|border|ring|from|to|via|grid-cols|col-span|row-span|p|m|w|h)-\$\{|\$\{[^}\n]+\}-(?:50|100|200|300|400|500|600|700|800|900|950)/m, 'Found likely dynamically constructed Tailwind class.', 'Use complete static class names, a prop-to-class map, or @source inline() safelisting.'],
    ['transform-none', /(?:^|[\s"'`])(?:[A-Za-z0-9_@\-]+:)*transform-none(?:[\s"'`]|$)/m, 'Found transform-none.', 'v4 rotate/scale/translate use individual properties; reset with scale-none/rotate-none/translate-none as appropriate.'],
    ['transition-transform-list', /transition-\[[^\]]*transform[^\]]*\]/m, 'Found transition-[...,transform,...].', 'In v4, include individual properties such as scale, rotate, or translate.'],
  ];
  for (const [rule, regex, message, recommendation] of classChecks) {
    const line = lineOf(text, regex);
    if (line) addFinding(rule.includes('dynamic') ? 'action' : 'review', rule, rel, line, message, recommendation);
  }
  if (ext === '.html' || ext === '.vue' || ext === '.svelte' || ext === '.astro' || /\.[jt]sx?$/.test(ext)) {
    const hiddenLine = lineOf(text, /hidden[\s"'=][\s\S]{0,120}\b(?:block|flex|grid|inline-block)\b|\b(?:block|flex|grid|inline-block)\b[\s\S]{0,120}hidden[\s"'=]/m);
    if (hiddenLine) {
      addFinding('review', 'hidden-attribute-priority', rel, hiddenLine, 'Found hidden attribute near display classes.', 'In v4, display utilities no longer override the hidden attribute; remove hidden when the element should be visible.');
    }
  }
}

function classTokenRegex(token) {
  // Matches a class token base after optional variants and optional leading important marker.
  const escaped = escapeRegExp(token);
  return new RegExp('(?:^|[\\s"\'=])(?:[A-Za-z0-9_@.-]+:)*!?' + escaped + '(?:!)?(?=$|[\\s"\'=])', 'm');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCssLike(ext) {
  return ['.css', '.pcss', '.postcss', '.scss', '.sass', '.less', '.styl', '.vue', '.svelte', '.astro'].includes(ext);
}

function lineOf(text, regex) {
  const re = new RegExp(regex.source, regex.flags.replace('g', ''));
  const match = re.exec(text);
  if (!match) return 0;
  return text.slice(0, match.index).split(/\r?\n/).length;
}

function addFinding(severity, rule, file, line, message, recommendation) {
  findings.push({ severity, rule, file, line, message, recommendation });
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function renderMarkdown(output, maxSamples) {
  const { stats, countsBySeverity, countsByRule, findings } = output;
  const lines = [];
  lines.push('# Tailwind CSS v3 → v4 migration audit');
  lines.push('');
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push(`Project: \`${stats.projectRoot}\``);
  lines.push(`Scanned files: ${stats.scannedFiles}`);
  lines.push(`Package manager: ${stats.packageManager}`);
  lines.push(`Tailwind config present: ${stats.hasTailwindConfig ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  for (const severity of ['action', 'review', 'info']) {
    lines.push(`- ${severity}: ${countsBySeverity[severity] || 0}`);
  }
  lines.push('');
  if (findings.length === 0) {
    lines.push('No likely v3-to-v4 migration issues were detected by this script. Still run the official upgrade tool and the project build.');
    return lines.join('\n');
  }
  lines.push('## Findings by rule');
  lines.push('');
  for (const [rule, count] of Object.entries(countsByRule).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${rule}: ${count}`);
  }
  lines.push('');
  lines.push('## Details');
  lines.push('');
  const grouped = groupBy(findings, 'rule');
  for (const [rule, group] of Object.entries(grouped).sort((a, b) => severityRank(b[1][0].severity) - severityRank(a[1][0].severity) || a[0].localeCompare(b[0]))) {
    const first = group[0];
    lines.push(`### ${rule} (${group.length})`);
    lines.push('');
    lines.push(`Severity: **${first.severity}**`);
    lines.push(`Recommendation: ${first.recommendation}`);
    lines.push('');
    for (const item of group.slice(0, maxSamples)) {
      lines.push(`- \`${item.file}:${item.line || 1}\` — ${item.message}`);
    }
    if (group.length > maxSamples) lines.push(`- ...and ${group.length - maxSamples} more.`);
    lines.push('');
  }
  return lines.join('\n');
}

function groupBy(items, key) {
  const out = {};
  for (const item of items) {
    (out[item[key]] ||= []).push(item);
  }
  return out;
}

function severityRank(severity) {
  return { action: 3, review: 2, info: 1 }[severity] || 0;
}
