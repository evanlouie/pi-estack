---
name: tailwind-css-v4
description: >-
  Use this skill when installing, upgrading, configuring, debugging, or writing code for Tailwind CSS v4.x projects. Prefer CSS-first v4 patterns such as @import "tailwindcss", @theme, @utility, @source, @custom-variant, and @reference; use it for v3-to-v4 migrations, build errors, Vite/PostCSS/CLI setup, theme tokens, variants, dark mode, and utility-class correctness.
license: MIT
compatibility: Tailwind CSS v4.x; Bun is required only for the optional bundled audit script; Node.js/npm, pnpm, yarn, or Bun project commands depend on the target project.
metadata:
  version: "1.0.4"
  tailwind_major: "4"
  author: "OpenAI"
---

# Tailwind CSS v4.x

## When to use this skill

Use this skill for tasks involving Tailwind CSS v4.x setup, migration, styling, design tokens, CSS-first configuration, source scanning, custom utilities, variants, dark mode, or build/runtime errors. Also use it when the user asks about Tailwind v4 specifically, upgrades from v3, or symptoms caused by mixing v3 and v4 APIs.

Do not use this skill for generic CSS questions that do not involve Tailwind, or for Tailwind v3-only projects unless the task is migration to v4.

## Core workflow

1. Identify the project context before changing files: package manager, framework, build tool, CSS entry point, existing `tailwind.config.*`, `postcss.config.*`, `vite.config.*`, and `package.json` scripts.
2. Prefer the official v4 CSS-first model. Put most Tailwind configuration in the stylesheet that imports Tailwind, not in `tailwind.config.js`.
3. Choose the integration path based on the project:
   - Vite projects: use `tailwindcss` plus `@tailwindcss/vite`.
   - PostCSS projects such as many Next.js or Angular setups: use `tailwindcss`, `@tailwindcss/postcss`, and `postcss`.
   - Static or minimal projects: use `tailwindcss` plus `@tailwindcss/cli`.
4. Use the existing project package manager and lockfile style. Do not mix npm, pnpm, yarn, or bun unless the user asks; the bundled audit script runs with Bun separately and should not change the target project package manager.
5. After edits, run the smallest relevant validation command available: a build, typecheck, lint, or framework dev/build command. If running commands is not appropriate, tell the user exactly what to run.
6. For exact package versions or latest minor-release features, verify current Tailwind docs or release notes because v4.x evolves.

## v4 defaults to prefer

Use these patterns unless the project has a clear reason not to:

```css
@import "tailwindcss";
```

```css
@theme {
  --color-brand-500: oklch(0.62 0.18 260);
  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
  --breakpoint-3xl: 120rem;
}
```

```css
@utility content-auto {
  content-visibility: auto;
}
```

```css
@custom-variant dark (&:where(.dark, .dark *));
```

```css
@source "../node_modules/@acme/ui";
@source inline("{hover:,focus:,}bg-brand-{500,600}");
```

```css
@reference "../../app.css";
```

## Common v3 patterns to avoid in v4

Do not introduce these unless preserving backward compatibility temporarily:

- `@tailwind base;`, `@tailwind components;`, or `@tailwind utilities;`
- `npx tailwindcss init`
- `npx tailwindcss -i input.css -o output.css` instead of `npx @tailwindcss/cli -i input.css -o output.css`
- `tailwindcss` as a PostCSS plugin instead of `@tailwindcss/postcss`
- assuming a `content` array or `tailwind.config.js` is required
- `safelist` in JavaScript config instead of `@source inline()`
- dynamic utility fragments such as `bg-${color}-500`; map props to complete static class strings instead

## Installation snippets

Vite:

```bash
npm install tailwindcss @tailwindcss/vite
```

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

PostCSS:

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

CLI:

```bash
npm install tailwindcss @tailwindcss/cli
npx @tailwindcss/cli -i ./src/input.css -o ./src/output.css --watch
```

## Migration guidance

When upgrading from v3, first consider the official upgrade tool:

```bash
npx @tailwindcss/upgrade
```

Then review the generated changes. Pay special attention to browser support, CSS entry points, package split, removed/renamed utilities, default border/ring changes, prefixes, important modifier placement, variant stacking order, CSS variable arbitrary values, and `@apply` usage in Vue/Svelte/Astro/CSS modules.

Read `references/migration-checklist.md` for the detailed v3-to-v4 migration checklist.

## Project auditing

An optional non-destructive self-contained ESM Bun helper script is bundled:

```bash
bun run scripts/audit-tailwind-v4.ts /path/to/project
bun run scripts/audit-tailwind-v4.ts /path/to/project --json
```

Use it when debugging or migrating an existing project. Treat its findings as heuristics, not a replacement for reading the relevant files.

## Reference files

- Read `references/v4-patterns.md` when writing or explaining Tailwind v4 CSS-first configuration.
- Read `references/migration-checklist.md` when upgrading from v3 or fixing mixed v3/v4 code.
- Read `references/troubleshooting.md` when resolving install/build errors or missing utilities.
- Read `references/design-system-examples.md` when creating theme tokens, custom variants, or reusable component utilities.
