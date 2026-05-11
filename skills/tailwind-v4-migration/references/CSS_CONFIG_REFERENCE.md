# CSS-first configuration reference for Tailwind v4 migrations

Tailwind v4 moves the recommended configuration model from JavaScript to CSS.
Use this reference when converting `tailwind.config.*`.

## Core v4 directives

```css
@import "tailwindcss";

@theme {
  --font-display: "Satoshi", sans-serif;
  --breakpoint-3xl: 120rem;
  --color-brand-500: oklch(0.72 0.11 221.19);
}

@utility content-auto {
  content-visibility: auto;
}

@custom-variant theme-midnight (&:where([data-theme="midnight"] *));

@source "../node_modules/@acmecorp/ui-lib";
@source inline("{hover:,focus:,}underline");
```

## `@theme` vs `:root`

Use `@theme` when a design token should create Tailwind utilities or variants.
Use `:root` for ordinary CSS variables that should not create utility classes.

```css
@theme {
  --color-brand-500: #2563eb; /* enables bg-brand-500, text-brand-500, etc. */
}

:root {
  --app-header-height: 64px; /* ordinary variable only */
}
```

`@theme` variables must be top-level, not nested under selectors or media
queries.

## Common `tailwind.config.*` mappings

| v3 config area                                 | v4 CSS-first equivalent                                                 | Notes                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `theme.extend.colors.brand.500`                | `@theme { --color-brand-500: ...; }`                                    | Enables `bg-brand-500`, `text-brand-500`, `border-brand-500`, etc.                            |
| `theme.extend.fontFamily.display`              | `@theme { --font-display: ...; }`                                       | Enables `font-display`.                                                                       |
| `theme.extend.fontSize.xxl`                    | `@theme { --text-xxl: ...; }`                                           | Use text namespace for font-size utilities. Add related variables for line-height if needed.  |
| `theme.extend.fontWeight.book`                 | `@theme { --font-weight-book: 350; }`                                   | Enables `font-book`.                                                                          |
| `theme.extend.letterSpacing.tightish`          | `@theme { --tracking-tightish: ...; }`                                  | Enables `tracking-tightish`.                                                                  |
| `theme.extend.lineHeight.11`                   | `@theme { --leading-11: ...; }`                                         | Enables `leading-11`.                                                                         |
| `theme.extend.screens.3xl`                     | `@theme { --breakpoint-3xl: 120rem; }`                                  | Enables `3xl:*`.                                                                              |
| `theme.container.center/padding`               | `@utility container { ... }`                                            | v3 container options do not map directly.                                                     |
| `theme.extend.spacing`                         | Usually no config, or `--spacing-*`/custom values                       | Many arbitrary spacing values work without config in v4. Keep true design tokens in `@theme`. |
| `theme.extend.borderRadius.card`               | `@theme { --radius-card: ...; }`                                        | Enables `rounded-card`.                                                                       |
| `theme.extend.boxShadow.card`                  | `@theme { --shadow-card: ...; }`                                        | Enables `shadow-card`.                                                                        |
| `theme.extend.dropShadow.glow`                 | `@theme { --drop-shadow-glow: ...; }`                                   | Enables `drop-shadow-glow`.                                                                   |
| `theme.extend.blur.soft`                       | `@theme { --blur-soft: ...; }`                                          | Enables `blur-soft`.                                                                          |
| `theme.extend.transitionTimingFunction.snappy` | `@theme { --ease-snappy: ...; }`                                        | Enables `ease-snappy`.                                                                        |
| `theme.extend.animation.fade-in`               | `@theme { --animate-fade-in: fade-in ...; @keyframes fade-in { ... } }` | Keyframes can live inside `@theme`.                                                           |
| `content`                                      | Automatic detection; optional `source()`/`@source`                      | Do not copy v3 content arrays unless needed.                                                  |
| `safelist`                                     | `@source inline()` or static class maps                                 | JS config safelist is unsupported in v4.                                                      |
| `plugins: [require(...)]`                      | `@plugin "package";` or plugin-specific v4 setup                        | Verify plugin compatibility.                                                                  |
| `prefix: "tw-"`                                | `@import "tailwindcss" prefix(tw);`                                     | Classes become `tw:flex`, not `tw-flex`.                                                      |
| `darkMode: ['class', ...]` or custom selector  | `@custom-variant dark (...)` as needed                                  | Built-in behavior may be enough for simple cases.                                             |
| `corePlugins`                                  | No direct support                                                       | Redesign or remove unsupported dependency on disabled core utilities.                         |
| `separator`                                    | No direct support                                                       | v4 class syntax assumes variant-like separators.                                              |
| `presets`                                      | Import shared CSS token files, or use `@config` temporarily             | Prefer shared CSS theme packages over JS presets.                                             |

