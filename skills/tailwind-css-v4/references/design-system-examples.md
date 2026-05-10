# Tailwind CSS v4.x design system examples

## Brand palette and typography

```css
@import "tailwindcss";

@theme {
  --color-brand-50: oklch(0.97 0.02 260);
  --color-brand-100: oklch(0.93 0.05 260);
  --color-brand-500: oklch(0.62 0.18 260);
  --color-brand-600: oklch(0.55 0.18 260);
  --color-brand-700: oklch(0.48 0.16 260);
  --color-brand-950: oklch(0.22 0.09 260);

  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-display: "Satoshi", Inter, ui-sans-serif, system-ui, sans-serif;

  --radius-card: 1rem;
  --shadow-card: 0 1rem 3rem oklch(0 0 0 / 0.12);
}
```

Usage:

```html
<section class="rounded-card bg-brand-50 p-8 shadow-card">
  <h1 class="font-display text-4xl font-semibold text-brand-950">Launch faster</h1>
  <p class="mt-3 text-brand-700">A design-token driven Tailwind v4 component.</p>
</section>
```

## Manual dark mode and themes

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));
@custom-variant theme-ocean (&:where([data-theme="ocean"], [data-theme="ocean"] *));
```

```html
<html class="dark" data-theme="ocean">
  <button class="bg-brand-600 text-white dark:bg-brand-500 theme-ocean:ring-2 theme-ocean:ring-cyan-300">
    Save
  </button>
</html>
```

## Component utility with override-friendly defaults

```css
@utility btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: --spacing(2);
  border-radius: var(--radius-lg);
  padding-inline: --spacing(4);
  padding-block: --spacing(2);
  font-weight: var(--font-weight-medium);
}
```

```html
<button class="btn bg-brand-600 text-white hover:bg-brand-700 focus:ring-3 focus:ring-brand-500/40">
  Continue
</button>
```

Because custom utilities participate in Tailwind ordering, ordinary utilities can override parts of the component utility when needed.

## Static variant maps for UI components

```tsx
const buttonTone = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500/40",
  secondary: "bg-white text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50",
  danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/40",
};

export function Button({ tone = "primary", children }) {
  return (
    <button className={`btn focus:ring-3 ${buttonTone[tone]}`}>
      {children}
    </button>
  );
}
```

Keep every utility class complete and statically detectable.

## Monorepo or external component library scanning

```css
@import "tailwindcss" source("../src");
@source "../../packages/ui/src";
@source "../node_modules/@acme/design-system";
```

## Safelisting generated ranges

```css
@source inline("grid-cols-{1..12}");
@source inline("{sm:,md:,lg:,}max-w-{screen-sm,screen-md,screen-lg}");
@source inline("{hover:,focus:,}bg-brand-{50,100,500,600,700}");
```
