---
name: agent-skills
description: >-
  Use this skill when creating, reviewing, updating, maintaining, or optimizing
  generic Agent Skills, including SKILL.md frontmatter, discovery,
  descriptions, evals, references, assets, and scripts.
---

# Agent Skills

Use this guidance for work on generic Agent Skills that can be used across compatible agent clients.

## Required reading

Before creating or changing a skill, read the relevant current Agent Skills docs:

- <https://agentskills.io/specification>
- <https://agentskills.io/skill-creation/best-practices>
- <https://agentskills.io/skill-creation/optimizing-descriptions>
- <https://agentskills.io/skill-creation/evaluating-skills>
- <https://agentskills.io/skill-creation/using-scripts>

Read <https://agentskills.io/skill-creation/quickstart> when creating a skill from scratch.

## Review checklist

1. **Discovery**
   - A directory-style skill must contain `SKILL.md` at the skill directory root.
   - The `name` frontmatter value must match the parent directory name.
   - Directory-style skills should use `SKILL.md` for broad Agent Skills compatibility.

2. **Frontmatter**
   - Required fields: `name` and `description`.
   - `name`: 1-64 characters, lowercase letters/numbers/hyphens only, no leading/trailing hyphen, no `--`.
   - `description`: 1-1024 characters, explains what the skill does and when to use it. Prefer direct trigger language such as “Use this skill when...”.
   - Optional Agent Skills fields such as `license`, `compatibility`, `metadata`, and `allowed-tools` should be used only when they add clear value.

3. **Instructions**
   - Keep `SKILL.md` lean, actionable, and focused on knowledge the agent would not reliably infer.
   - Prefer ordered workflows, checklists, gotchas, and validation loops over broad best-practice statements.
   - Use relative paths from the skill root for references, scripts, assets, and eval files.
   - Tell the agent when to load each reference file instead of adding generic “see references” pointers.
   - Preserve the skill’s intent when editing; avoid broad rewrites unless the existing instructions are misleading or stale.

4. **Supporting files**
   - If README, evals, references, assets, or scripts exist, confirm they agree with `SKILL.md` and with each other.
   - For `evals/evals.json`, confirm `skill_name` matches the skill `name` and every listed file path exists relative to the skill root.
   - Check internal Markdown links and relative file references for broken targets.

5. **Scripts**
   - Put reusable helpers in `scripts/` and reference them with relative paths.
   - Prefer self-contained scripts with inline dependencies when practical; pin dependency versions.
   - Scripts should avoid interactive prompts, provide useful `--help`, print actionable errors, use meaningful exit codes, and separate structured stdout from diagnostic stderr.
   - For destructive or stateful actions, require explicit flags and offer dry-run behavior when practical.

6. **Validation**
   - Run lightweight checks when practical: frontmatter parsing, link/path checks, JSON validation for evals, and safe script `--help` invocations.
   - If available, run `skills-ref validate <skill-directory>`.
   - Keep validation bounded and avoid commands that install large dependencies, run indefinitely, or mutate unrelated project files unless the user asked for that.