## Theme namespace examples

```css
@theme {
  /* Colors */
  --color-brand-50: #eff6ff;
  --color-brand-500: #3b82f6;
  --color-brand-900: #1e3a8a;

  /* Fonts */
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-display: "Satoshi", ui-sans-serif, system-ui, sans-serif;

  /* Type scale */
  --text-display: 4rem;
  --text-display--line-height: 1;

  /* Breakpoints */
  --breakpoint-3xl: 120rem;

  /* Radius/shadow */
  --radius-card: 1rem;
  --shadow-card: 0 16px 40px rgb(15 23 42 / 0.12);

  /* Animation */
  --animate-fade-in: fade-in 200ms ease-out;

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}
```

## Extending vs overriding defaults

### Extend default theme

Add new variables:

```css
@import "tailwindcss";

@theme {
  --font-script: "Great Vibes", cursive;
}
```

### Override one default token

```css
@import "tailwindcss";

@theme {
  --breakpoint-sm: 30rem;
}
```

### Override a whole namespace

```css
@import "tailwindcss";

@theme {
  --color-*: initial;
  --color-white: #fff;
  --color-brand: #3f3cbb;
}
```

Only use namespace resets when the project intentionally removes default
utilities such as `bg-red-500`.

### Custom-only theme

```css
@import "tailwindcss";

@theme {
  --*: initial;
  --spacing: 4px;
  --font-body: Inter, sans-serif;
  --color-lagoon: oklch(0.72 0.11 221.19);
}
```

This removes default token-driven utilities. Use carefully.

## Referencing other variables

When a theme variable depends on another CSS variable, consider `@theme inline`
so generated utilities use the referenced value directly:

```css
@theme inline {
  --font-sans: var(--font-inter);
}
```

## Generating all CSS variables

By default, only used CSS variables may be generated. Use `@theme static` when
all variables must exist in output CSS:

```css
@theme static {
  --color-primary: var(--color-red-500);
  --color-secondary: var(--color-blue-500);
}
```

## Custom utilities

Use `@utility` for custom classes that should work with variants:

```css
@utility btn {
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: ButtonFace;
}
```

Then `hover:btn`, `lg:btn`, or other variants can be generated when supported by
Tailwind’s utility system.

Use ordinary CSS under `@layer components` or `@layer base` when you only need
cascade layering, not utility behavior.

## Custom variants

For a custom dark mode or theme selector:

```css
@custom-variant dark (&:where(.dark, .dark *));
@custom-variant theme-midnight (&:where([data-theme="midnight"] *));
```

Then use:

```html
<div class="dark:bg-slate-950 theme-midnight:text-white"></div>
```

## Source detection and safelisting

Tailwind v4 scans project files automatically, but it ignores common
generated/third-party locations such as `node_modules`, files in `.gitignore`,
binary files, CSS files, and lockfiles.

### Register external sources

```css
@import "tailwindcss";
@source "../node_modules/@acmecorp/ui-lib";
```

### Set source base in monorepos

```css
@import "tailwindcss" source("../src");
```

### Disable automatic detection and register explicitly

```css
@import "tailwindcss" source(none);
@source "../admin";
@source "../shared";
```

### Safelist exact utilities

```css
@source inline("underline");
```

### Safelist variants and ranges

```css
@source inline("{hover:,focus:,}underline");
@source inline("{hover:,}bg-red-{50,{100..900..100},950}");
```

Prefer static class maps in application code when possible:

```tsx
const variants = {
  primary: "bg-blue-600 hover:bg-blue-500 text-white",
  danger: "bg-red-600 hover:bg-red-500 text-white",
};
```

## Legacy bridge directives

Use these only for incremental migration.

```css
@config "../../tailwind.config.js";
@plugin "@tailwindcss/typography";
```

CSS-defined `@theme`, `@utility`, and variants can coexist with bridged JS
config/plugin values. CSS definitions should be treated as the source of truth
when conflicts occur.

## Converting a realistic v3 config

Before:

```js
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          500: "#3b82f6",
          900: "#1e3a8a",
        },
      },
      fontFamily: {
        display: ["Satoshi", "sans-serif"],
      },
      screens: {
        "3xl": "120rem",
      },
      boxShadow: {
        card: "0 16px 40px rgb(15 23 42 / 0.12)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
```

After:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  --color-brand-50: #eff6ff;
  --color-brand-500: #3b82f6;
  --color-brand-900: #1e3a8a;
  --font-display: "Satoshi", sans-serif;
  --breakpoint-3xl: 120rem;
  --shadow-card: 0 16px 40px rgb(15 23 42 / 0.12);
}
```

Do not port `content` unless automatic detection misses files.
