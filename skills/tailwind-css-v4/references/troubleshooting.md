# Tailwind CSS v4.x troubleshooting

## Error: trying to use tailwindcss directly as a PostCSS plugin

Cause: v4 moved the PostCSS plugin to `@tailwindcss/postcss`.

Fix:

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

Remove `tailwindcss: {}` from PostCSS config.

## Error: npx tailwindcss init or npx tailwindcss cannot determine executable

Cause: the v4 CLI lives in `@tailwindcss/cli`, and v4 no longer requires `tailwind.config.js` for normal setup.

Fix for CLI builds:

```bash
npm install tailwindcss @tailwindcss/cli
npx @tailwindcss/cli -i ./src/input.css -o ./src/output.css --watch
```

Do not run `tailwindcss init` for normal v4 setup.

## Tailwind utilities are not generated

Check these in order:

1. The main stylesheet contains `@import "tailwindcss";`.
2. The CSS file is imported by the app or linked in the document.
3. Source files contain complete class names, not dynamically concatenated fragments.
4. Files with class names are not ignored by `.gitignore`, inside `node_modules`, or outside the source detection base.
5. Add `@source` for external libraries or monorepo paths that Tailwind does not scan.
6. Safelist known generated classes with `@source inline()` when classes are produced outside source files.

## Classes built from props do not work

Bad:

```tsx
<div className={`text-${status}-600`} />
```

Good:

```tsx
const statusClass = {
  success: "text-green-600",
  warning: "text-yellow-600",
  error: "text-red-600",
};

<div className={statusClass[status]} />
```

## Custom theme values do not create utilities

Make sure the value is defined in top-level `@theme`, not nested in a selector or media query.

```css
@theme {
  --color-accent-500: oklch(0.65 0.2 240);
}
```

Use `:root` only for regular CSS variables that should not generate utilities.

## @apply fails in Vue, Svelte, Astro, or CSS modules

A separately bundled stylesheet cannot see theme variables and custom utilities from the main CSS file. Add `@reference`:

```css
@reference "../../app.css";

.title {
  @apply text-2xl font-bold text-accent-500;
}
```

Or use CSS variables directly:

```css
.title {
  color: var(--color-accent-500);
}
```

## Dark mode does not toggle manually

By default, `dark:*` follows `prefers-color-scheme`. For manual class toggling, override the variant:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Then set the class on an ancestor:

```html
<html class="dark">
```

For data attributes:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

## Border or ring colors changed after migration

v4 defaults are less opinionated. Add explicit colors and widths where the old defaults were visually important:

```html
<div class="border border-gray-200"></div>
<button class="focus:ring-3 focus:ring-blue-500"></button>
```

## Vite alias imports or plugin resolution issues

Check the installed Tailwind minor/patch version. Several v4.x releases fixed Vite alias and import/plugin resolution behavior. Upgrading within v4.x is often the correct fix after confirming the issue is not caused by project config.
