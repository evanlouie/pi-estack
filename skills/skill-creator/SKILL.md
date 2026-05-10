---
name: skill-creator
description: >
  Use this skill when the user asks to create, write, revise, validate, package,
  or evaluate an Agent Skill, SKILL.md file, skill description, bundled script,
  references/assets layout, or skill eval set. Also use when extracting a reusable
  skill from a completed workflow or project artifacts.
compatibility: Requires Python 3.11+ and uv to run bundled Python scripts; no network access required for normal use.
metadata:
  version: "1.0.1"
  docs-reviewed: "2026-05-10"
---

# Skill Creator

Create standards-compliant Agent Skills that are useful, well-scoped, easy to trigger, and easy to validate.

## When to use this skill

Use this skill for any request involving Agent Skills authoring, including:

- Creating a new skill directory or `SKILL.md`
- Revising or improving an existing skill
- Turning a completed workflow, runbook, style guide, API doc, or repeated correction into a reusable skill
- Writing or optimizing the `description` field so the skill triggers reliably
- Adding `scripts/`, `references/`, `assets/`, or `evals/` to a skill package
- Validating a skill against the Agent Skills format
- Designing trigger evals or output-quality evals for a skill

Do not use this skill for general prompt engineering, ordinary documentation, or building an agent client unless the task specifically concerns the Agent Skills format. For agent-client implementation, use the Agent Skills client implementation documentation rather than treating it as a skill-authoring task.

## Documentation freshness

When internet access is available and the user asks for standards-compliant or current Agent Skills work, review `https://agentskills.io/llms.txt` and the pages it lists before finalizing. When internet access is unavailable, use the bundled summaries in `references/` and state that the live documentation was not rechecked.

Load reference files only when needed:

- `references/agent-skills-spec-summary.md` — format, frontmatter, structure, validation rules.
- `references/authoring-playbook.md` — drafting, scoping, progressive disclosure, reusable instruction patterns.
- `references/description-eval-playbook.md` — trigger descriptions, trigger evals, output evals, iteration.
- `references/script-design-guide.md` — bundled script requirements and implementation patterns.

## Available scripts

Run scripts from the skill directory root using `uv run`:

- `scripts/scaffold_skill.py` — scaffold a new skill directory from a name and description.
- `scripts/validate_skill.py` — validate a skill directory or `SKILL.md` and report issues.
- `scripts/split_trigger_evals.py` — split `eval_queries.json` into train and validation sets.

Examples:

```bash
uv run scripts/scaffold_skill.py data-cleanup \
  --description "Clean, normalize, and validate tabular data files. Use when the user asks to prepare messy CSV, TSV, or spreadsheet data for analysis." \
  --output .agents/skills \
  --with-scripts --with-references --with-assets --with-evals

uv run scripts/validate_skill.py .agents/skills/data-cleanup

uv run scripts/split_trigger_evals.py .agents/skills/data-cleanup/evals/eval_queries.json \
  --train-out train_queries.json --validation-out validation_queries.json
```

## Authoring workflow

### 1. Understand the reusable capability

First identify the capability the user wants to package. Gather only the details that materially affect behavior:

- Intended task class and user intents
- Source materials: completed workflow transcript, runbook, API docs, schemas, templates, review comments, incident reports, examples, or existing skill
- Inputs and outputs the skill should handle
- Agent environment and client assumptions
- Tools, commands, libraries, or scripts that should be used
- Non-obvious gotchas, edge cases, policies, safety constraints, or project conventions

If the user has not provided enough context, still produce the best useful draft. Mark assumptions and leave clear placeholders rather than blocking on questions.

### 2. Decide whether a skill is warranted

A good skill packages knowledge the agent would not reliably infer on its own: domain procedures, project conventions, fragile command sequences, special formats, recurring gotchas, reusable validation steps, or tool-specific workflows. If the request is a one-off answer or generic advice, create a very small skill or recommend a different artifact.

Scope the skill as one coherent unit of work. Avoid a skill so narrow that many skills must load for one task, and avoid a skill so broad that the description cannot trigger precisely.

### 3. Build the directory structure

At minimum, create:

```text
<skill-name>/
└── SKILL.md
```

Add optional directories only when they improve reliability:

```text
<skill-name>/
├── SKILL.md
├── scripts/      # reusable executable logic
├── references/   # focused docs loaded on demand
├── assets/       # templates, sample files, schemas, static resources
└── evals/        # trigger/output eval cases and fixtures
```

