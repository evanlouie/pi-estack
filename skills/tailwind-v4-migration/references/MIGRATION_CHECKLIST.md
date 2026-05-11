# Tailwind CSS v3.x → v4.x migration checklist

Use this as the operational checklist after the skill activates.

## 0. Migration readiness

- Confirm browser support. Tailwind v4 is for modern browsers: Safari 16.4+,
  Chrome 111+, and Firefox 128+. If the product must support older browsers,
  document the risk and consider staying on v3.4.
- Confirm the workspace has a clean migration branch.
- Confirm Node.js 20+ before using `npx @tailwindcss/upgrade`.
- Identify package manager from lockfiles:
  - `pnpm-lock.yaml` → `pnpm`
  - `yarn.lock` → `yarn`
  - `bun.lock` or `bun.lockb` → `bun`
  - `deno.lock` → `deno`
  - `package-lock.json` → `npm`
- Find Tailwind entry CSS files, `tailwind.config.*`, PostCSS/Vite configs, CLI
  scripts, and framework files using `@apply`.

## 1. Audit before changes

From the skill directory:

```bash
deno run --allow-read scripts/audit_tailwind_v4_migration.ts --project /path/to/project --format markdown > /path/to/project/tailwind-v4-audit.md
```

Use this audit to plan manual work. The script flags likely issues; it is not a
substitute for building and viewing the app.

## 2. Run the official upgrade tool when possible

Use a clean branch:

```bash
npx @tailwindcss/upgrade
```

For non-npm package managers, use the local equivalent only if that is normal
for the project, such as `pnpm dlx @tailwindcss/upgrade`,
`yarn dlx @tailwindcss/upgrade`, or `bunx @tailwindcss/upgrade`.

After running:

```bash
git status --short
git diff -- package.json pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb deno.lock
git diff -- '*.css' '*.scss' '*.sass' '*.less' '*.styl' '*.js' '*.jsx' '*.ts' '*.tsx' '*.vue' '*.svelte' '*.astro'
```

## 3. Manual dependency/build migration

### PostCSS

v3 commonly used `tailwindcss` directly as a PostCSS plugin. v4 uses
`@tailwindcss/postcss`.

Before:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

After:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Remove `autoprefixer` and `postcss-import` only if they were present solely for
Tailwind processing.

### Vite

Prefer the v4 Vite plugin:

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

If the project already has framework plugins, keep them and add `tailwindcss()`
according to the framework’s ordering expectations.

### CLI

v4 CLI lives in `@tailwindcss/cli`:

```bash
npx @tailwindcss/cli -i input.css -o output.css
```

Update package scripts that call `tailwindcss` directly.

## 4. Manual CSS entry migration

Before:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

After:

```css
@import "tailwindcss";
```

If the build runs from a monorepo root and automatic source detection is too
broad or too narrow, set the source base explicitly:

```css
@import "tailwindcss" source("../src");
```

## 5. Config migration strategy

Use `references/CSS_CONFIG_REFERENCE.md` for details.

Default approach:

1. Move token-like values from `theme`/`theme.extend` to `@theme`.
2. Convert custom variant behavior to `@custom-variant`.
3. Convert custom utilities that need variants to `@utility`.
4. Register ignored sources with `@source`.
5. Use `@plugin` for legacy JS plugins only when needed.
6. Use `@config` only as a temporary bridge for legacy config that cannot be
   migrated immediately.

Do not rely on these JS config options in v4:

- `corePlugins`
- `safelist`
- `separator`

For safelisting, use statically detectable full class names or
`@source inline()`.

## 6. Deterministic codemod pass

Dry run:

```bash
deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts --project /path/to/project --dry-run
```

Write mode only on a migration branch:

```bash
deno run --allow-read --allow-write scripts/replace_tailwind_v4_renames.ts --project /path/to/project --write
```

Then review:

```bash
git diff
```

The codemod intentionally does not rewrite opacity utilities, dynamic classes,
`border` color assumptions, or layout behavior changes because those require
design judgment.

## 7. Manual class and behavior fixes

Use `references/V4_BREAKING_CHANGES.md`. Prioritize:

- Removed deprecated utilities such as `bg-opacity-*`.
- Renamed visual scales such as `shadow-sm` → `shadow-xs`.
- `outline-none` → `outline-hidden` when preserving v3 behavior.
- `ring` → `ring-3` plus explicit ring color when the v3 default matters.
- `border`/`divide` utilities that relied on default gray-200.
- `hover:` behavior on touch devices.
- `transform-none` resets.
- `transition-[...,transform,...]` utility lists.
- Dynamic class construction.

## 8. Framework/module review

Use `references/FRAMEWORK_NOTES.md` for framework-specific notes. Common checks:

- Vue/Svelte/Astro/CSS modules with `@apply` need `@reference`.
- Sass/Less/Stylus should not be used as the Tailwind entry path in v4.
- External UI packages ignored by automatic detection need `@source`.
- Monorepo builds may need `source()` or `source(none)` plus explicit `@source`
  paths.

## 9. Validation commands

Use the project’s own scripts. Typical sequence:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Adapt for `pnpm`, `yarn`, `bun`, or `deno`.

Also run a browser review for:

- Home page and common layout shells.
- Forms, focus rings, validation states, placeholders, buttons, dialogs.
- Dark mode and themed surfaces.
- Responsive breakpoints.
- Pages using dynamic class maps or CMS-driven classes.
- Component libraries and plugin-generated styles.

## 10. Final migration report template

```markdown
# Tailwind v4 migration report

## Summary

- Migration status:
- Branch/commit:
- Tailwind version:
- Build integration:

## Changed

- Dependencies:
- CSS entry/config:
- Class/codemod updates:
- Framework-specific fixes:

## Validation

- Commands run:
- Browser routes/screens checked:
- Result:

## Remaining risks

- Risk 1:
- Risk 2:

## Files to review

- tailwind-v4-audit.md
- package/config diffs
- CSS entry/config files
```
