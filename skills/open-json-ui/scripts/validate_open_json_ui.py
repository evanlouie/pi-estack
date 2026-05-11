#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Permissive Open-JSON-UI sanity validator.

This script validates common Open-JSON-UI-style envelopes and catches common
mistakes. It is not a substitute for the target renderer's authoritative schema.

Usage:
  uv run scripts/validate_open_json_ui.py payload.json
  uv run scripts/validate_open_json_ui.py - < payload.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

KNOWN_TYPES = {
    "screen",
    "card",
    "text",
    "heading",
    "list",
    "table",
    "form",
    "input",
    "select",
    "button",
    "chart",
    "image",
    "badge",
    "divider",
    "row",
    "column",
    "section",
}

DANGEROUS_PATTERNS = [
    re.compile(r"<\s*script", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"\bon[A-Z_a-z]+\s*=", re.IGNORECASE),
    re.compile(
        r"\b(?:fetch|eval|function|Function|setTimeout|setInterval)\s*\(", re.IGNORECASE
    ),
    re.compile(r"=>"),
]

EVENT_HANDLER_KEY_PATTERN = re.compile(
    r"^on(?:[_:-])?(?:click|change|submit|hover|input|load|error|focus|blur|key|mouse|pointer|touch|drag|drop|select|toggle|scroll|close|open)(?:$|[_:-]|[A-Z])",
    re.IGNORECASE,
)


EXIT_OK = 0
EXIT_VALIDATION_FAILED = 1
EXIT_JSON_ERROR = 2


class ValidationState:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.ids: dict[str, str] = {}
        self.component_count = 0

    def error(self, path: str, message: str) -> None:
        self.errors.append(f"{path}: {message}")

    def warn(self, path: str, message: str) -> None:
        self.warnings.append(f"{path}: {message}")


def load_json(path: str) -> Any:
    try:
        if path == "-":
            text = sys.stdin.read()
        else:
            text = Path(path).read_text(encoding="utf-8")
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise ValueError(f"Could not read {path!r}: {exc}") from exc


def detect_dialect(root: Any) -> str:
    if not isinstance(root, dict):
        return "unknown"
    if root.get("type") == "screen" and isinstance(root.get("content"), list):
        return "screen-content"
    if root.get("type") == "open-json-ui" and isinstance(root.get("spec"), dict):
        return "open-json-ui-wrapper"
    if isinstance(root.get("components"), list):
        return "component-catalog"
    if root.get("type") == "STATE_DELTA" and isinstance(root.get("delta"), dict):
        ui = root.get("delta", {}).get("ui")
        if isinstance(ui, dict) and ui.get("spec") == "open-json-ui":
            return "ag-ui-state-delta-carrier"
    return "unknown"


def check_string(value: str, path: str, state: ValidationState) -> None:
    for pattern in DANGEROUS_PATTERNS:
        if pattern.search(value):
            state.warn(
                path,
                "string looks like executable code or raw HTML; prefer declarative fields",
            )
            break


def validate_any(value: Any, path: str, state: ValidationState) -> None:
    if isinstance(value, str):
        check_string(value, path, state)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            validate_any(item, f"{path}[{index}]", state)
    elif isinstance(value, dict):
        # If it looks like a component, validate as a component; otherwise recurse.
        if isinstance(value.get("type"), str):
            validate_component(value, path, state)
        else:
            for key, item in value.items():
                validate_any(item, f"{path}.{key}", state)


