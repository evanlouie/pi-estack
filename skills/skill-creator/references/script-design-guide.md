# Script Design Guide for Skills

Use this before adding or revising files in `scripts/`.

## When to bundle a script

Bundle a script when repeated logic is easier, safer, or more reliable as code
than as instructions. Good candidates:

- Parsing or normalizing structured files
- Validating plans before execution
- Generating deterministic outputs
- Aggregating eval results
- Transforming data with many edge cases
- Running a fixed command sequence that agents often mistype

Do not bundle a script for a one-line command unless the command is fragile or
needs a stable interface.

## Python scripts

Use PEP 723 metadata so scripts are self-contained and can be run with `uv run`.

```python
#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<4"
# dependencies = []
# ///
```

When dependencies are needed, pin them with PEP 508 constraints:

```python
# dependencies = [
#   "beautifulsoup4>=4.12,<5",
# ]
```

Run with:

```bash
uv run scripts/example.py --help
```

## TypeScript scripts

Use Deno for TypeScript. Pin package versions in import specifiers, including
`npm:` package specifiers.

```ts
#!/usr/bin/env -S deno run --allow-read

import * as cheerio from "npm:cheerio@1.0.0";
```

No `package.json` or `node_modules` is needed unless the user explicitly wants a
package project. Declare required Deno permissions in the shebang or usage
examples and prefer the least privileges needed for the script.

## Agent-friendly CLI requirements

Scripts must work in non-interactive shells. They should never wait for prompts,
password dialogs, or confirmation menus.

Use command-line flags, stdin, environment variables, or explicit config files.
For missing required input, print a clear error and usage hint.

Good error:

```text
Error: --env is required. Options: development, staging, production.
Usage: uv run scripts/deploy.py --env staging --tag v1.2.3
```

## `--help` output

Every reusable script should provide concise help text showing:

- What the script does
- Required arguments
- Optional flags and defaults
- Examples
- Output format
- Exit-code meanings when nontrivial

## Output conventions

- Structured data goes to stdout: JSON, CSV, TSV, or a clearly documented
  format.
- Progress, warnings, and diagnostics go to stderr.
- Use deterministic output where possible.
- Limit default output size; add `--limit`, `--offset`, or `--output` for large
  results.

## Safety and reliability

Prefer:

- Idempotent behavior: safe to retry
- `--dry-run` for destructive or stateful operations
- Explicit `--confirm` or `--force` flags for risky actions
- Meaningful nonzero exit codes
- Clear validation errors with examples of valid input
- Atomic writes for generated files where possible

## Mention scripts in `SKILL.md`

List scripts and when to run them:

````markdown
## Available scripts

- `scripts/validate_mapping.py` — Validate a generated mapping before applying
  it.

## Workflow

After creating `mapping.json`, run:

```bash
uv run scripts/validate_mapping.py form_fields.json mapping.json
```
````

If validation fails, fix the fields the script names and rerun validation.

```
Do not assume the agent will discover scripts by browsing the folder. Surface them in the skill body.
```
