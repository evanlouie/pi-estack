# beautiful-mermaid skill

Agent Skill for using
[`beautiful-mermaid`](https://github.com/lukilabs/beautiful-mermaid), the
MIT-licensed npm package for rendering Mermaid diagrams as polished SVGs or
ASCII/Unicode text.

## Contents

```text
beautiful-mermaid/
├── SKILL.md
├── README.md
├── deno.json
├── tsconfig.json
├── evals/
│   ├── eval_queries.json
│   └── evals.json
└── scripts/
    └── render.ts
```

## Quick smoke test

From this directory:

```bash
printf 'graph LR\n  A[Start] --> B[Done]\n' | \
  deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
    scripts/render.ts --format ascii --color-mode none
```

Render an SVG file:

```bash
printf 'graph TD\n  A[Start] --> B{Decision}\n  B --> C[Ship]\n' > /tmp/diagram.mmd

deno run --no-lock --node-modules-dir=none --allow-read --allow-write \
  scripts/render.ts --format svg --theme tokyo-night /tmp/diagram.mmd -o /tmp/diagram.svg
```

The script imports `npm:beautiful-mermaid@1.1.3` through Deno and writes to
stdout unless `--output` is provided. `deno.json` supplies Deno runtime libs for
Deno's checker when commands are run from this skill directory; from the repo
root, pass `--config skills/beautiful-mermaid/deno.json` to `deno check` if you
want Deno type-checking instead of runtime execution.
