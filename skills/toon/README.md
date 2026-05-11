# TOON Agent Skill

This skill helps agents work with Token-Oriented Object Notation (TOON):
JSON↔TOON conversion, validation, prompt-oriented formatting,
delimiter/key-folding choices, and `.toon` authoring.

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

Copy the `toon/` directory into a skills directory supported by your agent, for
example:

```text
.agents/skills/toon/
```

The directory name must remain `toon` because the `name` field in `SKILL.md`
must match the parent directory.

## Script

The bundled script is a self-contained Deno TypeScript helper that uses the
pinned official package, `npm:@toon-format/toon@2.2.0`. It requires Deno 2.x
with npm specifier support and does not require Node/npm/npx. First run may need
network access to populate Deno's global cache.

```bash
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts --help
```

The examples use `--node-modules-dir=none` to avoid creating a local
`node_modules` directory and `--no-lock` to avoid creating or updating a
lockfile in the working tree. Reproducibility relies on the exact
`@toon-format/toon@2.2.0` package pin.

Common commands:

```bash
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts encode input.json -o output.toon
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts decode input.toon -o output.json
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts validate input.toon
deno run --no-lock --node-modules-dir=none --allow-read --allow-write scripts/toon.ts roundtrip input.json --toon-output output.toon -o restored.json
```

## Sources

- Reference implementation: https://github.com/toon-format/toon
- Specification: https://github.com/toon-format/spec
- Documentation: https://toonformat.dev
