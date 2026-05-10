#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<4"
# dependencies = []
# ///
"""Validate an Agent Skill directory or SKILL.md file.

This validator intentionally uses only the Python standard library so it can run
without installing packages. It performs strict Agent Skills checks for required
fields and useful warnings for authoring quality.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import textwrap
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

VALID_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
KNOWN_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
PATH_RE = re.compile(r"(?<![\w.-])((?:scripts|references|assets|evals)/[A-Za-z0-9_./*{}-]+(?:\.[A-Za-z0-9]+)?)")


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    location: str = ""


def add_issue(issues: list[Issue], severity: str, code: str, message: str, location: str = "") -> None:
    issues.append(Issue(severity=severity, code=code, message=message, location=location))


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def collect_indented(lines: list[str], start: int) -> tuple[list[str], int]:
    collected: list[str] = []
    i = start
    while i < len(lines):
        line = lines[i]
        if line.strip() and not line.startswith((" ", "\t")):
            break
        collected.append(line)
        i += 1
    return collected, i


def dedent_block(lines: list[str]) -> str:
    if not lines:
        return ""
    return textwrap.dedent("\n".join(lines)).strip("\n")


def fold_block(text: str) -> str:
    paragraphs: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append(" ".join(current))
                current = []
        else:
            current.append(stripped)
    if current:
        paragraphs.append(" ".join(current))
    return "\n".join(paragraphs).strip()


def parse_metadata(lines: list[str]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for raw in lines:
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        stripped = raw.strip()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        metadata[key.strip()] = unquote(value.strip())
    return metadata


def parse_frontmatter(frontmatter: str, issues: list[Issue]) -> dict[str, Any]:
    """Parse a small, lenient YAML subset sufficient for Agent Skill frontmatter."""
    data: dict[str, Any] = {}
    lines = frontmatter.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if raw.startswith((" ", "\t")):
            add_issue(issues, "warning", "frontmatter-indentation", f"Unexpected indented top-level line: {stripped}")
            i += 1
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$", raw)
        if not match:
            add_issue(issues, "warning", "frontmatter-parse", f"Could not parse frontmatter line: {raw}")
            i += 1
            continue
        key, value = match.group(1), match.group(2) or ""
        value = value.strip()

        if key not in KNOWN_FIELDS:
            add_issue(issues, "warning", "unknown-frontmatter-field", f"Unknown frontmatter field `{key}`")

        if value in {">", "|-", "|+", "|", ">-", ">+"}:
            block_lines, next_i = collect_indented(lines, i + 1)
            block = dedent_block(block_lines)
            data[key] = fold_block(block) if value.startswith(">") else block
            i = next_i
            continue

        if value == "":
            child_lines, next_i = collect_indented(lines, i + 1)
            if child_lines and key == "metadata":
                data[key] = parse_metadata(child_lines)
            elif child_lines:
                data[key] = dedent_block(child_lines)
            else:
                data[key] = ""
            i = next_i
            continue

        data[key] = unquote(value)
        i += 1
    return data


def extract_skill_file(path: Path, issues: list[Issue]) -> tuple[Path, Path] | None:
    if path.is_dir():
        skill_dir = path
        skill_file = path / "SKILL.md"
    else:
        skill_file = path
        skill_dir = path.parent

    if not skill_file.exists():
        add_issue(issues, "error", "missing-skill-md", f"SKILL.md not found at {skill_file}")
        return None
    if skill_file.name != "SKILL.md":
        add_issue(issues, "error", "wrong-file-name", "Skill file must be named exactly SKILL.md", str(skill_file))
        return None
    return skill_dir, skill_file


def split_frontmatter(text: str, issues: list[Issue], skill_file: Path) -> tuple[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        add_issue(issues, "error", "missing-frontmatter", "SKILL.md must start with YAML frontmatter delimited by ---", str(skill_file))
        return "", text
    closing_index: int | None = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            closing_index = idx
            break
    if closing_index is None:
        add_issue(issues, "error", "unclosed-frontmatter", "Opening --- has no matching closing ---", str(skill_file))
        return "\n".join(lines[1:]), ""
    frontmatter = "\n".join(lines[1:closing_index])
    body = "\n".join(lines[closing_index + 1 :]).strip()
    return frontmatter, body


def validate_frontmatter(data: dict[str, Any], skill_dir: Path, issues: list[Issue]) -> None:
    name = str(data.get("name", "")).strip()
    description = str(data.get("description", "")).strip()

    if not name:
        add_issue(issues, "error", "missing-name", "Frontmatter field `name` is required")
    else:
        if len(name) > 64:
            add_issue(issues, "error", "name-too-long", f"`name` is {len(name)} characters; max is 64")
        if not VALID_NAME_RE.match(name):
            add_issue(
                issues,
                "error",
                "invalid-name",
                "`name` must use lowercase letters, numbers, and single hyphens only; no leading/trailing/consecutive hyphens",
            )
        if skill_dir.name != name:
            add_issue(issues, "error", "name-directory-mismatch", f"`name` is `{name}` but parent directory is `{skill_dir.name}`")

    if not description:
        add_issue(issues, "error", "missing-description", "Frontmatter field `description` is required and must be non-empty")
    else:
        if len(description) > 1024:
            add_issue(issues, "error", "description-too-long", f"`description` is {len(description)} characters; max is 1024")
        if not re.search(r"\b(use|when|asks|requested|needs|handle|create|write|analyze|process)\b", description, re.I):
            add_issue(issues, "warning", "description-may-not-trigger", "Description may not clearly state when to use the skill")

    compatibility = str(data.get("compatibility", "")).strip()
    if compatibility and len(compatibility) > 500:
        add_issue(issues, "error", "compatibility-too-long", f"`compatibility` is {len(compatibility)} characters; max is 500")

    metadata = data.get("metadata")
    if metadata and not isinstance(metadata, dict):
        add_issue(issues, "warning", "metadata-not-map", "`metadata` should be a key-value mapping")


def strip_fenced_code(text: str) -> str:
    """Remove fenced code blocks so illustrative example paths do not look required."""
    lines = text.splitlines()
    output: list[str] = []
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence:
            output.append(line)
    return "\n".join(output)


def python_calls_input(text: str) -> bool:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "input":
            return True
    return False


def validate_body(body: str, skill_dir: Path, issues: list[Issue]) -> None:
    if not body.strip():
        add_issue(issues, "warning", "empty-body", "SKILL.md body is empty; add task instructions")
        return

    line_count = len(body.splitlines())
    word_count = len(re.findall(r"\S+", body))
    if line_count > 500:
        add_issue(issues, "warning", "body-too-long", f"SKILL.md body has {line_count} lines; consider moving details to references/")
    if word_count > 3500:
        add_issue(issues, "warning", "body-may-exceed-token-guidance", f"SKILL.md body has about {word_count} words; consider progressive disclosure")

    body_for_refs = strip_fenced_code(body)
    for rel in sorted(set(PATH_RE.findall(body_for_refs))):
        if "*" in rel or "{" in rel or "}" in rel:
            continue
        rel_clean = rel.rstrip(".,;:)]")
        target = skill_dir / rel_clean
        if not target.exists():
            add_issue(issues, "warning", "missing-referenced-file", f"Referenced file `{rel_clean}` does not exist", rel_clean)


def validate_directories(skill_dir: Path, issues: list[Issue]) -> None:
    for name in ["scripts", "references", "assets", "evals"]:
        candidate = skill_dir / name
        if candidate.exists() and not candidate.is_dir():
            add_issue(issues, "error", "optional-path-not-directory", f"`{name}/` exists but is not a directory", str(candidate))


def validate_scripts(skill_dir: Path, issues: list[Issue]) -> None:
    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.is_dir():
        return
    for script in sorted(p for p in scripts_dir.rglob("*") if p.is_file()):
        try:
            text = script.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        rel = str(script.relative_to(skill_dir))
        if script.suffix == ".py":
            if "# /// script" not in "\n".join(text.splitlines()[:20]):
                add_issue(issues, "warning", "python-script-missing-pep723", f"Python script `{rel}` lacks PEP 723 metadata", rel)
            if python_calls_input(text):
                add_issue(issues, "warning", "interactive-python-script", f"Python script `{rel}` calls input(); avoid interactive prompts", rel)
            if "argparse" not in text and "--help" not in text:
                add_issue(issues, "warning", "script-help-not-obvious", f"Script `{rel}` may not document a --help interface", rel)
        elif script.suffix == ".ts":
            first_line = text.splitlines()[0] if text.splitlines() else ""
            if "deno" not in first_line:
                add_issue(issues, "warning", "typescript-script-not-deno", f"TypeScript script `{rel}` should use a Deno shebang", rel)
        if script.suffix != ".py" and ("read -p" in text or "prompt(" in text):
            add_issue(issues, "warning", "script-may-be-interactive", f"Script `{rel}` may prompt interactively", rel)


def validate_evals(skill_dir: Path, issues: list[Issue]) -> None:
    eval_queries = skill_dir / "evals" / "eval_queries.json"
    if eval_queries.exists():
        try:
            data = json.loads(eval_queries.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                add_issue(issues, "error", "eval-queries-not-list", "evals/eval_queries.json must be a JSON list")
            else:
                for idx, item in enumerate(data):
                    if not isinstance(item, dict) or "query" not in item or "should_trigger" not in item:
                        add_issue(issues, "error", "invalid-eval-query", f"eval_queries[{idx}] must contain query and should_trigger")
        except json.JSONDecodeError as exc:
            add_issue(issues, "error", "eval-queries-invalid-json", f"evals/eval_queries.json is invalid JSON: {exc}")

    evals = skill_dir / "evals" / "evals.json"
    if evals.exists():
        try:
            data = json.loads(evals.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or "skill_name" not in data or "evals" not in data:
                add_issue(issues, "error", "invalid-evals-json", "evals/evals.json must contain skill_name and evals")
        except json.JSONDecodeError as exc:
            add_issue(issues, "error", "evals-invalid-json", f"evals/evals.json is invalid JSON: {exc}")


def validate(path: Path) -> tuple[Path | None, list[Issue], dict[str, Any]]:
    issues: list[Issue] = []
    metadata: dict[str, Any] = {}
    located = extract_skill_file(path, issues)
    if located is None:
        return None, issues, metadata

    skill_dir, skill_file = located
    text = skill_file.read_text(encoding="utf-8")
    frontmatter, body = split_frontmatter(text, issues, skill_file)
    if frontmatter:
        metadata = parse_frontmatter(frontmatter, issues)
        validate_frontmatter(metadata, skill_dir, issues)
    validate_body(body, skill_dir, issues)
    validate_directories(skill_dir, issues)
    validate_scripts(skill_dir, issues)
    validate_evals(skill_dir, issues)
    return skill_dir, issues, metadata


def print_human(skill_dir: Path | None, issues: list[Issue], metadata: dict[str, Any]) -> None:
    if skill_dir:
        print(f"Skill: {skill_dir}")
    if metadata:
        print(f"Name: {metadata.get('name', '<missing>')}")
        description = str(metadata.get("description", ""))
        print(f"Description length: {len(description)}")
    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]
    print(f"Result: {len(errors)} error(s), {len(warnings)} warning(s)")
    if not issues:
        print("No issues found.")
        return
    for issue in issues:
        location = f" [{issue.location}]" if issue.location else ""
        print(f"- {issue.severity.upper()} {issue.code}{location}: {issue.message}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate an Agent Skill directory or SKILL.md file.",
        epilog="Example: uv run scripts/validate_skill.py .agents/skills/my-skill",
    )
    parser.add_argument("path", help="Path to a skill directory or SKILL.md")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args(argv)

    skill_dir, issues, metadata = validate(Path(args.path).resolve())
    if args.json:
        print(json.dumps({"skill_dir": str(skill_dir) if skill_dir else None, "metadata": metadata, "issues": [asdict(i) for i in issues]}, indent=2))
    else:
        print_human(skill_dir, issues, metadata)
    return 1 if any(i.severity == "error" for i in issues) else 0


if __name__ == "__main__":
    raise SystemExit(main())
