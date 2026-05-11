---
name: beautiful-mermaid
description: >-
  Use this skill when the user asks to use lukilabs/beautiful-mermaid or the beautiful-mermaid npm package, render Mermaid diagrams as polished SVGs or ASCII/Unicode text, integrate Mermaid rendering into TypeScript/JavaScript/React apps, customize themes/colors/fonts/Shiki-derived palettes, or debug beautiful-mermaid parser/rendering behavior. Do not use for ordinary Mermaid authoring unless beautiful-mermaid output or integration is part of the task.
license: MIT
compatibility: Requires Node.js/npm, Bun, pnpm, or Deno 2.x for installing or running the beautiful-mermaid npm package. The bundled script uses Deno and may need network access on first run to populate Deno's npm cache.
metadata:
  source_repository: "https://github.com/lukilabs/beautiful-mermaid"
  npm_package: "beautiful-mermaid@1.1.3"
---

# beautiful-mermaid

`beautiful-mermaid` renders Mermaid source to polished SVG strings or
terminal-friendly ASCII/Unicode art. It is synchronous, DOM-free, themeable with
CSS custom properties, and most useful when the user wants better-looking
Mermaid output or wants Mermaid rendering embedded in a JavaScript/TypeScript
application.

## Default workflow

1. Clarify the target output and context:
   - **One-off artifact**: use `scripts/render.ts` to generate `.svg` or text.
   - **Application integration**: add `beautiful-mermaid` to the project and use
     the package API directly.
   - **React UI**: render with `useMemo()` so diagrams appear without an async
     flash.
   - **Terminal/CLI/logs**: use `renderMermaidASCII()` with Unicode by default,
     or `useAscii: true` when plain 7-bit output is required.
2. Confirm the diagram type is supported: flowchart/state, sequence, class, ER,
   and `xychart-beta`. If the user needs Gantt, pie, Git graph, journey,
   mindmap, C4, requirement, or another Mermaid feature outside this set, say
   that beautiful-mermaid may not support it and consider Mermaid CLI or another
   renderer instead.
3. Normalize Mermaid source before rendering. Prefer a standalone header line
   (`graph LR`, `flowchart TD`, `sequenceDiagram`, etc.) followed by one
   statement per line. Avoid semicolon-only one-liners such as
   `graph LR; A --> B` because current parser behavior is more reliable with
   multiline input.
4. Pick a theme strategy:
   - Start with `THEMES['tokyo-night']`, `THEMES['github-light']`, etc. for
     built-in themes.
   - For custom themes, provide at least `bg` and `fg`; optional `line`,
     `accent`, `muted`, `surface`, and `border` enrich the result.
   - For app theme switching, pass CSS variable references like
     `bg: 'var(--background)'`, `fg: 'var(--foreground)'`, and
     `transparent: true` so the SVG repaints through CSS without re-rendering.
   - When the app already uses Shiki, use `fromShikiTheme()` to derive diagram
     colors from a VS Code/Shiki theme object.
5. Validate by rendering a small representative diagram. For SVG output, confirm
   the output starts with `<svg` and inspect it in a browser or viewer. For
   ASCII output, confirm box drawing, spacing, direction, and color mode are
   suitable for the target terminal or Markdown renderer.

## Bundled render script

Use this from the skill root for one-off rendering or smoke tests. It imports
`npm:beautiful-mermaid@1.1.3` through Deno.

```bash
deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
  scripts/render.ts --format svg --theme tokyo-night diagram.mmd -o diagram.svg

deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
  scripts/render.ts --format ascii --color-mode none diagram.mmd
```

Useful options:

```bash
# See all supported flags.
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/render.ts --help

# List built-in theme names.
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/render.ts --list-themes

# Render stdin to a transparent SVG using CSS-variable colors.
printf 'graph LR\n  A[Start] --> B[Done]\n' | \
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
    scripts/render.ts --format svg --transparent \
    --bg 'var(--background)' --fg 'var(--foreground)' -o diagram.svg

# Produce plain ASCII instead of Unicode box drawing.
deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
  scripts/render.ts --format ascii --use-ascii --color-mode none diagram.mmd
```

## Package API patterns

Install in the project with the user's package manager:

```bash
npm install beautiful-mermaid
# or: pnpm add beautiful-mermaid
# or: bun add beautiful-mermaid
```

SVG rendering is synchronous:

```typescript
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";

const source = `graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]`;

const svg = renderMermaidSVG(source, {
  ...THEMES["tokyo-night"],
  transparent: true,
  font: "Inter",
  padding: 32,
});
```

ASCII/Unicode rendering:

```typescript
import { renderMermaidASCII } from "beautiful-mermaid";

const text = renderMermaidASCII(
  `graph LR
  A --> B
  B --> C`,
  {
    useAscii: false,
    colorMode: "none",
  },
);
```

React integration:

```tsx
import * as React from "react";
import { renderMermaidSVG } from "beautiful-mermaid";

export function MermaidDiagram({ code }: { code: string }) {
  const result = React.useMemo(() => {
    try {
      return {
        svg: renderMermaidSVG(code, {
          bg: "var(--background)",
          fg: "var(--foreground)",
          accent: "var(--accent)",
          transparent: true,
        }),
        error: null,
      };
    } catch (error) {
      return {
        svg: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [code]);

  if (result.error) return <pre>{result.error.message}</pre>;
  return <div dangerouslySetInnerHTML={{ __html: result.svg! }} />;
}
```

Only use `dangerouslySetInnerHTML` when the Mermaid source and generated SVG are
trusted or have been sanitized through the app's approved SVG/HTML sanitizer. If
users can submit Mermaid source, gate or sanitize before insertion and keep that
security note in any generated React example.

## API reminders

- `renderMermaidSVG(text, options?): string` renders synchronously.
- `renderMermaidSVGAsync(text, options?): Promise<string>` is a promise wrapper
  for async call sites.
- `renderMermaidASCII(text, options?): string` renders Unicode/ASCII text.
- `parseMermaid(text)` is the public parser for flowchart/state graphs only;
  for sequence, class, ER, and XY charts, use the render APIs unless you have
  tested a specific internal parser path.
- `THEMES` contains built-in diagram palettes.
- `fromShikiTheme(theme)` maps VS Code/Shiki theme colors to diagram colors.

Common SVG options: `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border`,
`font`, `transparent`, `padding`, `nodeSpacing`, `layerSpacing`,
`componentSpacing`, and `interactive` for XY chart tooltips.

Common ASCII options: `useAscii`, `paddingX`, `paddingY`, `boxBorderPadding`,
`colorMode` (`none`, `auto`, `ansi16`, `ansi256`, `truecolor`, or `html`), and
`theme`.

## Gotchas

- The library is not a complete drop-in replacement for every Mermaid diagram
  type. Stay within the supported subset unless you have tested the specific
  syntax.
- Current parser behavior is more reliable with multiline Mermaid source than
  semicolon-packed one-liners.
- CSS-variable theming is excellent for live UIs, but exported standalone SVGs
  may need concrete color values if viewed outside the host app's CSS cascade.
- SVG insertion in web apps should still follow the app's trust and sanitization
  model. Treat Mermaid text from untrusted users as untrusted input.
- For Markdown, logs, or CI comments, prefer `colorMode: 'none'` to avoid ANSI
  escapes leaking into rendered text.
- Use `transparent: true` when embedding SVGs over an existing surface; omit it
  when exporting a self-contained diagram with its own background.
