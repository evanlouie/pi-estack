# TOON Agent Skill

This skill helps agents work with Token-Oriented Object Notation (TOON): JSON↔TOON conversion, validation, prompt-oriented formatting, delimiter/key-folding choices, and `.toon` authoring.

## Layout

```text
toon/
├── SKILL.md
├── scripts/
│   └── toon.ts
├── references/
│   └── toon-format-guide.md
└── evals/
    └── evals.json
```

## Install

Copy the `toon/` directory into a skills directory supported by your agent, for example:

```text
.agents/skills/toon/
```

The directory name must remain `toon` because the `name` field in `SKILL.md` must match the parent directory.

## Script

The bundled script is a self-contained Deno TypeScript wrapper around the pinned official CLI, `npx @toon-format/cli@2.2.0`. It requires Deno plus Node/npm/npx.

```bash
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts --help
```

Common commands:

```bash
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode input.json -o output.toon
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode input.toon -o output.json
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts validate input.toon
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts roundtrip input.json --toon-output output.toon -o restored.json
```

## Sources

- Reference implementation: https://github.com/toon-format/toon
- Specification: https://github.com/toon-format/spec
- Documentation: https://toonformat.dev
