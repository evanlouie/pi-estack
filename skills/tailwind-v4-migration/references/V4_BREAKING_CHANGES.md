# Tailwind CSS v4 breaking-change reference

This file summarizes the migration-sensitive changes agents should check
manually. Use it after running the official upgrade tool and before final
validation.

## Platform and toolchain

| Area              | v3                                                           | v4 action                                                                                                              |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Browser support   | Wider legacy browser support                                 | v4 targets Safari 16.4+, Chrome 111+, Firefox 128+. Stay on v3.4 if older browsers are required.                       |
| Upgrade tool      | Not applicable                                               | Prefer `npx @tailwindcss/upgrade` on a clean branch with Node.js 20+.                                                  |
| PostCSS plugin    | `tailwindcss` package as plugin                              | Use `@tailwindcss/postcss`.                                                                                            |
| Vite              | PostCSS integration common                                   | Prefer `@tailwindcss/vite`.                                                                                            |
| CLI               | `npx tailwindcss ...`                                        | Use `@tailwindcss/cli`.                                                                                                |
| CSS entry         | `@tailwind base; @tailwind components; @tailwind utilities;` | Use `@import "tailwindcss";`.                                                                                          |
| Imports/prefixing | Often `postcss-import` and `autoprefixer`                    | Tailwind v4 handles Tailwind imports and vendor prefixing; remove extra plugins only if they are not needed elsewhere. |

## Removed deprecated utilities

These were deprecated in v3 and removed in v4.

| v3 utility              | v4 replacement                                            |
| ----------------------- | --------------------------------------------------------- |
| `bg-opacity-*`          | Use color opacity modifiers, e.g. `bg-black/50`.          |
| `text-opacity-*`        | Use color opacity modifiers, e.g. `text-black/50`.        |
| `border-opacity-*`      | Use color opacity modifiers, e.g. `border-black/50`.      |
| `divide-opacity-*`      | Use color opacity modifiers, e.g. `divide-black/50`.      |
| `ring-opacity-*`        | Use color opacity modifiers, e.g. `ring-black/50`.        |
| `placeholder-opacity-*` | Use color opacity modifiers, e.g. `placeholder-black/50`. |
| `flex-shrink-*`         | `shrink-*`.                                               |
| `flex-grow-*`           | `grow-*`.                                                 |
| `overflow-ellipsis`     | `text-ellipsis`.                                          |
| `decoration-slice`      | `box-decoration-slice`.                                   |
| `decoration-clone`      | `box-decoration-clone`.                                   |

Opacity migrations require understanding the paired color class. Do not blindly
rewrite `bg-opacity-50` without knowing whether the intended final class is
`bg-red-500/50`, `bg-black/50`, etc.

## Renamed visual scale utilities

Tailwind v4 renames some scale values so every default scale has a named value.
Use these replacements to preserve v3 visual appearance.

| v3                 | v4                                                       |
| ------------------ | -------------------------------------------------------- |
| `shadow-sm`        | `shadow-xs`                                              |
| `shadow`           | `shadow-sm`                                              |
| `drop-shadow-sm`   | `drop-shadow-xs`                                         |
| `drop-shadow`      | `drop-shadow-sm`                                         |
| `blur-sm`          | `blur-xs`                                                |
| `blur`             | `blur-sm`                                                |
| `backdrop-blur-sm` | `backdrop-blur-xs`                                       |
| `backdrop-blur`    | `backdrop-blur-sm`                                       |
| `rounded-sm`       | `rounded-xs`                                             |
| `rounded`          | `rounded-sm`                                             |
| `outline-none`     | `outline-hidden` if preserving v3 forced-colors behavior |
| `ring`             | `ring-3` if preserving v3 3px width                      |

Notes:

- v4 still supports bare forms for compatibility in some cases, but the visual
  result may differ.
- `outline-none` in v4 means actual `outline-style: none`; use `outline-hidden`
  to preserve the old invisible-outline behavior.
- `ring` is 1px in v4 instead of 3px. Add `ring-3` and explicit `ring-blue-500`
  if the old width/color mattered.

## Behavioral and visual changes

### `space-x-*` / `space-y-*`

v4 changed the selector for performance. Review places using inline elements or
additional child margins. Prefer `gap` with flex/grid when behavior changes.

### Gradients with variants

v4 preserves existing gradient stop values when a variant overrides part of a
gradient. If a state should remove a middle stop, explicitly use `via-none`.

### `container` configuration

v3 `container` config options like `center` and `padding` are not configured the
same way. Customize `container` with `@utility`:

```css
@utility container {
  margin-inline: auto;
  padding-inline: 2rem;
}
```

### Default border and divide color

v3 defaulted `border-*` and `divide-*` colors to configured `gray-200`. v4
defaults to `currentColor`.

Preferred fix:

```html
<div class="border border-gray-200"></div>
```

Compatibility fallback when preserving v3 behavior globally:

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

### Default ring width and color

v3 `ring` defaulted to 3px and blue-500. v4 defaults to 1px and `currentColor`.

Preferred fix:

