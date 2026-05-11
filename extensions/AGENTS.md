## Developer Guidelines

This guidance ONLY applies for code under `./extensions`.

### JavaScript/TypeScript

- `bun` for package management.
- `bun run lint` for linting/type-checking.
- Use [neverthrow](https://github.com/supermacro/neverthrow) for error handling.
- Use [ts-pattern](https://github.com/gvergnaud/ts-pattern) extensively for
  pattern matching; `if`/`else`/`switch` is **banned**.

### Python

- `uv` for package management and running scripts.
- `uvx` for running scripts with auto-installed dependencies.
- `ruff` for linting and formatting.
