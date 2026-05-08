# Tailwind CSS v3 to v4 Migration Guide

## Version scope

This guide covers the v4 family through v4.2. Tailwind CSS v4.0 was the architectural migration. v4.1 and v4.2 add utilities, variants, source controls, compatibility improvements, framework integrations, and patch fixes.

## Preflight checklist

Before editing:

- Confirm versions in `package.json` and the lockfile.
- Identify integration: Vite, PostCSS, CLI, webpack, framework plugin, or a meta-framework wrapper.
- Locate CSS entry files and any `tailwind.config.{js,cjs,mjs,ts}`.
- Search for deprecated v3 utilities and visual-risk classes:
  - opacity utilities like `bg-opacity-*`
  - `flex-shrink-*`, `flex-grow-*`, `overflow-ellipsis`
  - `shadow`, `shadow-sm`, `rounded`, `rounded-sm`, `blur`, `blur-sm`, `outline-none`, bare `ring`
  - `space-x-*`, `space-y-*`, `divide-x-*`, `divide-y-*`
  - custom `@layer utilities` or `@layer components`
  - `@apply` inside CSS modules, Vue, Svelte, Astro, or component-scoped styles
- Prefer the official upgrade tool on a clean branch:

```bash
npx @tailwindcss/upgrade@latest
```

Then review and test rather than assuming the migration is complete.

## Browser target change

Tailwind CSS v4.0 targets modern browsers: Safari 16.4+, Chrome 111+, and Firefox 128+. It depends on modern CSS features such as `@property` and `color-mix()`. If a project must support older browsers, consider staying on Tailwind CSS v3.4 unless the project has validated an acceptable compatibility strategy. v4.1 included some older Safari and Firefox compatibility improvements, but the official v4 browser target remains modern browsers.

## Installation and build pipeline changes

### CSS entrypoint

v3:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

v4:

```css
@import "tailwindcss";
```

v4 has built-in import support and automatic vendor prefixing through its pipeline. In many PostCSS projects, `postcss-import` and `autoprefixer` can be removed when they are only present for Tailwind.

### Vite

Preferred v4 integration for Vite:

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

### PostCSS

The PostCSS plugin moved out of the `tailwindcss` package:

```bash
npm install tailwindcss @tailwindcss/postcss
```

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Do not configure `tailwindcss: {}` as the PostCSS plugin for v4.

### CLI

The CLI moved to `@tailwindcss/cli`:

```bash
npm install tailwindcss @tailwindcss/cli
npx @tailwindcss/cli -i input.css -o output.css --watch
```

### webpack

Tailwind CSS v4.2 adds `@tailwindcss/webpack`, a first-party webpack plugin. Prefer that for webpack projects on v4.2+ when it fits the existing build architecture; otherwise use the PostCSS integration (`@tailwindcss/postcss`) with the existing webpack/PostCSS pipeline.

## CSS-first configuration

v4 is designed around CSS variables and CSS directives.

### Theme tokens

v3:

```js
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          500: "#3b82f6",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
};
```

v4:

```css
@import "tailwindcss";

@theme {
  --color-brand-500: #3b82f6;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

Common token namespaces:

- `--color-*` for colors and color utilities.
- `--font-*` for font families.
- `--text-*` for font sizes.
- `--spacing-*` and `--breakpoint-*` for spacing and responsive scales.
- `--shadow-*`, `--radius-*`, `--blur-*`, `--animate-*`, and similar namespaces for utility families.

Use CSS variables directly in JS instead of `resolveConfig`, which was removed in v4:

```js
const styles = getComputedStyle(document.documentElement);
const shadow = styles.getPropertyValue("--shadow-xl");
```

### Legacy JavaScript config support

JavaScript config files are still supported for backward compatibility but are not detected automatically. Load them explicitly:

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
```

Limitations: `corePlugins`, `safelist`, and `separator` from JavaScript config are not supported in v4. CSS-defined configuration takes precedence when it overlaps with a loaded JavaScript config. Use CSS-first alternatives, especially `@source inline(...)` for safelisting.

### Plugins

Legacy plugins can be loaded in CSS:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

Prefer native v4 CSS features for new work when possible.

### Custom variants

Use `@custom-variant` to define project variants. Use `@variant` when applying an existing Tailwind variant inside CSS. Example class-based dark mode:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

```css
.card {
  @variant hover {
    box-shadow: var(--shadow-lg);
  }
}
```

### Custom utilities

In v3, custom classes inside `@layer utilities` and `@layer components` were treated as Tailwind utilities and worked with variants. In v4, native cascade layers are used and Tailwind no longer hijacks `@layer`. Use `@utility` when a custom class should behave like a utility:

```css
@utility tab-4 {
  tab-size: 4;
}

@utility btn {
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: ButtonFace;
}
```

`@utility` definitions must be top-level; do not nest them inside selectors or other at-rules. Custom utilities are sorted by the amount of properties they define, which helps regular utilities override component-like utilities.

## Content detection and sources

v4 has automatic content detection and ignores common generated/dependency directories. Add `@source` when automatic detection misses files, or when classes live in a dependency package.

```css
@import "tailwindcss";
@source "../node_modules/@acme/ui-components";
@source "../packages/shared";
```

Use `source(none)` on the import only when you want to disable automatic detection and list every source explicitly:

```css
@import "tailwindcss" source(none);
@source "../admin";
@source "../shared";
```

v4.1 adds better controls:

```css
@source not "../src/generated";
@source inline("underline");
@source not inline("container");
```

Use `@source inline(...)` instead of the v3 `safelist` option. Brace expansion can express groups of generated class names, for example a color range and variants:

```css
@source inline("{hover:,focus:,}bg-red-{50,{100..900..100},950}");
```

