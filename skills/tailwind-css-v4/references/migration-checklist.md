# Tailwind CSS v3 to v4 migration checklist

## First pass

1. Check browser support. Tailwind v4 targets modern browsers including Safari
   16.4, Chrome 111, and Firefox 128 or newer. Stay on v3.4 when older browser
   support is required.
2. Run the official upgrade tool when possible. It requires Node.js 20 or
   higher:

   ```bash
   npx @tailwindcss/upgrade
   ```

3. Review every generated change. Do not assume the upgrade tool understood
   project-specific conventions.

## Dependency and toolchain changes

- PostCSS: replace the v3 `tailwindcss` PostCSS plugin with
  `@tailwindcss/postcss`.
- Vite: prefer the first-party `@tailwindcss/vite` plugin.
- CLI: the CLI package is `@tailwindcss/cli`; update build scripts from
  `npx tailwindcss` to `npx @tailwindcss/cli`.
- Remove `postcss-import` and `autoprefixer` when they only existed for
  Tailwind, because v4 handles imports and vendor prefixing.

## CSS entry point

Replace v3 directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

with:

```css
@import "tailwindcss";
```

## CSS-first configuration

- Move theme values from `tailwind.config.*` into `@theme` where possible.
- Use `@source` instead of a `content` array for explicit source registration.
- Use `@source inline()` instead of `safelist`.
- Use `@utility` instead of custom utility classes in `@layer utilities` when
  those classes should support variants.
- Use `@custom-variant` for selector-driven variants such as manual dark mode.
- Use `@config` only when a JavaScript config must be retained temporarily.

Unsupported JavaScript config options in v4 include `corePlugins`, `safelist`,
and `separator`.

## Removed utilities and replacements

- `bg-opacity-*`, `text-opacity-*`, `border-opacity-*`, `divide-opacity-*`,
  `ring-opacity-*`, `placeholder-opacity-*` → opacity modifiers such as
  `bg-black/50`.
- `flex-shrink-*` → `shrink-*`.
- `flex-grow-*` → `grow-*`.
- `overflow-ellipsis` → `text-ellipsis`.
- `decoration-slice` → `box-decoration-slice`.
- `decoration-clone` → `box-decoration-clone`.

## Renamed scale utilities

- `shadow-sm` → `shadow-xs`; `shadow` → `shadow-sm`.
- `drop-shadow-sm` → `drop-shadow-xs`; `drop-shadow` → `drop-shadow-sm`.
- `blur-sm` → `blur-xs`; `blur` → `blur-sm`.
- `backdrop-blur-sm` → `backdrop-blur-xs`; `backdrop-blur` → `backdrop-blur-sm`.
- `rounded-sm` → `rounded-xs`; `rounded` → `rounded-sm`.
- `outline-none` → `outline-hidden` when preserving the accessible
  invisible-outline behavior.
- `ring` → `ring-3` when preserving the old 3px ring width.

## Visual behavior changes to inspect

- Default `border-*` and `divide-*` color is now `currentColor`; add explicit
  colors like `border-gray-200` where needed.
- Default `ring` width and color changed; add `ring-3` and explicit color such
  as `ring-blue-500` where needed.
- Placeholder color changed to current text color at 50% opacity.
- Buttons use `cursor: default`; add base styles if your product intentionally
  uses `cursor-pointer` for buttons.
- `space-x-*`, `space-y-*`, `divide-x-*`, and `divide-y-*` selectors changed;
  prefer `gap` with flex/grid if spacing/dividing behavior shifts.
- Variant-applied gradients preserve more values; use `via-none` when
  intentionally removing a middle gradient stop.

## Syntax changes

- Prefixes behave like variants and go at the beginning, for example
  `tw:flex tw:bg-red-500 tw:hover:bg-red-600`.
- Place important markers at the end in v4:
  `flex! bg-red-500! hover:bg-red-600/50!`.
- Order-sensitive stacked variants apply left-to-right; review `*`, `first`,
  `last`, and typography plugin variant combinations.
- Use parentheses for CSS variable arbitrary values: `bg-(--brand-color)`
  instead of `bg-[--brand-color]`.
- Use underscores for spaces in grid/object-position arbitrary values, for
  example `grid-cols-[max-content_auto]`.
- Hover variants only apply where the primary input supports hover. Do not rely
  on hover for touch-only behavior.
- Individual transform utilities use individual CSS properties; reset with
  `scale-none`, `rotate-none`, or `translate-none`, not `transform-none`.

## JavaScript, modules, and preprocessors

- Prefer generated CSS variables over `resolveConfig` or JavaScript theme
  resolution.
- When using `@apply` or `@variant` in Vue, Svelte, Astro, or CSS modules, add
  `@reference` to the main CSS file.
- Avoid Sass, Less, and Stylus in Tailwind v4 stylesheets. Treat Tailwind itself
  as the CSS preprocessor.
