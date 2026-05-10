# open-json-ui Agent Skill

A reusable Agent Skill for generating, reviewing, validating, and adapting Open-JSON-UI declarative generative UI payloads.

## Contents

- `SKILL.md` — required Agent Skills metadata and main instructions.
- `references/spec-notes.md` — practical Open-JSON-UI dialect and component guidance.
- `references/examples.md` — sample payloads.
- `scripts/validate_open_json_ui.py` — permissive JSON sanity validator.
- `assets/open-json-ui-screen.schema.json` — helper JSON Schema for the default screen/content dialect.
- `evals/evals.json` — starter eval cases.

## Validate a payload

```bash
uv run scripts/validate_open_json_ui.py payload.json --pretty
```

The validator is intentionally permissive and should not replace a target renderer's official schema.
