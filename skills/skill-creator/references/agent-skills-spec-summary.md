# Agent Skills Specification Summary

Use this when checking whether a skill package follows the Agent Skills format.

## Required structure

A skill is a directory containing a required `SKILL.md` file.

```text
skill-name/
├── SKILL.md          # required: YAML frontmatter + markdown instructions
├── scripts/          # optional executable code
├── references/       # optional focused documentation
├── assets/           # optional templates, schemas, sample files, static resources
└── evals/            # optional tests and fixtures
```

## `SKILL.md` format

`SKILL.md` must start with YAML frontmatter followed by Markdown body content.

Minimal valid file:

```markdown
---
name: skill-name
description: A description of what this skill does and when to use it.
---

# Skill Name

[Instructions]
```

## Frontmatter fields

Required:

- `name`: 1-64 characters; lowercase letters, numbers, and hyphens; no leading/trailing hyphen; no consecutive hyphens; must match the parent directory name.
- `description`: 1-1024 characters; describe what the skill does and when to use it.

Optional:

- `license`: short license name or reference to bundled license file.
- `compatibility`: 1-500 characters if present; only include real environment requirements.
- `metadata`: arbitrary key-value mapping; use unique key names when possible.
- `allowed-tools`: space-separated pre-approved tools; experimental, client support varies.

## Body guidance

The body is unrestricted Markdown, but should usually include:

- Step-by-step instructions
- Examples of inputs and outputs
- Common edge cases or gotchas
- Validation steps
- Relative references to scripts, reference docs, and assets

Keep the body focused. If the content grows long, move detailed reference material into separate files and tell the agent exactly when to load each file.

## Optional directories

### `scripts/`

Contains executable code the agent can run. Scripts should be self-contained, document dependencies, emit helpful errors, and handle edge cases gracefully.

### `references/`

Contains focused documentation the agent reads only when needed. Keep individual files narrow and easy to reference.

### `assets/`

Contains static resources such as document templates, schemas, example files, images, or lookup tables.

### `evals/`

Not required by the core spec, but useful for repeatable skill quality work. Store trigger evals, output-quality evals, and fixtures here.

## Progressive disclosure

Agent Skills use progressive disclosure:

1. At startup, the agent loads only `name` and `description`.
2. When a task matches a description, the full `SKILL.md` body loads.
3. Supporting files load only when the instructions reference them.

Design the skill so the description is strong, `SKILL.md` contains only high-value always-needed instructions, and large details live in on-demand files.

## File references

Reference bundled files with paths relative to the skill root:

```markdown
Read `references/api-errors.md` if the API returns a non-200 response.
Run `scripts/validate.py output.json` before finalizing.
Use `assets/report-template.md` for formal reports.
```

Avoid deeply nested chains where one reference points to another reference. Prefer one-level references from `SKILL.md`.

## Default installation location

For cross-client interoperability, suggest project-level installation under:

```text
.agents/skills/<skill-name>/SKILL.md
```

Some clients also scan user-level or client-specific locations. Use the client’s documentation when the target environment is known.