Use `.agents/skills/<skill-name>/` as the default installation path when the user asks where to put the skill.

### 4. Write valid frontmatter

Use YAML frontmatter at the top of `SKILL.md`. Required fields:

```yaml
---
name: <skill-name>
description: <imperative description of what the skill does and when to use it>
---
```

Rules:

- `name` must match the parent directory, use lowercase letters/numbers/hyphens only, be 1-64 characters, not start or end with a hyphen, and not contain consecutive hyphens.
- `description` must be non-empty and at most 1024 characters.
- Include `compatibility` only for real environment requirements.
- Include `license` and `metadata` only when useful.
- Avoid experimental frontmatter unless the target client supports it.

### 5. Write a triggerable description

The description decides whether the agent loads the skill. Write it as an instruction to the agent, not as a product blurb.

Good pattern:

```yaml
description: >
  Use this skill when the user asks to [intent], including [nearby intents],
  [file types/tools/domains], or [implicit phrasing]. It helps by [core actions].
```

Keep the description concise but explicit. Include the user intents, artifacts, file types, tools, or domain terms that should trigger the skill. Add boundaries if false triggers are likely.

### 6. Draft the `SKILL.md` body

Prefer concise, stepwise procedures over broad declarations. Include what the agent would otherwise miss; omit generic knowledge. A strong body usually contains:

```markdown
# <Skill Title>

## When to use this skill
[Specific activation boundary.]

## Inputs to collect
[Only required context and files.]

## Workflow
1. [First concrete step.]
2. [Decision or transformation.]
3. [Validation step.]
4. [Finalize output.]

## Output format
[Template or exact structure if consistency matters.]

## Gotchas
- [Non-obvious fact, failure mode, or correction.]

## Available scripts / references / assets
[Relative paths and when to load or run them.]
```

Calibrate specificity to risk. Be prescriptive for fragile, destructive, or sequence-dependent operations. Give defaults rather than menus when several tools could work. Explain why a rule exists when context-dependent judgment matters.

### 7. Use progressive disclosure

Keep `SKILL.md` focused on the instructions needed on every run. Put detailed documentation, long examples, schemas, and large templates in separate files. Reference them with relative paths and a clear loading condition:

```markdown
Read `references/api-errors.md` if the API returns a non-200 status code.
Use `assets/report-template.md` when the user asks for a formal report.
Run `scripts/validate_mapping.py` after creating a field mapping.
```

Avoid vague references such as “see references for details.” The agent needs to know exactly when to load each file.

### 8. Add scripts when repeated logic matters

Bundle a script when the agent would otherwise repeatedly reinvent parsing, validation, generation, or scoring logic. Scripts should be self-contained, non-interactive, documented with `--help`, and safe to retry. See `references/script-design-guide.md` before adding scripts.

For Python scripts, use PEP 723 metadata and run with `uv run`. For TypeScript scripts, use Deno and pin package versions in import specifiers (for example, `npm:pkg@version`). Prefer structured stdout and diagnostics on stderr.

### 9. Add evals before treating the skill as done

Create at least lightweight tests:

- Trigger evals: realistic should-trigger and should-not-trigger prompts in `evals/eval_queries.json`.
- Output evals: realistic task prompts, expected outputs, optional input files, and assertions in `evals/evals.json`.

Use `assets/eval_queries.template.json` and `assets/evals.template.json` as starting points.

### 10. Validate and package

Before returning a skill, run or emulate these checks:

```bash
uv run scripts/validate_skill.py <skill-dir>
```

Fix errors. Warnings are acceptable only if intentional and explained.

Package the skill as a directory or archive that preserves this shape:

```text
<skill-name>/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── evals/
```

## Revision workflow

When revising an existing skill:

1. Inspect `SKILL.md`, bundled files, and any eval results or user feedback.
2. Identify whether failures are due to triggering, unclear instructions, missing source context, bad scripts, or over-broad scope.
3. Improve the general rule, not just the failing example.
4. Remove instructions that waste work or compete with the main workflow.
5. Validate again and summarize what changed.

Use `assets/improvement-prompt-template.md` when asking another model or reviewer to propose improvements from eval signals.

## Output expectations

When creating or revising a skill for the user, provide:

- The skill directory or files, preferably packaged as an archive when file creation is available.
- A brief directory tree.
- Any validation results.
- Assumptions or limitations, especially if live docs or required source materials were unavailable.
- Installation hint: copy the skill directory to `.agents/skills/<skill-name>/` or the target client’s skills directory.
