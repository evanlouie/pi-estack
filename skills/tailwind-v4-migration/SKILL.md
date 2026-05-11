---
name: tailwind-v4-migration
description: Use this skill when migrating, upgrading, auditing, or troubleshooting a Tailwind CSS project from v3.x to v4.x. Applies to CSS-first configuration, @theme/@utility/@source directives, PostCSS/Vite/CLI setup changes, class rename codemods, legacy tailwind.config.js bridging, framework-specific @apply issues, safelisting, and v4 breaking-change validation.
license: MIT
compatibility: Requires project file access, git for safe diffs, and Node.js 20+ for the official Tailwind upgrade tool.
metadata:
  version: "1.0.0"
  category: frontend-migration
---

# Tailwind CSS v3.x to v4.x migration

Use this skill to move an existing Tailwind CSS v3.x codebase to v4.x safely.
Treat the migration as a source-controlled refactor: audit first, run the
official upgrade tool where possible, apply manual fixes, validate the build,
then report the remaining risk areas.

## Default workflow

1. **Establish a safe baseline**
   - Check `git status --short`. Do not mix migration changes with unrelated
     edits.
   - Identify the package manager from lockfiles and scripts.
   - Check `node --version`; the official Tailwind upgrade tool requires Node.js
     20+.
   - Identify Tailwind entry CSS files, `tailwind.config.*`, PostCSS/Vite
     configs, package scripts, component file types, and browser support
     requirements.
   - Run the audit script before changing files. Run all skill scripts from this
     skill's directory (do not `cd` into the target project) and pass the target
     with `--project`:
     ```bash
     deno run --allow-read scripts/audit_tailwind_v4_migration.ts --project /path/to/project --format markdown > /path/to/project/tailwind-v4-audit.md
     ```

2. **Choose ONE rename strategy: official upgrade tool OR the codemod script
   (not both)**

   These two approaches are mutually exclusive for deterministic class renames.
   Running the codemod after the official upgrade tool can double-apply renames
   (e.g., `shadow-sm` → `shadow-xs` on the first pass, then `shadow-xs` would be
   untouched but `shadow` → `shadow-sm` could re-shift already-correct classes,
   and similar chains for `rounded`, `blur`, `drop-shadow`, `backdrop-blur`).
   Pick exactly one of the following:

   **Option A (preferred): Official upgrade tool.** Use this when the project
   meets the tool's requirements (Node.js 20+, clean branch, supported framework
   layout).
   - Use a clean branch.
   - Run the package-manager equivalent of:
     ```bash
     npx @tailwindcss/upgrade
     ```
   - Review the entire diff. The tool can update dependencies, migrate
     configuration to CSS, and rewrite many template classes, but complex
     projects still need manual review.
   - **Do NOT run `scripts/replace_tailwind_v4_renames.ts` afterward.** The
     official tool has already applied these renames.

   **Option B (alternative): Deterministic codemod script.** Use this only when
   (a) the official upgrade tool was NOT used (e.g., it failed, is incompatible,
   or the project requires a manual path), or (b) you are running it on a fresh
   v3 baseline that has not yet had any v4 rename pass applied.
   - Confirm the project is on a clean migration branch.
   - Dry-run first:
     ```bash
     deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts --project /path/to/project --dry-run
     ```
   - Only use `--write` after reviewing the preview.

3. **Manual migration pass (always required)**
   - Replace v3 CSS entry directives with `@import "tailwindcss";`.
   - Update build integration:
     - PostCSS: use `@tailwindcss/postcss`, not `tailwindcss` as the PostCSS
       plugin.
     - Vite: prefer `@tailwindcss/vite`.
     - CLI: use `@tailwindcss/cli`.
   - Convert or bridge `tailwind.config.*`:
     - Prefer CSS-first config using `@theme`, `@utility`, `@custom-variant`,
       `@source`, and `@plugin` where appropriate.
     - Use `@config "../../tailwind.config.js";` as a temporary bridge only when
       needed.
     - Do not rely on `corePlugins`, `safelist`, or `separator` in a JS config;
       they are not supported in v4.

4. **Manual visual and behavioral review**
   - Inspect all findings in `tailwind-v4-audit.md`.
   - Pay special attention to border/ring defaults, `space-x-*`/`space-y-*`,
     Preflight differences, hover behavior on touch devices, dynamic class
     names, Sass/Less/Stylus usage, and `@apply` in Vue/Svelte/Astro/CSS
     modules.
   - Convert dynamic class construction to static maps or safelist with
     `@source inline()`.

5. **Validate**
   - Run the project’s typecheck, lint, tests, and production build.
   - Run the app in a browser and compare key screens against v3, especially
     forms, dialogs, focus rings, borders, spacing stacks, dark mode, responsive
     breakpoints, plugin-generated styles, and components using `@apply`.
   - Re-run the audit and resolve or explicitly document remaining findings.

6. **Report**
   - Summarize dependency/build changes, CSS config changes, automated codemod
     changes, manual fixes, validation commands/results, and remaining risks.
   - Include the generated audit file path and a short “watch list” for QA.

## When to read reference files

- Read `references/MIGRATION_CHECKLIST.md` for the full step-by-step process.
- Read `references/V4_BREAKING_CHANGES.md` before making manual class or CSS
  behavior changes.
- Read `references/CSS_CONFIG_REFERENCE.md` when converting `tailwind.config.*`
  to CSS-first configuration.
- Read `references/FRAMEWORK_NOTES.md` when the project uses Vite, PostCSS, CLI
  builds, Vue, Svelte, Astro, CSS modules, Sass, Less, Stylus, a monorepo, or
  third-party Tailwind component packages.
- Read `references/TROUBLESHOOTING.md` when the v4 build fails or utilities are
  missing.
- `references/SOURCES.md` exists for citation purposes; read it when you need to
  cite or link to the upstream Tailwind v4 documentation referenced by the other
  files in this skill.

## Available scripts

- `scripts/audit_tailwind_v4_migration.ts` — scans a project and reports likely
  v3-to-v4 migration issues. It does not modify files.
- `scripts/replace_tailwind_v4_renames.ts` — performs a conservative dry-run or
  write-mode rewrite of deterministic class renames. It intentionally skips
  changes that require design judgment. **Do not run this after
  `npx @tailwindcss/upgrade`** — see Step 2.

## Gotchas to keep in memory

- Tailwind v4 targets modern browsers. If the project must support browsers
  older than Safari 16.4, Chrome 111, or Firefox 128, do not proceed without
  documenting that v3.4 may be required.
- v4 no longer auto-detects JavaScript config files. Add `@config` only as an
  explicit bridge, then gradually move supported theme/config values into CSS.
- In v4, `@theme` variables define which token-driven utilities exist. Plain
  `:root` variables do not create utilities.
- The `@layer utilities`/`@layer components` pattern no longer registers
  variant-aware utilities. Use `@utility` for custom utilities that need
  variants.
- `@apply` inside separately bundled stylesheets needs `@reference` to import
  theme variables/custom utilities without duplicating CSS.
- The official upgrade tool and codemod scripts do not replace judgment. Always
  review diffs and run the app.
