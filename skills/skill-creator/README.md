# skill-creator

Agent Skill for creating, writing, revising, validating, packaging, and
evaluating Agent Skills.

## Install

Copy the `skill-creator/` directory into a skills directory such as:

```text
.agents/skills/skill-creator/
```

Then confirm your client discovers the skill. In clients that support a
`/skills` command, use that command after reloading the project/session.

## Use

Ask for tasks such as:

- “Create an Agent Skill from this workflow.”
- “Improve this SKILL.md description so it triggers reliably.”
- “Validate and package this skill.”
- “Write trigger evals and output evals for this skill.”

## Bundled scripts

Run from the skill directory root:

```bash
uv run scripts/validate_skill.py .
uv run scripts/scaffold_skill.py my-skill --description "Use this skill when ..." --output .agents/skills --with-evals
uv run scripts/split_trigger_evals.py evals/eval_queries.json --train-out evals/train_queries.json --validation-out evals/validation_queries.json
```

## Contents

```text
skill-creator/
├── SKILL.md
├── README.md
├── assets/
├── evals/
├── references/
└── scripts/
```
