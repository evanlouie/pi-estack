# Agent Skill Authoring Playbook

Use this when drafting or revising the instructions inside a skill.

## Start from real expertise

Good skills capture specific knowledge that a general-purpose model would not reliably infer. Useful source material includes:

- Completed agent workflows and transcripts
- User corrections and preferences
- Internal documentation, runbooks, style guides, and SOPs
- API specs, schemas, config files, and templates
- Code review comments, incident reports, and issue history
- Real failures and fixes

Avoid generic filler such as “follow best practices” unless the skill defines the concrete practice.

## Extract reusable patterns

When turning a completed workflow into a skill, capture:

- The successful sequence of actions
- Decisions the agent made and the criteria behind them
- Corrections the user supplied
- Required inputs and output shape
- Tools, libraries, commands, or file paths that mattered
- Edge cases, gotchas, and validation checks

Write a method that generalizes beyond the single example.

## Scope the skill

A good skill covers one coherent unit of work. Use this test:

- If the skill has multiple unrelated triggers, split it.
- If a normal task needs three or more skills to complete one workflow, merge related pieces.
- If the description needs many exceptions, the scope is probably wrong.
- If the agent already does the task reliably without special context, the skill may not be needed.

## Spend context wisely

Once activated, the full `SKILL.md` competes with the user request, tools, conversation history, and other active skills. Add only material that changes agent behavior.

Keep in `SKILL.md`:

- Non-obvious gotchas the agent must see before acting
- Core workflow steps
- Required commands or scripts
- Validation gates
- Output templates short enough to fit inline

Move to references/assets:

- Long schemas
- API error catalogs
- Long examples
- Style guides
- Large output templates
- Detailed background documentation

## Match specificity to fragility

Be flexible where many valid approaches exist. Explain the purpose of the step so the agent can adapt.

Be prescriptive where order, safety, compliance, or exact commands matter. Use exact commands and say not to modify them when appropriate.

## Prefer defaults over menus

When several tools could work, choose a default. Mention alternatives only as escape hatches.

Weak:

```markdown
You can use pypdf, pdfplumber, PyMuPDF, or pdf2image.
```

Stronger:

```markdown
Use pdfplumber for text extraction. For scanned documents requiring OCR, use pdf2image with pytesseract instead.
```

## Favor procedures over declarations

A skill should teach an approach, not encode one answer. Use reusable algorithms, checklists, and validation loops.

Weak:

```markdown
For the quarterly report, join orders to customers and filter EMEA.
```

Stronger:

```markdown
1. Read the schema in `references/schema.yaml`.
2. Choose joins from declared foreign keys.
3. Apply filters from the user request.
4. Aggregate numeric columns only after verifying units and currency.
```

## Useful instruction patterns

### Gotchas

Put non-obvious facts in a dedicated `## Gotchas` section. These are high-value because they prevent predictable mistakes.

```markdown
## Gotchas
- The production API returns `accountId`, but the warehouse uses `user_id`; they refer to the same entity.
- `/health` only confirms the web server is running. Use `/ready` for database readiness.
```

### Output templates

Use concrete templates when formatting consistency matters.

```markdown
## Output format

```text
Summary: [one sentence]
Files changed: [list]
Validation: [commands run and result]
Next steps: [only if required]
```
```

### Checklists

Use checklists for multi-step workflows or workflows with dependencies.

```markdown
## Workflow checklist
- [ ] Inspect inputs and constraints.
- [ ] Create the plan.
- [ ] Validate the plan.
- [ ] Execute the plan.
- [ ] Verify outputs.
```

### Validation loops

Tell the agent how to validate, interpret failure, and retry.

```markdown
1. Generate `field_values.json`.
2. Run `scripts/validate_fields.py form_fields.json field_values.json`.
3. If validation fails, fix only the invalid fields and rerun validation.
4. Do not fill the form until validation passes.
```

## Common anti-patterns

- Overly broad skills that trigger on many unrelated tasks
- Long generic explanations the model already knows
- “See references/” without a specific loading condition
- Many equally presented tool choices with no default
- Fragile exact wording requirements in output evals
- Scripts that require interactive prompts
- Missing validation for destructive or batch operations
- Descriptions that say what the skill is instead of when to use it
