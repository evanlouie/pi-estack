# Tailwind CSS v3 to v4 Class and Config Mapping

Use this as a quick conversion reference during migrations.

## Deprecated utilities removed in v4

| v3 utility | v4 replacement |
| --- | --- |
| `bg-opacity-*` | opacity modifiers, e.g. `bg-black/50` |
| `text-opacity-*` | opacity modifiers, e.g. `text-black/50` |
| `border-opacity-*` | opacity modifiers, e.g. `border-black/50` |
| `divide-opacity-*` | opacity modifiers, e.g. `divide-black/50` |
| `ring-opacity-*` | opacity modifiers, e.g. `ring-black/50` |
| `placeholder-opacity-*` | opacity modifiers, e.g. `placeholder-black/50` |
| `flex-shrink-*` | `shrink-*` |
| `flex-grow-*` | `grow-*` |
| `overflow-ellipsis` | `text-ellipsis` |
| `decoration-slice` | `box-decoration-slice` |
| `decoration-clone` | `box-decoration-clone` |

## Renamed utilities and scale changes

| v3 utility | v4 utility to preserve v3 look |
| --- | --- |
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `drop-shadow-sm` | `drop-shadow-xs` |
| `drop-shadow` | `drop-shadow-sm` |
| `blur-sm` | `blur-xs` |
| `blur` | `blur-sm` |
| `backdrop-blur-sm` | `backdrop-blur-xs` |
| `backdrop-blur` | `backdrop-blur-sm` |
| `rounded-sm` | `rounded-xs` |
| `rounded` | `rounded-sm` |
| `outline-none` | `outline-hidden` for the old accessible invisible outline behavior; use new `outline-none` only when you truly want `outline-style: none` |
| `ring` | `ring-3` to preserve the old 3px width; add `ring-blue-500` if relying on old default color |

The bare forms often still work for backward compatibility, but the visual result can differ. Prefer explicit v4 names after migration.

## Common visual compatibility snippets

Use these sparingly. They are helpful for phased migrations, but idiomatic v4 code should generally be explicit at the call site.

### Preserve v3 default border/divide color

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

Better long-term fix:

```html
<div class="border border-gray-200 divide-y divide-gray-200"></div>
```

### Preserve v3 default ring behavior

```css
@theme {
  --default-ring-width: 3px;
  --default-ring-color: var(--color-blue-500);
}
```

Better long-term fix:

```html
<button class="focus:ring-3 focus:ring-blue-500"></button>
```

### Preserve v3 placeholder color

```css
@layer base {
  input::placeholder,
  textarea::placeholder {
    color: var(--color-gray-400);
  }
}
```

Better long-term fix:

```html
<input class="placeholder:text-gray-400" />
```

### Preserve v3 button cursor behavior

```css
@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

### Preserve centered dialogs

```css
@layer base {
  dialog {
    margin: auto;
  }
}
```

## Config migration examples

### Import and theme

v3:

```js
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#0f766e",
      },
      borderRadius: {
        card: "1.25rem",
      },
    },
  },
};
```

v4:

```css
@import "tailwindcss";

@theme {
  --color-brand: #0f766e;
  --radius-card: 1.25rem;
}
```

Automatic content detection usually replaces `content`. If files are missed, add `@source`:

```css
@source "../src";
@source "../packages/ui";
```

For deterministic multi-entry builds, disable automatic detection and list every source explicitly:

```css
@import "tailwindcss" source(none);
@source "../admin";
@source "../shared";
```

### Safelist

v3:

```js
export default {
  safelist: ["bg-red-500", "hover:bg-red-600"],
};
```

v4.1+:

```css
@source inline("bg-red-500 hover:bg-red-600");
```

For generated sets:

```css
@source inline("{hover:,focus:,}bg-red-{50,{100..900..100},950}");
```

### Content exclusions

v3:

```js
export default {
  content: ["./src/**/*", "!./src/generated/**/*"],
};
```

v4.1+:

```css
@source "./src";
@source not "./src/generated";
```

### Prefix

v3 prefix placement was part of the utility name. In v4, configure the prefix on the import, and use variant-like prefix syntax at the beginning of each class:

```css
@import "tailwindcss" prefix(tw);
```

```html
<div class="tw:flex tw:bg-red-500 tw:hover:bg-red-600"></div>
```

Theme variables remain unprefixed in `@theme`.

### Container

v3:

```js
export default {
  theme: {
    container: {
      center: true,
      padding: "2rem",
    },
  },
};
```

v4:

```css
@utility container {
  margin-inline: auto;
  padding-inline: 2rem;
}
```

### Custom utility

v3:

```css
@layer utilities {
  .tab-4 {
    tab-size: 4;
  }
}
```

v4:

```css
@utility tab-4 {
  tab-size: 4;
}
```

Define `@utility` at the top level; nested `@utility` blocks are invalid.

### Class-based dark mode

v4:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Then continue using `dark:*` classes:

```html
<html class="dark">
  <button class="bg-white text-black dark:bg-black dark:text-white"></button>
</html>
```

Use `@variant` for applying an existing variant in CSS; use `@custom-variant` for defining a new one.

### Legacy config bridge

When migration is incremental:

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
@plugin "@tailwindcss/typography";
```

Remember: v4 does not support the JavaScript config `corePlugins`, `safelist`, or `separator` options, and CSS-defined values take precedence over overlapping JavaScript config values.

## Pattern replacements

### CSS variable arbitrary values

```html
<!-- v3 shorthand -->
<div class="bg-[--brand-color]"></div>

<!-- v4 shorthand -->
<div class="bg-(--brand-color)"></div>

<!-- also valid when explicit -->
<div class="bg-[var(--brand-color)]"></div>
```

### Grid/object arbitrary values with spaces

```html
<!-- v3 compatibility syntax that no longer works as intended -->
<div class="grid-cols-[max-content,auto]"></div>

<!-- v4 -->
<div class="grid-cols-[max-content_auto]"></div>
```

### Variant stacking order

```html
<!-- old order-sensitive v3 style -->
<ul class="first:*:pt-0 last:*:pb-0"></ul>

<!-- v4 left-to-right style -->
<ul class="*:first:pt-0 *:last:pb-0"></ul>
```

### Hover on mobile

If a design depended on touch devices applying `hover:*`, avoid hiding critical behavior behind hover. If restoring old behavior is explicitly desired:

```css
@custom-variant hover (&:hover);
```

### Space utilities

If `space-y-*` changes layout due to the selector change, prefer:

```html
<div class="flex flex-col gap-4"></div>
```

instead of:

```html
<div class="space-y-4"></div>
```

### Gradients

When a variant should remove the middle gradient stop:

```html
<div class="bg-linear-to-r from-red-500 via-orange-400 to-yellow-400 dark:via-none dark:from-blue-500 dark:to-teal-400"></div>
```
