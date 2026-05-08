---
name: tailwind-css-v4
description: Guidance and documentation for Tailwind CSS v4, v4.1, and v4.2, especially migrations from Tailwind CSS v3. Use when upgrading Tailwind, reviewing v3-to-v4 breaking changes, converting tailwind.config.js to CSS-first @theme/@utility/@custom-variant/@variant APIs, configuring Vite/PostCSS/CLI/webpack integrations, safelisting or source detection with @source, debugging v4 visual regressions, or explaining v4.1/v4.2 utilities and compatibility changes.
---

# Tailwind CSS v4 Migration and Documentation

Use this skill when a user asks about Tailwind CSS v4, v4.1, v4.2, or migrating a project from Tailwind CSS v3.

## Core stance

- Treat v4 as a CSS-first framework: prefer `@import "tailwindcss"`, `@theme`, `@utility`, `@variant`, `@custom-variant`, `@source`, `@plugin`, `@config`, and `@reference` over v3-style JavaScript configuration.
- For v3 upgrades, recommend a clean git branch and the official upgrade tool first, then manual review for visual regressions.
- Always verify the project's actual installed version from `package.json` and lockfiles before giving version-specific advice.
- Do not assume v3 behavior still applies. In v4, defaults for borders, rings, placeholders, hover behavior, stacking order, spacing selectors, gradient preservation, transform/reset behavior, important modifier placement, transitions/focus outlines, and several class names changed.
- If precise patch-level behavior matters, consult the official changelog because v4.1 and v4.2 have many patch fixes around scanning, canonicalization, and framework integrations.

## Quick upgrade commands

```bash
# Automated v3 -> v4 upgrade. Run on a clean branch and review the diff.
npx @tailwindcss/upgrade@latest

# Vite integration, preferred when the project uses Vite.
npm install tailwindcss @tailwindcss/vite

# PostCSS integration, when the app's build pipeline is PostCSS-based.
npm install tailwindcss @tailwindcss/postcss

# CLI integration, because the CLI moved to a separate package in v4.
npm install tailwindcss @tailwindcss/cli
```

Minimal v4 CSS entry point:

```css
@import "tailwindcss";
```

Minimal Vite setup:

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Minimal PostCSS setup:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

## Documentation map

Read the reference files as needed:

- `references/v3-to-v4-migration.md` — migration workflow, install changes, CSS-first configuration, source detection, `@apply`, legacy config support, and breaking changes.
- `references/class-and-config-mapping.md` — quick v3-to-v4 class/config mappings and compatibility snippets.
- `references/v4-1-and-v4-2.md` — version-specific features added in v4.1 and v4.2.

## Common answer pattern

When helping with a migration:

1. Identify current Tailwind version, build tool, framework, CSS entrypoint, and whether `tailwind.config.*` exists.
2. Recommend the upgrade tool unless the user needs a manual migration or minimal change set.
3. Update integration packages: Vite uses `@tailwindcss/vite`; PostCSS uses `@tailwindcss/postcss`; CLI uses `@tailwindcss/cli`; webpack can use `@tailwindcss/webpack` in v4.2+.
4. Replace `@tailwind base; @tailwind components; @tailwind utilities;` with `@import "tailwindcss";`.
5. Move theme tokens from `tailwind.config.*` to `@theme` where practical.
6. Replace custom classes in `@layer utilities/components` that need variants with `@utility`.
7. Add explicit `@source` rules for files automatic detection misses; use `@source inline(...)` for safelisting in v4.1+ and `@import "tailwindcss" source(none);` only when every source is listed explicitly.
8. Review renamed/removed utilities and visual defaults: border, ring, placeholder, shadow/radius/blur scales, hover, variant stacking, spacing/divide selectors, gradients, transform resets, important modifiers, outline-color transitions, and preflight.
9. Run the app and use visual regression review for pages heavy on forms, borders, focus rings, dialogs, gradients, custom utilities, and mobile hover behavior.

## Official references

- Upgrade guide: https://tailwindcss.com/docs/upgrade-guide
- v4.0 announcement: https://tailwindcss.com/blog/tailwindcss-v4
- v4.1 announcement: https://tailwindcss.com/blog/tailwindcss-v4-1
- Functions and directives: https://tailwindcss.com/docs/functions-and-directives
- Detecting classes in source files: https://tailwindcss.com/docs/detecting-classes-in-source-files
- Changelog: https://github.com/tailwindlabs/tailwindcss/blob/main/CHANGELOG.md
- GitHub releases: https://github.com/tailwindlabs/tailwindcss/releases
