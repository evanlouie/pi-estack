# Tailwind CSS v4.1 and v4.2 Notes

This reference highlights what changed after the v4.0 migration release. It was checked against the official changelog through v4.2.4 (2026-04-21); use the official changelog for newer or patch-specific fixes.

## v4.1: text shadows, masks, source controls, variants, and compatibility

Tailwind CSS v4.1 was released after the v4.0 architecture shift and is especially useful for migrated projects because it adds both new utility families and better migration/source controls.

### Major additions

- `text-shadow-*` utilities.
- `mask-*` utilities for masking elements with gradients and other mask primitives.
- Shadow opacity modifiers across shadow families:
  - `shadow-*/<alpha>`
  - `inset-shadow-*/<alpha>`
  - `drop-shadow-*/<alpha>`
  - `text-shadow-*/<alpha>`
- `drop-shadow-<color>` utilities.
- Arbitrary `bg-position-*` and `bg-size-*` support.
- `wrap-anywhere`, `wrap-break-word`, and `wrap-normal` utilities.
- `items-baseline-last` and `self-baseline-last` utilities.
- Safe alignment utilities.

### New variants

- `details-content`
- `inverted-colors`
- `noscript`
- `pointer-none`, `pointer-coarse`, `pointer-fine`
- `any-pointer-none`, `any-pointer-coarse`, `any-pointer-fine`
- `user-valid`, `user-invalid`

Examples:

```html
<h1 class="text-5xl font-bold text-shadow-lg text-shadow-black/25">
  Layered heading
</h1>

<p class="wrap-anywhere">
  AVeryLongUnbrokenIdentifierThatShouldStillWrapInNarrowContainers
</p>

<button class="pointer-coarse:min-h-12 pointer-fine:min-h-9">
  Adaptive target size
</button>

<input class="user-invalid:border-red-500 user-valid:border-green-500" />
```

### Source control additions

v4.1 adds controls that are important when migrating from v3 `content` and `safelist` patterns:

```css
@import "tailwindcss";

/* Safelist one or more utilities. */
@source inline("underline bg-red-500 hover:bg-red-600");

/* Safelist generated ranges with brace expansion. */
@source inline("{hover:,focus:,}bg-red-{50,{100..900..100},950}");

/* Exclude source paths. */
@source not "../src/generated";

/* Exclude inline safelisted utilities. */
@source not inline("container");
```

### Source scanning behavior changes

- `node_modules` is ignored by default, unless overridden with `@source`.
- `@source` rules that include file extensions or point inside `node_modules` no longer consider `.gitignore` rules.
- Symlink resolution and legacy negated content rules improved in patch releases.

### Deprecated directional position naming

v4.1 deprecates `bg-{left,right}-{top,bottom}` and `object-{left,right}-{top,bottom}` in favor of `bg-{top,bottom}-{left,right}` and `object-{top,bottom}-{left,right}`.

## v4.2: webpack plugin, logical utilities, new palettes, and font features

Tailwind CSS v4.2 adds first-party webpack support and expands logical-property utilities for internationalized and writing-mode-aware layouts.

### Major additions

- `@tailwindcss/webpack` package for running Tailwind as a webpack plugin.
- New default color palettes: `mauve`, `olive`, `mist`, and `taupe`.
- Logical block-direction padding utilities:
  - `pbs-*` for `padding-block-start`
  - `pbe-*` for `padding-block-end`
- Logical block-direction margin utilities:
  - `mbs-*` for `margin-block-start`
  - `mbe-*` for `margin-block-end`
- Logical scroll padding utilities:
  - `scroll-pbs-*`
  - `scroll-pbe-*`
- Logical scroll margin utilities:
  - `scroll-mbs-*`
  - `scroll-mbe-*`
- Logical block border utilities:
  - `border-bs-*` for `border-block-start`
  - `border-be-*` for `border-block-end`
- Logical size utilities:
  - `inline-*`, `min-inline-*`, `max-inline-*` for `inline-size`, `min-inline-size`, `max-inline-size`
  - `block-*`, `min-block-*`, `max-block-*` for `block-size`, `min-block-size`, `max-block-size`
- Logical inset utilities:
  - `inset-s-*` for `inset-inline-start`
  - `inset-e-*` for `inset-inline-end`
  - `inset-bs-*` for `inset-block-start`
  - `inset-be-*` for `inset-block-end`
- `font-features-*` utility for `font-feature-settings`.

Examples:

```html
<aside class="pbs-6 pbe-8 border-bs border-gray-200">
  Logical block spacing
</aside>

<div class="inline-72 max-inline-full block-48">
  Writing-mode-aware sizing
</div>

<div class="absolute inset-s-4 inset-bs-2">
  Logical positioned element
</div>

<p class='font-features-["kern","liga"]'>
  OpenType feature control
</p>
```

### Deprecation

v4.2 deprecates `start-*` and `end-*` utilities in favor of `inset-s-*` and `inset-e-*` utilities.

Migration examples:

```html
<!-- old -->
<div class="absolute start-4 end-auto"></div>

<!-- v4.2+ preferred -->
<div class="absolute inset-s-4 inset-e-auto"></div>
```

The v4.2 patch series also improves canonicalization of `start-*` and `end-*` into the new `inset-s-*` and `inset-e-*` forms in upgrade tooling.

## v4.2 patch themes worth knowing

Patch releases through v4.2.4 include many fixes around:

- Vite import alias and `tsconfig` path resolution.
- `@import` and `@plugin` path resolution.
- Canonicalization of arbitrary values, shorthand utilities, tracking utilities, spacing, borders, scroll margin/padding, overflow, and overscroll.
- Safer upgrade behavior when the upgrade process is interrupted.
- Smarter migration from v3 `config.content`.
- Default ignored content files and directories, including `.env`, `.env.*`, and `.jj`.
- Scanner performance for large projects and JSONL/NDJSON files.

When debugging a v4.2 project, check if the user is on the latest v4.2 patch before diagnosing a behavior as a user-code bug. If a release newer than v4.2.4 exists, re-check the changelog before making patch-level claims.

## Choosing between v4.0, v4.1, and v4.2 advice

- If the user is still planning the migration from v3, give v4.0 migration guidance plus recommend upgrading directly to the latest v4.2 patch unless project constraints say otherwise.
- If the user asks about safelisting, source exclusions, masks, text shadows, pointer variants, or wrap utilities, v4.1 is the key release.
- If the user asks about webpack, logical layout utilities, `start-*`/`end-*` deprecation, new palettes, or `font-feature-settings`, v4.2 is the key release.
- If the user sees strange migration output or class rewriting, check the v4.2 patch changelog for canonicalization fixes.
