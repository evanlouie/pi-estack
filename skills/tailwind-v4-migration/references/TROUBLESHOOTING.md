# Tailwind v4 migration troubleshooting

Use this when the migration builds fail, utilities are missing, or visual output
changes unexpectedly.

## `@tailwind base` / `@tailwind components` / `@tailwind utilities` no longer works

Replace all three v3 directives with:

```css
@import "tailwindcss";
```

Do this in the actual CSS entry file imported by the app or build command.

## PostCSS error: using `tailwindcss` as a PostCSS plugin

In v4 the PostCSS plugin is `@tailwindcss/postcss`.

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

Install the package and remove the old direct plugin reference.

## Vite build works but dev server misses styles, or vice versa

Use the Vite plugin:

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

Confirm the CSS entry is imported by the app and not only by a storybook/test
harness.

## CLI command no longer works

Use `@tailwindcss/cli`:

```bash
npx @tailwindcss/cli -i ./src/input.css -o ./dist/output.css
```

Update package scripts and dev dependencies.

## Custom theme classes are missing

Example missing class: `bg-brand-500`.

Check that the token exists in `@theme`, not `:root`:

```css
@theme {
  --color-brand-500: #3b82f6;
}
```

A plain CSS variable does not create utilities:

```css
:root {
  --color-brand-500: #3b82f6; /* does not create bg-brand-500 */
}
```

## `tailwind.config.js` appears ignored

v4 does not auto-detect JS config files. Use an explicit bridge while migrating:

```css
@config "../../tailwind.config.js";
```

Then migrate supported values into CSS. Do not depend on JS config
`corePlugins`, `safelist`, or `separator`.

## Safelisted classes are missing

v4 does not support JS config `safelist` the same way. Prefer full static class
names in source code or use `@source inline()`:

```css
@source inline("{hover:,}bg-red-{50,{100..900..100},950}");
```

For backend or CMS options, generate a finite static list and register it.

## Classes in a shared package are missing

Automatic source detection ignores dependencies such as `node_modules`. Register
the package path from the CSS entry:

```css
@source "../node_modules/@acmecorp/ui-lib";
```

In monorepos:

```css
@source "../../packages/ui/src";
```

## Classes are missing in a monorepo

The build may run from a different working directory than expected. Set the scan
base:

```css
@import "tailwindcss" source("./src");
```

Or disable automatic detection and register sources explicitly:

```css
@import "tailwindcss" source(none);
@source "./src";
@source "../../packages/ui/src";
```

## Dynamic class names stopped working

Tailwind does not evaluate runtime string concatenation. Replace interpolated
fragments with complete static class strings.

Before:

```tsx
<div className={`text-${status}-600`}></div>
```

After:

```tsx
const statusClasses = {
  error: "text-red-600",
  success: "text-green-600",
};

<div className={statusClasses[status]}></div>;
```

## `@apply` fails in Vue/Svelte/Astro/CSS modules

Add `@reference` to import theme variables/custom utilities/custom variants
without duplicating CSS:

```css
@reference "../app.css";

.title {
  @apply text-2xl font-bold text-brand-500;
}
```

If the file uses only default Tailwind values:

```css
@reference "tailwindcss";
```

Alternative: use CSS variables instead of `@apply`.

## Sass/Less/Stylus processing fails

Tailwind v4 is not designed to be used with CSS preprocessors as the Tailwind
processing path. Move Tailwind directives into plain CSS.

```css
/* app.css */
@import "tailwindcss";

@theme {
  --color-brand-500: #3b82f6;
}
```

Keep Sass/Less/Stylus only for separate non-Tailwind styles if the project still
needs them.

## Borders look too dark, inherit text color, or changed color

v4 default border and divide color is `currentColor`, not gray-200. Add explicit
colors:

```html
<div class="border border-gray-200"></div>
```

If the whole project depends on v3 default border color, add a compatibility
base style and document it:

```css
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-gray-200, currentColor);
  }
}
```

## Focus rings look thinner or changed color

Use explicit width and color:

```html
<button class="focus:ring-3 focus:ring-blue-500"></button>
```

Use compatibility variables only if the migration needs a temporary global
bridge:

```css
@theme {
  --default-ring-width: 3px;
  --default-ring-color: var(--color-blue-500);
}
```

## `outline-none` behavior changed

To preserve v3 invisible-outline behavior, use:

```html
<input class="focus:outline-hidden" />
```

Use `outline-none` in v4 only when actual `outline-style: none` is intended.

## `space-x-*` / `space-y-*` layouts changed

v4 changed the selector. Use flex/grid gap where possible:

```html
<div class="flex flex-col gap-4"></div>
```

Inspect components that combined `space-*` utilities with child margins or
inline elements.

## Hover behavior changed on touch devices

v4 `hover:` applies only when the primary input device supports hover. Prefer
making hover an enhancement. If the product truly needs old behavior, define:

```css
@custom-variant hover (&:hover);
```

Document the compatibility override.

## `transform-none` no longer resets scale/rotate/translate

Use individual reset utilities:

```html
<button class="scale-150 focus:scale-none"></button>
```

For multiple transforms, reset each relevant property.

## Transition of transform utilities stopped working

v4 transform utilities use individual properties. Replace `transform` in
arbitrary transition lists with the specific properties:

```html
<button class="transition-[opacity,scale] hover:scale-150"></button>
```

## Custom utilities do not work with variants

Use `@utility` instead of relying on v3-style `@layer utilities` registration:

```css
@utility tab-4 {
  tab-size: 4;
}
```

## Prefix classes are broken

v4 prefixes behave like variants at the beginning of the class:

```html
<div class="tw:flex tw:bg-red-500 tw:hover:bg-red-600"></div>
```

Import with prefix:

```css
@import "tailwindcss" prefix(tw);
```

## Important modifier warning or unexpected specificity

Move `!` to the end:

```html
<div class="hover:bg-red-500!"></div>
```

## Arbitrary CSS variable shorthand broke

Before:

```html
<div class="bg-[--brand-color]"></div>
```

After:

```html
<div class="bg-(--brand-color)"></div>
```

## Grid/object-position arbitrary values broke

Replace commas that represented spaces with underscores:

```html
<div class="grid-cols-[max-content_auto]"></div>
```

## Typography/custom plugin classes are missing

Check plugin compatibility. Use v4 plugin instructions when available. Bridge
legacy JS plugins with:

```css
@plugin "@tailwindcss/typography";
```

Then validate generated plugin styles in the browser.

## Final debugging order

1. Confirm the CSS entry is loaded by the app.
2. Confirm build integration package: Vite, PostCSS, or CLI.
3. Confirm `@import "tailwindcss";` exists exactly once in the main Tailwind CSS
   entry.
4. Run the audit script.
5. Check missing classes for dynamic construction, ignored source paths, or
   missing `@theme` variables.
6. Check visual changes against the v4 breaking-change reference.
7. Run a production build and browser review.