def validate_component(
    component: dict[str, Any], path: str, state: ValidationState
) -> None:
    state.component_count += 1

    ctype = component.get("type")
    if not isinstance(ctype, str) or not ctype:
        state.error(path, "component must have a non-empty string 'type'")
        return

    if ctype not in KNOWN_TYPES and ctype not in {"open-json-ui", "STATE_DELTA"}:
        state.warn(
            path,
            f"unknown component type {ctype!r}; ensure the target renderer supports it",
        )

    cid = component.get("id")
    if cid is not None:
        if not isinstance(cid, str) or not cid:
            state.error(path, "component id must be a non-empty string")
        elif cid in state.ids:
            state.error(
                path, f"duplicate component id {cid!r}; first seen at {state.ids[cid]}"
            )
        else:
            state.ids[cid] = path

    component_properties = component.get("properties")
    props: dict[str, Any] = (
        component_properties if isinstance(component_properties, dict) else component
    )

    if ctype in {"screen", "card", "section", "row", "column"}:
        content = props.get("content")
        if content is not None and not isinstance(content, list):
            state.error(path, f"{ctype!r} content must be an array")

    if ctype == "text" and not isinstance(props.get("text"), str):
        state.warn(path, "text component should include a string 'text' field")

    if ctype == "heading":
        if not isinstance(props.get("text"), str):
            state.warn(path, "heading should include a string 'text' field")
        level = props.get("level")
        if level is not None and not (isinstance(level, int) and 1 <= level <= 6):
            state.warn(path, "heading level should be an integer from 1 to 6")

    if ctype == "list" and not isinstance(props.get("items"), list):
        state.warn(path, "list should include an 'items' array")

    if ctype == "table":
        if not isinstance(props.get("columns"), list):
            state.warn(path, "table should include a 'columns' array")
        if not isinstance(props.get("rows"), list):
            state.warn(path, "table should include a 'rows' array")

    if ctype == "chart":
        if not isinstance(props.get("data"), (list, dict)):
            state.warn(path, "chart should include 'data' as an array or object")
        if not isinstance(props.get("chartType"), str):
            state.warn(
                path,
                "chart should include a string 'chartType' such as 'bar' or 'line'",
            )

    if ctype == "form":
        if not isinstance(props.get("fields"), list):
            state.warn(path, "form should include a 'fields' array")
        if not isinstance(props.get("actions"), list):
            state.warn(path, "form should include an 'actions' array")

    if ctype in {"input", "select"}:
        if not isinstance(props.get("name"), str):
            state.warn(path, f"{ctype} should include a stable string 'name'")
        if not isinstance(props.get("label"), str):
            state.warn(path, f"{ctype} should include a user-visible string 'label'")

    if ctype == "button":
        if not isinstance(props.get("label"), str):
            state.warn(path, "button should include a string 'label'")
        action = props.get("action")
        if action is not None:
            if not isinstance(action, dict):
                state.error(path, "button action must be an object")
            elif not isinstance(action.get("name"), str):
                state.warn(path, "button action should include a string 'name'")

    if ctype == "image" and not isinstance(props.get("alt"), str):
        state.warn(path, "image should include an 'alt' string for accessibility")

    # Keys whose contents are already validated in the explicit branches above.
    already_validated = {"content", "items", "fields", "actions"}

    for key, value in component.items():
        child_path = f"{path}.{key}"
        if EVENT_HANDLER_KEY_PATTERN.match(key):
            state.warn(
                child_path,
                "event-handler field names are not declarative; use an action object with name and parameters",
            )

        if key in already_validated:
            # Already handled above for the relevant component types.
            continue
        if key == "properties" and isinstance(value, dict):
            validate_any(value, f"{path}.properties", state)
        else:
            validate_any(value, child_path, state)


def validate_root(root: Any) -> dict[str, Any]:
    state = ValidationState()
    dialect = detect_dialect(root)

    if not isinstance(root, dict):
        state.error("$", "root must be a JSON object")
    elif dialect == "screen-content":
        validate_component(root, "$", state)
        if not root.get("content"):
            state.warn("$.content", "screen content is empty")
    elif dialect == "open-json-ui-wrapper":
        spec = root.get("spec")
        validate_any(spec, "$.spec", state)
    elif dialect == "component-catalog":
        components = root.get("components")
        if not components:
            state.warn("$.components", "components array is empty")
        validate_any(components, "$.components", state)
        if "version" not in root:
            state.warn(
                "$.version",
                "component-catalog dialect usually includes a version string",
            )
    elif dialect == "ag-ui-state-delta-carrier":
        content = root.get("delta", {}).get("ui", {}).get("content")
        validate_any(content, "$.delta.ui.content", state)
    else:
        state.error(
            "$",
            "unrecognized Open-JSON-UI envelope; expected screen/content, type=open-json-ui wrapper, components array, or AG-UI STATE_DELTA carrier",
        )
        validate_any(root, "$", state)

    return {
        "valid": not state.errors,
        "dialect": dialect,
        "component_count": state.component_count,
        "errors": state.errors,
        "warnings": state.warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Permissive Open-JSON-UI sanity validator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Exit codes:\n"
            "  0  payload validated successfully (no errors)\n"
            "  1  payload parsed but failed validation (one or more errors)\n"
            "  2  input could not be read or parsed as JSON\n"
        ),
    )
    parser.add_argument("path", help="JSON file to validate, or '-' for stdin")
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print validation output"
    )
    args = parser.parse_args()

    json_error = False
    try:
        root = load_json(args.path)
        result = validate_root(root)
    except ValueError as exc:
        json_error = True
        result = {
            "valid": False,
            "dialect": "invalid-json",
            "component_count": 0,
            "errors": [str(exc)],
            "warnings": [],
        }

    json.dump(result, sys.stdout, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    if json_error:
        return EXIT_JSON_ERROR
    return EXIT_OK if result["valid"] else EXIT_VALIDATION_FAILED


if __name__ == "__main__":
    raise SystemExit(main())
