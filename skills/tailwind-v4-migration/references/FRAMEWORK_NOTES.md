# Framework and build-tool notes for Tailwind v4 migrations

Use these notes when the migration involves framework-specific build integration or component-level styles.

## Vite

Preferred v4 setup:

```ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Keep existing framework plugins. Example:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Validation:

- Confirm the main CSS file contains `@import "tailwindcss";`.
- Confirm the CSS entry is imported by the app, such as in `src/main.tsx` or `src/main.ts`.
- Run the dev server and production build because class detection and bundling can differ.

## PostCSS

Preferred v4 setup:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Remove these only if they were installed solely for Tailwind:

- `autoprefixer`
- `postcss-import`

If the project uses those plugins for non-Tailwind CSS, keep them and verify ordering.

## Tailwind CLI

Install/use `@tailwindcss/cli`:

```bash
npx @tailwindcss/cli -i ./src/input.css -o ./dist/output.css --watch
```

Update package scripts. Before:

```json
{
  "scripts": {
    "build:css": "tailwindcss -i ./src/input.css -o ./dist/output.css"
  }
}
```

After:

```json
{
  "scripts": {
    "build:css": "tailwindcss -i ./src/input.css -o ./dist/output.css"
  },
  "devDependencies": {
    "@tailwindcss/cli": "latest",
    "tailwindcss": "latest"
  }
}
```

The binary may still be called `tailwindcss`, but the package providing it is `@tailwindcss/cli` in v4. When using one-off commands, be explicit:

```bash
npx @tailwindcss/cli -i ./src/input.css -o ./dist/output.css
```

## Next.js

Tailwind v4 can be integrated through PostCSS. Check:

- `app/globals.css` or the global CSS entry has `@import "tailwindcss";`.
- `postcss.config.*` uses `@tailwindcss/postcss`.
- CSS modules using `@apply` include `@reference` or avoid `@apply`.
- Server-rendered dynamic class names are full static strings, not interpolated fragments.

For app-router projects, validate both server and client components because class strings often live in shared component utilities.

## Vue

`@apply` inside component `<style>` blocks needs `@reference` when it depends on theme variables/custom utilities/custom variants defined elsewhere.

```vue
<template>
  <h1>Hello</h1>
</template>

<style>
  @reference "../assets/app.css";

  h1 {
    @apply text-2xl font-bold text-brand-500;
  }
</style>
```

If the style block uses only default Tailwind theme values and no customizations:

```css
@reference "tailwindcss";
```

Avoid Sass/Less/Stylus in Tailwind-processed style blocks for v4 migration work.

## Svelte / SvelteKit

Use `@reference` in component styles that use `@apply`:

```svelte
<style>
  @reference "../app.css";

  .title {
    @apply text-2xl font-bold;
  }
</style>
```

Check SvelteKit generated/ignored paths. If class names live in a package or route directory ignored by default, use `@source` from the main CSS file.

## Astro

For Tailwind classes in `.astro` components, automatic detection usually works. For `<style>` blocks using `@apply`, add `@reference` to the main CSS file.

```astro
<style>
  @reference "../styles/app.css";

  .card {
    @apply rounded-card shadow-card;
  }
</style>
```

Avoid Sass/Less/Stylus as the Tailwind processing path.

## CSS modules

CSS modules are separately bundled. Add `@reference` before using `@apply` with Tailwind utilities defined in the main stylesheet.

```css
@reference "../app.css";

.title {
  @apply text-xl font-semibold text-brand-700;
}
```

Alternative: skip `@apply` and use generated CSS variables directly:

```css
.title {
  color: var(--color-brand-700);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
}
```

## Sass, Less, and Stylus

Tailwind v4 is not designed to be used with CSS preprocessors in the Tailwind stylesheet or component style pipeline.

Migration approach:

1. Create a plain CSS Tailwind entry, such as `src/styles/tailwind.css`.
2. Put `@import "tailwindcss";` and Tailwind directives in that CSS file.
3. Move token configuration to `@theme`.
4. Keep non-Tailwind Sass/Less/Stylus files separate if the app still needs them, but do not rely on Sass/Less/Stylus to process Tailwind directives.
5. Replace preprocessor variables that were only design tokens with CSS variables or `@theme` values.

## Monorepos

Automatic source detection starts from the working directory. In monorepos, builds often run from a root that differs from the app package.

Set a source base when needed:

```css
@import "tailwindcss" source("./src");
```

Register shared packages:

```css
@source "../../packages/ui/src";
@source "../../packages/design-system/src";
```

For multiple Tailwind entry files, consider disabling automatic detection and registering sources explicitly for each bundle:

```css
@import "tailwindcss" source(none);
@source "./src";
@source "../../packages/ui/src";
```

## Third-party Tailwind component packages

Dependencies are usually ignored by automatic source detection. If a component library ships Tailwind class strings and is not precompiled to CSS, register it:

```css
@source "../node_modules/@acmecorp/ui-lib";
```

Prefer package source paths that contain actual class strings. Avoid broad `node_modules` scans.

## Dynamic classes from props, CMS, or backend data

Tailwind scans source files as plain text. It does not understand runtime string concatenation.

Do not use:

```tsx
<div className={`bg-${color}-500`}></div>
```

Use static maps:

```tsx
const colorClasses = {
  red: "bg-red-500 hover:bg-red-400",
  blue: "bg-blue-500 hover:bg-blue-400",
};

<div className={colorClasses[color]}></div>
```

For backend/CMS-controlled finite sets, safelist with `@source inline()`:

```css
@source inline("{hover:,}bg-{red,blue,green}-{100,500,900}");
```

## Plugin compatibility

For official or third-party plugins:

1. Check whether the project still needs the plugin in v4. Some v3 plugins may be built into v4 or made unnecessary.
2. Check whether the plugin has a v4-compatible release.
3. Prefer plugin-specific v4 setup instructions.
4. Use `@plugin "package";` only for legacy JavaScript-based plugins that v4 can bridge.
5. Validate generated classes in the browser.

Example bridge:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```
