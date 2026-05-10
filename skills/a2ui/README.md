# a2ui Agent Skill

This skill helps an agent create, review, validate, explain, and convert A2UI Agent-to-UI payloads.

## Install

Copy the `a2ui` folder into a skills directory such as:

```text
.agents/skills/a2ui/
```

The required file is `SKILL.md`. Supporting references, examples, evals, and the validation script are included for progressive loading.

## Contents

```text
a2ui/
├── SKILL.md
├── references/
│   ├── a2ui-v09-authoring.md
│   ├── a2ui-v08-compatibility.md
│   ├── catalogs-actions-transports.md
│   ├── review-checklist.md
│   └── sources.md
├── scripts/
│   └── validate_a2ui.py
├── assets/examples/
│   ├── a2ui_v09_booking_form.json
│   └── a2ui_v08_profile_card.jsonl
└── evals/
    └── evals.json
```

## Validate example payloads

```bash
cd a2ui
uv run scripts/validate_a2ui.py assets/examples/a2ui_v09_booking_form.json --format text
uv run scripts/validate_a2ui.py assets/examples/a2ui_v08_profile_card.jsonl --format text
```

The script performs lightweight structural validation. It is not a full official schema validator.
