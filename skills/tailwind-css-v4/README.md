# tailwind-css-v4 Agent Skill

This Agent Skill helps coding agents install, migrate, configure, debug, and write Tailwind CSS v4.x projects using the v4 CSS-first workflow.

## Install

Copy the `tailwind-css-v4` directory into a skills directory supported by your agent, for example:

```bash
mkdir -p .agents/skills
cp -R tailwind-css-v4 .agents/skills/
```

The required entry point is `SKILL.md`. Reference files, eval files, and the self-contained ESM Bun audit script are optional resources loaded on demand.

## Optional audit script

```bash
bun run scripts/audit-tailwind-v4.ts /path/to/project
bun run scripts/audit-tailwind-v4.ts /path/to/project --json
```

The ESM audit script is non-destructive and reports common v3/v4 setup mismatches.