```html
<button class="focus:ring-3 focus:ring-blue-500"></button>
```

Compatibility fallback:

```css
@theme {
  --default-ring-width: 3px;
  --default-ring-color: var(--color-blue-500);
}
```

Use the fallback only as a compatibility bridge, not as the preferred v4 style.

### Preflight changes

Review affected UI surfaces:

- Placeholder text uses current color at 50% opacity instead of default
  gray-400.
- Buttons use `cursor: default` instead of `cursor: pointer`.
- `<dialog>` margins are reset.
- Display utilities like `block` or `flex` no longer override the `hidden`
  attribute. Remove `hidden` when the element should display.

Optional compatibility CSS:

```css
@layer base {
  input::placeholder,
  textarea::placeholder {
    color: var(--color-gray-400);
  }

  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }

  dialog {
    margin: auto;
  }
}
```

### Prefix syntax

Prefixes now act like variants and are always at the beginning of the class.

```html
<div class="tw:flex tw:bg-red-500 tw:hover:bg-red-600"></div>
```

Configure the import:

```css
@import "tailwindcss" prefix(tw);
```

Define `@theme` variables as if there is no prefix; generated CSS variables
receive the prefix automatically.

### Important modifier

v3 allowed leading important markers such as `!h-10` or `hover:!bg-red-500`. v4
prefers the important marker at the end:

```html
<div class="h-10! hover:bg-red-500!"></div>
```

The old form is deprecated but may still work for compatibility.

### Custom utilities

v3 often used `@layer utilities` or `@layer components` to register custom
classes that worked with variants. v4 uses native cascade layers and introduces
`@utility`:

```css
@utility tab-4 {
  tab-size: 4;
}
```

Use `@layer` for ordinary CSS layering; use `@utility` when the class should
behave like a Tailwind utility and work with variants.

### Variant stacking order

v3 stacked variants applied right-to-left. v4 applies left-to-right. Reverse
order-sensitive stacked variants.

```html
<!-- v3 intent -->
<ul class="py-4 first:*:pt-0 last:*:pb-0"></ul>

<!-- v4 intent -->
<ul class="py-4 *:first:pt-0 *:last:pb-0"></ul>
```

Most projects have few order-sensitive stacked variants. Check direct child `*`
and typography plugin variants first.

### CSS variables in arbitrary values

v3 allowed arbitrary CSS variable shorthand with square brackets:

```html
<div class="bg-[--brand-color]"></div>
```

v4 uses parentheses:

```html
<div class="bg-(--brand-color)"></div>
```

### Arbitrary values in grid/object-position utilities

In v4, commas inside arbitrary values are not converted to spaces for
`grid-cols-*`, `grid-rows-*`, and `object-*`. Use underscores for spaces:

```html
<div class="grid-cols-[max-content_auto]"></div>
```

### Hover behavior on mobile

v4 `hover:` utilities only apply when the primary input device supports hover.
If the site depends on tap-triggered hover, redesign the interaction or
explicitly define a compatibility variant:

```css
@custom-variant hover (&:hover);
```

Use the override only when product behavior truly depends on old hover
semantics.

### Transitioning outline color

`transition` and `transition-colors` include `outline-color` in v4. If focus
outline color transitions from the default unexpectedly, set the outline color
unconditionally or in both states.

### Individual transform properties

v4 uses individual `rotate`, `scale`, and `translate` properties.

- `transform-none` no longer resets individual scale/rotate/translate utilities.
  Use `scale-none`, `rotate-none`, and/or `translate-none`.
- `transition-[opacity,transform]` will not transition individual transform
  utilities. Use lists such as `transition-[opacity,scale]` or include the exact
  individual properties.

### Disabling core plugins

The JS config `corePlugins` option is not supported in v4.

### `theme()` function

Prefer CSS variables:

```css
.my-class {
  background-color: var(--color-red-500);
}
```

If `theme()` is still necessary, such as in media queries where CSS variables
are not supported, use CSS variable names:

```css
@media (width >= theme(--breakpoint-xl)) {
  /* ... */
}
```

### JavaScript config files

JS config files are supported only when loaded explicitly:

```css
@config "../../tailwind.config.js";
```

Unsupported JS config options in v4:

- `corePlugins`
- `safelist`
- `separator`

Use `@source inline()` for safelisting.

### Theme values in JavaScript

v4 removed the v3 `resolveConfig` flow. Prefer generated CSS variables and
`getComputedStyle` when JavaScript needs resolved values.

### `@apply` in component styles and CSS modules

Separately bundled stylesheets do not automatically see theme variables, custom
utilities, or custom variants from the main CSS. Add `@reference`:

```vue
<style>
@reference "../../app.css";

h1 {
  @apply text-2xl font-bold text-red-500;
}
</style>
```

For default theme only, `@reference "tailwindcss";` can be enough.

### Sass, Less, and Stylus

Tailwind v4 is not designed to be used with CSS preprocessors as the Tailwind
stylesheet or component style processing path. Prefer plain CSS and Tailwind’s
own directives/functions.
