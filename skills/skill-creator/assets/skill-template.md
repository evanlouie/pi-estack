---
name: { { skill-name } }
description: >
  Use this skill when the user asks to {{primary-intent}}, including {{adjacent-intents-or-implicit-phrasing}}.
  It helps by {{core-actions}}.
# compatibility: {{specific runtime/client requirements, if any; omit this line if none}}
metadata:
  version: "0.1.0"
---

# {{Skill Title}}

## When to use this skill

Use this skill when {{specific activation boundary}}.

Do not use this skill when {{near-miss boundary, if useful}}.

## Inputs to collect

- {{Required input 1}}
- {{Required input 2}}
- {{Optional context}}

## Workflow

1. {{First concrete step}}
2. {{Second step or decision}}
3. {{Validation step}}
4. {{Finalize or deliver output}}

## Output format

{{Provide a concrete template if consistency matters.}}

## Gotchas

- {{Non-obvious issue the agent would likely miss}}
- {{Project/client/tool-specific convention}}

## Available scripts

- `scripts/{{script-name}}` — {{What it does and when to run it}}

## References and assets

- Read `references/{{reference-file}}.md` when {{specific condition}}.
- Use `assets/{{asset-file}}` when {{specific condition}}.

## Validation

Before finalizing, verify:

- [ ] {{Objective check 1}}
- [ ] {{Objective check 2}}
- [ ] {{Output or artifact exists and is usable}}
