# AGENTS.md

## Project Description

pi-estack is the personal [pi-package](https://pi.dev/docs/latest/packages) for [evanlouie](https://github.com/evanlouie/) containing an assortment of pi extensions/skills/prompts/themes.

## Developer Notes

- `bun` is used for package management.
- `node` is used as runtime.

## Rules

- **ALWAYS** read through the pi documentation regarding extensions, skills, prompt templates, themes, and packages, prior to working on this project.
- `bun` for package management.
- `bun run lint` for linting/type-checking.
- Use [neverthrow](https://github.com/supermacro/neverthrow) for error handling.
- Use [ts-pattern](https://github.com/gvergnaud/ts-pattern) extensively for pattern matching; `if`/`else`/`switch` is **banned**.
