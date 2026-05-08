# AGENTS.md

## Project Description

pi-estack is the personal Pi package for [evanlouie](https://github.com/evanlouie/) containing an assortment of Pi extensions/skills/prompts/themes.

**ALWAYS** read through the Pi documentation regarding extensions, skills, prompt templates, themes, and packages, prior to working on this project.

## Developer Guidelines

### JavaScript/TypeScript

- `bun` for package management.
- `bun run lint` for linting/type-checking.
- Use [neverthrow](https://github.com/supermacro/neverthrow) for error handling.
- Use [ts-pattern](https://github.com/gvergnaud/ts-pattern) extensively for pattern matching; `if`/`else`/`switch` is **banned**.

### Python

- `uv` for package management and running scripts.
- `uvx` for running scripts with auto-installed dependencies.
- `ruff` for linting and formatting.
