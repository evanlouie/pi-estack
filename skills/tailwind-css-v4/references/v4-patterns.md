# Tailwind CSS v4.x patterns

## Integration paths

Use the integration that matches the project rather than adding every package.

### Vite

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

### CLI

```bash
npm install tailwindcss @tailwindcss/cli
npx @tailwindcss/cli -i ./src/input.css -o ./src/output.css --watch
```

## CSS entry point

Tailwind v4 is imported like a normal CSS file:

```css
@import "tailwindcss";
```

Avoid old v3 directives in new v4 work:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Theme variables

Use `@theme` for design tokens that should generate Tailwind utilities or variants. Use ordinary CSS variables such as `:root` for variables that should not create utility classes.

```css
@import "tailwindcss";

@theme {
  --color-brand-50: oklch(0.97 0.02 260);
  --color-brand-500: oklch(0.62 0.18 260);
  --color-brand-700: oklch(0.48 0.16 260);
  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
  --breakpoint-3xl: 120rem;
  --ease-spring: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

Typical namespaces include `--color-*`, `--font-*`, `--text-*`, `--font-weight-*`, `--tracking-*`, `--leading-*`, `--breakpoint-*`, `--spacing`, `--radius-*`, `--shadow-*`, `--ease-*`, `--animate-*`, and container-related namespaces.

## Source detection

Tailwind v4 automatically scans source files and ignores common build/dependency paths. Use `@source` when automatic detection misses files or when working in monorepos.

```css
@import "tailwindcss" source("../src");
@source "../node_modules/@acme/ui";
@source not "../src/legacy";
```

Disable automatic scanning only when deliberately managing every source:

```css
@import "tailwindcss" source(none);
@source "../app";
@source "../shared";
```

Safelist generated utilities with `@source inline()`:

```css
@source inline("{hover:,focus:,}bg-brand-{500,600}");
@source inline("grid-cols-{1..12}");
```

## Custom utilities

Use `@utility` instead of relying on `@layer utilities` for variant-aware custom utilities.

```css
@utility content-auto {
  content-visibility: auto;
}

@utility btn {
  border-radius: var(--radius-lg);
  padding-inline: --spacing(4);
  padding-block: --spacing(2);
  font-weight: var(--font-weight-medium);
}
```

## Variants

Use `@custom-variant` to define a reusable variant and `@variant` to apply a Tailwind variant inside CSS.

```css
@custom-variant dark (&:where(.dark, .dark *));
@custom-variant theme-midnight (&:where([data-theme="midnight"], [data-theme="midnight"] *));

.card {
  background: white;
  @variant dark {
    background: black;
  }
}
```

Use only `@variant` syntax documented for the installed Tailwind minor version; verify current docs before relying on minor-release-specific syntax.

## Component styles and modules

When using `@apply` or `@variant` in a stylesheet that is bundled separately from the main stylesheet, import definitions for reference without duplicating CSS:

```css
@reference "../../app.css";

.title {
  @apply text-2xl font-bold text-brand-700;
}
```

This is common in Vue, Svelte, Astro, and CSS modules. For simple styles, prefer direct CSS variables over `@apply` to avoid unnecessary processing.

## Dynamic class names

Tailwind scans files as text, so class names must exist as complete strings.

Bad:

```tsx
<button className={`bg-${color}-600 hover:bg-${color}-500`}>Save</button>
```

Good:

```tsx
const variants = {
  blue: "bg-blue-600 hover:bg-blue-500 text-white",
  red: "bg-red-600 hover:bg-red-500 text-white",
  neutral: "bg-zinc-100 hover:bg-zinc-200 text-zinc-950",
};

<button className={`${variants[color]} rounded-lg px-4 py-2`}>Save</button>
```

## Legacy compatibility

`@config` can load a JavaScript config file and `@plugin` can load legacy plugins, but use them as migration aids. CSS-defined `@theme`, `@utility`, and variant definitions should be preferred and will take precedence where merged.

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
@plugin "@tailwindcss/typography";
```