## `@apply` in component-scoped CSS

In v4, stylesheets processed separately from the main CSS entrypoint do not automatically see theme variables, custom utilities, or custom variants defined elsewhere. This affects CSS modules and `<style>` blocks in Vue, Svelte, Astro, and similar tools.

Use `@reference` to import definitions without duplicating CSS output. Reference the app CSS file when you need project customizations; use `@reference "tailwindcss";` only when the stylesheet needs the default Tailwind theme and no project-specific tokens, utilities, or variants.

```css
@reference "../../app.css";

.title {
  @apply text-2xl font-bold text-red-500;
}
```

For simple values, prefer direct CSS variables because they avoid Tailwind processing:

```css
.title {
  color: var(--color-red-500);
}
```

Replace most `theme(path.to.value)` usages with CSS variables, e.g. `theme(colors.red.500)` → `var(--color-red-500)`. In media queries, use Tailwind's theme variable function form such as `theme(--breakpoint-xl)` when you need a configured breakpoint value.

Tailwind CSS v4 is not designed to be combined with Sass, Less, or Stylus as the stylesheet language processed by Tailwind. Treat Tailwind as the CSS preprocessor.

## Breaking-change review list

### Removed `@tailwind` directives

Use `@import "tailwindcss";` instead of `@tailwind base/components/utilities`.

### Removed deprecated utilities

Replace old v3 deprecated utilities with modern equivalents. See `class-and-config-mapping.md`.

### Renamed utility scales

Shadow, drop-shadow, blur, backdrop-blur, rounded, outline, and ring scales changed or were renamed. The bare forms often still work for compatibility, but may look different; prefer explicit v4 names.

### Default border and divide color

In v3, `border-*` and `divide-*` used configured `gray-200` by default. In v4 they use `currentColor`. Specify a color, e.g. `border border-gray-200`, or add a compatibility base layer while migrating.

### Default ring width and color

Bare `ring` changed from `3px` blue-500 to `1px` currentColor. Replace `ring` with `ring-3` and add `ring-blue-500` anywhere the old default mattered, or temporarily set compatibility theme variables.

### Placeholder color

Placeholders now use current text color at 50% opacity instead of defaulting to gray-400. Add explicit `placeholder:*` utilities or a compatibility base layer.

### Preflight differences

- Buttons use `cursor: default` instead of `cursor: pointer`.
- Dialog margins are reset; add `dialog { margin: auto; }` if old centering was relied on.
- The `hidden` attribute now takes priority over display classes like `block` or `flex`.

### Prefix syntax

Configure a prefix with `prefix(...)` on the import. Prefixes now behave like variants and go at the beginning of the class:

```css
@import "tailwindcss" prefix(tw);
```

```html
<div class="tw:flex tw:bg-red-500 tw:hover:bg-red-600"></div>
```

Theme variables are configured without the prefix.

### Important modifier placement

The important modifier moved to the end of the utility in v4. Replace leading `!` classes with trailing `!` classes:

```html
<!-- v3 style -->
<div class="!mt-4 hover:!bg-red-500"></div>

<!-- v4 style -->
<div class="mt-4! hover:bg-red-500!"></div>
```

### Variant stacking order

v3 applied stacked variants right-to-left. v4 applies them left-to-right, matching CSS syntax. Reverse order-sensitive stacks, especially when using `*` direct-child variants or typography plugin variants.

```html
<!-- v3 style -->
<ul class="py-4 first:*:pt-0 last:*:pb-0"></ul>

<!-- v4 style -->
<ul class="py-4 *:first:pt-0 *:last:pb-0"></ul>
```

### CSS variables in arbitrary values

v3 allowed `bg-[--brand-color]`. v4 uses parentheses for CSS variable shorthand:

```html
<div class="bg-(--brand-color)"></div>
```

Explicit `var(...)` in square brackets remains fine when the syntax is unambiguous:

```html
<div class="bg-[var(--brand-color)]"></div>
```

### Arbitrary grid/object values

Commas are no longer converted to spaces for arbitrary grid and object-position values. Use underscores for spaces:

```html
<div class="grid-cols-[max-content_auto]"></div>
```

### Hover on touch devices

The `hover` variant now applies only when the primary input device supports hover:

```css
@media (hover: hover) { /* generated hover styles */ }
```

If a site depends on tap-triggered hover behavior, redesign the interaction or deliberately restore old behavior:

```css
@custom-variant hover (&:hover);
```

### Space and divide selectors

`space-x-*`, `space-y-*`, `divide-x-*`, and `divide-y-*` use a different selector for performance and now target non-last children. If layout changes, prefer flex/grid with `gap` for spacing and explicit borders for dividers.

### Gradients

In v4, overriding part of a gradient in a variant preserves the rest of the gradient instead of resetting the whole gradient. Use `via-none` or explicit `from`/`via`/`to` values when a variant should remove a gradient stop.

### Transforms and transitions

`transform-none` no longer resets individual `rotate`, `scale`, or `translate` utilities. Remove or override those individual utilities when you need to reset them.

When transitioning transforms, prefer individual transition properties/classes that match v4's separate `rotate`/`scale`/`translate` behavior instead of assuming one legacy `transform` transition covers every case.

### Outline-color transitions

`transition` and `transition-colors` include `outline-color` in v4. Components that previously relied on browser/default outline colors may animate or render differently. During visual review, check focus states and set an explicit outline color where needed, for example `outline-blue-500` or project-specific focus-ring tokens.

### Container configuration

The v3 `container` config options like `center` and `padding` do not exist in v4. Customize the utility with `@utility`:

```css
@utility container {
  margin-inline: auto;
  padding-inline: 2rem;
}
```
