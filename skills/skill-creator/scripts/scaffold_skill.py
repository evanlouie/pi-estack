#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<4"
# dependencies = []
# ///
"""Scaffold an Agent Skill directory."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

VALID_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

SKILL_TEMPLATE = """---
name: {name}
description: >
  {description}
metadata:
  version: "0.1.0"
---

# {title}

## When to use this skill

Use this skill when {when_to_use}.

## Inputs to collect

- The user's goal and success criteria
- Any files, examples, schemas, templates, or source materials needed for the workflow
- Constraints such as target format, tools, environment, deadlines, or safety requirements

## Workflow

1. Confirm the task fits this skill's scope and identify required inputs.
2. Inspect provided files or context before making changes.
3. Follow the domain-specific procedure for the task.
4. Validate the result using the checks below.
5. Return the final artifact plus a concise summary of important decisions.

## Validation

Before finalizing, verify:

- [ ] Required inputs were considered.
- [ ] Output matches the requested format.
- [ ] Any generated files are saved in the requested location.
- [ ] Edge cases or limitations are noted.

## Gotchas

- Replace this placeholder with non-obvious domain or project details the agent would otherwise miss.
"""

REFERENCE_README = """# References

Put focused documentation here and tell the agent exactly when to load each file from `SKILL.md`.

Examples:

- `api-errors.md` — Load when an API returns a non-200 response.
- `schema.md` — Load before writing database queries.
"""

ASSETS_README = """# Assets

Put templates, schemas, sample files, or static resources here.

Reference assets from `SKILL.md` with a clear loading condition.
"""

EVAL_QUERIES = """[
  {
    "query": "Use this skill for a realistic request that should trigger it.",
    "should_trigger": true
  },
  {
    "query": "Ask for a near-miss task that shares words but should not trigger it.",
    "should_trigger": false
  }
]
"""

EVALS_JSON = """{{
  "skill_name": "{name}",
  "evals": [
    {{
      "id": "basic-task",
      "prompt": "Ask for a realistic task this skill should handle.",
      "expected_output": "Describe what a successful output should include.",
      "files": [],
      "assertions": [
        "The output satisfies the user's requested format",
        "The result includes evidence that validation was performed"
      ]
    }}
  ]
}}
"""

EXAMPLE_SCRIPT = """#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<4"
# dependencies = []
# ///
\"\"\"Example helper script for an Agent Skill. Replace with real reusable logic.\"\"\"

from __future__ import annotations

import argparse
import json


def main() -> int:
    parser = argparse.ArgumentParser(description="Example script. Replace with real reusable logic.")
    parser.add_argument("value", help="Value to echo as structured JSON")
    args = parser.parse_args()
    print(json.dumps({"value": args.value}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""


def title_from_name(name: str) -> str:
    return " ".join(part.capitalize() for part in name.split("-"))


def sentence_fragment(description: str) -> str:
    text = description.strip().rstrip(".")
    if text.lower().startswith("use this skill when "):
        text = text[20:]
    return text[:1].lower() + text[1:]


def validate_name(name: str) -> None:
    if not VALID_NAME_RE.match(name):
        raise ValueError("Skill name must use lowercase letters, numbers, and single hyphens only")
    if len(name) > 64:
        raise ValueError("Skill name must be 64 characters or fewer")


def write_file(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite existing file: {path}. Use --force to overwrite.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def scaffold(args: argparse.Namespace) -> Path:
    validate_name(args.name)
    if not args.description.strip():
        raise ValueError("--description is required and must be non-empty")
    if len(args.description) > 1024:
        raise ValueError("Description must be 1024 characters or fewer")

    root = Path(args.output).expanduser().resolve() / args.name
    if root.exists() and any(root.iterdir()) and not args.force:
        raise FileExistsError(f"Directory already exists and is not empty: {root}. Use --force to overwrite files.")
    root.mkdir(parents=True, exist_ok=True)

    skill_md = SKILL_TEMPLATE.format(
        name=args.name,
        title=title_from_name(args.name),
        description=args.description.strip(),
        when_to_use=sentence_fragment(args.description),
    )
    write_file(root / "SKILL.md", skill_md, args.force)

    if args.with_references:
        write_file(root / "references" / "README.md", REFERENCE_README, args.force)
    if args.with_assets:
        write_file(root / "assets" / "README.md", ASSETS_README, args.force)
    if args.with_scripts:
        script_path = root / "scripts" / "example.py"
        write_file(script_path, EXAMPLE_SCRIPT, args.force)
        try:
            script_path.chmod(0o755)
        except OSError:
            pass
    if args.with_evals:
        write_file(root / "evals" / "eval_queries.json", EVAL_QUERIES, args.force)
        write_file(root / "evals" / "evals.json", EVALS_JSON.format(name=args.name), args.force)

    return root


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scaffold a new Agent Skill directory.",
        epilog="Example: uv run scripts/scaffold_skill.py invoice-review --description 'Use this skill when reviewing invoice PDFs for missing fields.' --output .agents/skills --with-evals",
    )
    parser.add_argument("name", help="Skill name, e.g. invoice-review")
    parser.add_argument("--description", required=True, help="Trigger description for SKILL.md, max 1024 characters")
    parser.add_argument("--output", default=".", help="Directory that will contain the new skill directory (default: current directory)")
    parser.add_argument("--with-scripts", action="store_true", help="Create scripts/example.py")
    parser.add_argument("--with-references", action="store_true", help="Create references/README.md")
    parser.add_argument("--with-assets", action="store_true", help="Create assets/README.md")
    parser.add_argument("--with-evals", action="store_true", help="Create evals/eval_queries.json and evals/evals.json")
    parser.add_argument("--force", action="store_true", help="Overwrite scaffolded files if they already exist")
    args = parser.parse_args(argv)

    try:
        root = scaffold(args)
    except Exception as exc:  # noqa: BLE001 - useful CLI error boundary
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
