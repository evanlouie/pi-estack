#!/usr/bin/env python3
"""Lightweight structural validator for A2UI v0.9 and v0.8 payloads.

This validator intentionally avoids external dependencies. It checks common
protocol-shape and component-graph mistakes, but it is not a replacement for
official A2UI JSON Schema plus negotiated catalog validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

V09_SERVER_KEYS = {
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
}
V09_CLIENT_KEYS = {"action", "error"}
V09_KEYS = V09_SERVER_KEYS | V09_CLIENT_KEYS
V08_SERVER_KEYS = {
    "surfaceUpdate",
    "dataModelUpdate",
    "beginRendering",
    "deleteSurface",
}
V08_CLIENT_KEYS = {"userAction", "error"}
V08_KEYS = V08_SERVER_KEYS | V08_CLIENT_KEYS

CHILD_REF_FIELDS = ("child", "entryPointChild", "contentChild")


@dataclass
class Issue:
    level: str
    message: str
    path: str = ""

    def to_dict(self) -> dict[str, str]:
        out = {"level": self.level, "message": self.message}
        if self.path:
            out["path"] = self.path
        return out


@dataclass
class SurfaceState:
    created: bool = False
    deleted: bool = False
    catalog_id: str | None = None
    component_ids: set[str] = field(default_factory=set)
    root_seen: bool = False
    child_refs: list[tuple[str, str, str]] = field(
        default_factory=list
    )  # (from_id, to_id, path)
    begin_root: str | None = None


@dataclass
class ValidationResult:
    version: str
    message_count: int
    surfaces: dict[str, SurfaceState]
    issues: list[Issue]

    @property
    def ok(self) -> bool:
        return not any(issue.level == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(1 for issue in self.issues if issue.level == "warning")

    @property
    def error_count(self) -> int:
        return sum(1 for issue in self.issues if issue.level == "error")

    @property
    def component_count(self) -> int:
        return sum(len(surface.component_ids) for surface in self.surfaces.values())

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "version": self.version,
            "messageCount": self.message_count,
            "surfaceCount": len(self.surfaces),
            "componentCount": self.component_count,
            "errors": [
                issue.to_dict() for issue in self.issues if issue.level == "error"
            ],
            "warnings": [
                issue.to_dict() for issue in self.issues if issue.level == "warning"
            ],
            "surfaces": {
                sid: {
                    "created": state.created,
                    "deleted": state.deleted,
                    "catalogId": state.catalog_id,
                    "componentCount": len(state.component_ids),
                    "rootSeen": state.root_seen,
                    "beginRoot": state.begin_root,
                }
                for sid, state in sorted(self.surfaces.items())
            },
        }


def load_messages(path: str | None) -> tuple[list[Any], list[Issue]]:
    text = (
        sys.stdin.read()
        if path in (None, "-")
        else Path(path).read_text(encoding="utf-8")
    )
    stripped = text.strip()
    if not stripped:
        return [], [Issue("error", "Input is empty", "$")]

    # First try normal JSON: a message object, list of message objects, or A2A DataPart.
    try:
        parsed = json.loads(stripped)
        if (
            isinstance(parsed, dict)
            and isinstance(parsed.get("data"), list)
            and "metadata" in parsed
        ):
            return parsed["data"], []
        if isinstance(parsed, dict):
            return [parsed], []
        if isinstance(parsed, list):
            return parsed, []
        return [], [
            Issue(
                "error", "Top-level JSON must be an object, array, or A2A DataPart", "$"
            )
        ]
    except json.JSONDecodeError:
        pass

    # Try JSONL.
    messages: list[Any] = []
    issues: list[Issue] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError as exc:
            issues.append(
                Issue(
                    "error",
                    f"Invalid JSONL line {line_no}: {exc.msg}",
                    f"line:{line_no}",
                )
            )
    return messages, issues


def detect_version(messages: list[Any]) -> str:
    v09 = 0
    v08 = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("version") == "v0.9" or any(
            key in msg for key in V09_KEYS - {"error"}
        ):
            v09 += 1
        if any(key in msg for key in V08_KEYS - {"error", "deleteSurface"}):
            v08 += 1
        # deleteSurface and error are shared/ambiguous; version decides when present.
        if "deleteSurface" in msg and msg.get("version") != "v0.9":
            v08 += 1
        if "error" in msg and msg.get("version") != "v0.9":
            v08 += 1
    if v09 and not v08:
        return "v0.9"
    if v08 and not v09:
        return "v0.8"
    if v09 and v08:
        return "mixed"
    return "unknown"


def payload_keys(msg: dict[str, Any], keys: set[str]) -> list[str]:
    return [key for key in msg if key in keys]


def surface_for(surfaces: dict[str, SurfaceState], surface_id: str) -> SurfaceState:
    return surfaces.setdefault(surface_id, SurfaceState())


def add_issue(issues: list[Issue], level: str, message: str, path: str = "") -> None:
    issues.append(Issue(level, message, path))


def validate_v09(messages: list[Any], initial_issues: list[Issue]) -> ValidationResult:
    issues = list(initial_issues)
    surfaces: dict[str, SurfaceState] = {}

    for index, msg in enumerate(messages):
        base = f"$[{index}]"
        if not isinstance(msg, dict):
            add_issue(issues, "error", "Message must be a JSON object", base)
            continue
        if msg.get("version") != "v0.9":
            add_issue(issues, "error", "v0.9 message must include version: v0.9", base)
        keys = payload_keys(msg, V09_KEYS)
        if len(keys) != 1:
            add_issue(
                issues,
                "error",
                "v0.9 message must contain exactly one A2UI payload key",
                base,
            )
            continue
        key = keys[0]
        payload = msg[key]
        if not isinstance(payload, dict):
            add_issue(
                issues, "error", f"{key} payload must be an object", f"{base}.{key}"
            )
            continue

        if key == "createSurface":
            sid = payload.get("surfaceId")
            catalog_id = payload.get("catalogId")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "createSurface.surfaceId must be a non-empty string",
                    f"{base}.createSurface.surfaceId",
                )
                continue
            if not isinstance(catalog_id, str) or not catalog_id:
                add_issue(
                    issues,
                    "error",
                    "createSurface.catalogId must be a non-empty string",
                    f"{base}.createSurface.catalogId",
                )
            state = surface_for(surfaces, sid)
            if state.created and not state.deleted:
                add_issue(
                    issues,
                    "error",
                    f"Surface {sid!r} is created more than once without deleteSurface",
                    f"{base}.createSurface.surfaceId",
                )
            state.created = True
            state.deleted = False
            state.catalog_id = catalog_id if isinstance(catalog_id, str) else None
            if "sendDataModel" in payload and not isinstance(
                payload["sendDataModel"], bool
            ):
                add_issue(
                    issues,
                    "warning",
                    "sendDataModel should be a boolean",
                    f"{base}.createSurface.sendDataModel",
                )

        elif key == "updateComponents":
            sid = payload.get("surfaceId")
            components = payload.get("components")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "updateComponents.surfaceId must be a non-empty string",
                    f"{base}.updateComponents.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            if not state.created:
                add_issue(
                    issues,
                    "warning",
                    f"Surface {sid!r} is updated before createSurface",
                    f"{base}.updateComponents.surfaceId",
                )
            if state.deleted:
                add_issue(
                    issues,
                    "error",
                    f"Surface {sid!r} was deleted before this update",
                    f"{base}.updateComponents.surfaceId",
                )
            if not isinstance(components, list):
                add_issue(
                    issues,
                    "error",
                    "updateComponents.components must be an array",
                    f"{base}.updateComponents.components",
                )
                continue
            seen_in_message: set[str] = set()
            for comp_index, comp in enumerate(components):
                cpath = f"{base}.updateComponents.components[{comp_index}]"
                if not isinstance(comp, dict):
                    add_issue(issues, "error", "Component must be an object", cpath)
                    continue
                cid = comp.get("id")
                ctype = comp.get("component")
                if not isinstance(cid, str) or not cid:
                    add_issue(
                        issues,
                        "error",
                        "Component id must be a non-empty string",
                        f"{cpath}.id",
                    )
                    continue
                if cid in seen_in_message:
                    add_issue(
                        issues,
                        "error",
                        f"Duplicate component id {cid!r} within one updateComponents message",
                        f"{cpath}.id",
                    )
                seen_in_message.add(cid)
                if not isinstance(ctype, str) or not ctype:
                    if isinstance(ctype, dict):
                        add_issue(
                            issues,
                            "error",
                            "v0.9 component must be a string, not a v0.8 wrapper object",
                            f"{cpath}.component",
                        )
                    else:
                        add_issue(
                            issues,
                            "error",
                            "Component type must be a non-empty string",
                            f"{cpath}.component",
                        )
                if cid == "root":
                    state.root_seen = True
                state.component_ids.add(cid)
                collect_child_refs_v09(comp, cid, cpath, state, issues)

        elif key == "updateDataModel":
            sid = payload.get("surfaceId")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "updateDataModel.surfaceId must be a non-empty string",
                    f"{base}.updateDataModel.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            if not state.created:
                add_issue(
                    issues,
                    "warning",
                    f"Surface {sid!r} is updated before createSurface",
                    f"{base}.updateDataModel.surfaceId",
                )
            path_value = payload.get("path", "/")
            if not isinstance(path_value, str):
                add_issue(
                    issues,
                    "error",
                    "updateDataModel.path must be a string when present",
                    f"{base}.updateDataModel.path",
                )
            elif path_value and not path_value.startswith("/"):
                add_issue(
                    issues,
                    "warning",
                    "v0.9 updateDataModel.path should be a JSON Pointer starting with /",
                    f"{base}.updateDataModel.path",
                )

        elif key == "deleteSurface":
            sid = payload.get("surfaceId")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "deleteSurface.surfaceId must be a non-empty string",
                    f"{base}.deleteSurface.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            if not state.created:
                add_issue(
                    issues,
                    "warning",
                    f"Deleting surface {sid!r} that was not created in this payload",
                    f"{base}.deleteSurface.surfaceId",
                )
            state.deleted = True

        elif key == "action":
            for req in (
                "name",
                "surfaceId",
                "sourceComponentId",
                "timestamp",
                "context",
            ):
                if req not in payload:
                    add_issue(
                        issues,
                        "warning",
                        f"Client action is missing {req!r}",
                        f"{base}.action",
                    )
            if "context" in payload and not isinstance(payload["context"], dict):
                add_issue(
                    issues,
                    "error",
                    "action.context must be an object",
                    f"{base}.action.context",
                )

        elif key == "error":
            if payload.get("code") != "VALIDATION_FAILED":
                add_issue(
                    issues,
                    "warning",
                    "A2UI error messages usually use code VALIDATION_FAILED",
                    f"{base}.error.code",
                )

    finalize_graph_checks("v0.9", surfaces, issues)
    return ValidationResult("v0.9", len(messages), surfaces, issues)


def collect_child_refs_v09(
    comp: dict[str, Any], cid: str, cpath: str, state: SurfaceState, issues: list[Issue]
) -> None:
    for field_name in CHILD_REF_FIELDS:
        if field_name in comp:
            value = comp[field_name]
            if isinstance(value, str):
                state.child_refs.append((cid, value, f"{cpath}.{field_name}"))
            else:
                add_issue(
                    issues,
                    "warning",
                    f"{field_name} should be a component ID string",
                    f"{cpath}.{field_name}",
                )
    if "children" in comp:
        value = comp["children"]
        if isinstance(value, list):
            for child_index, ref in enumerate(value):
                if isinstance(ref, str):
                    state.child_refs.append(
                        (cid, ref, f"{cpath}.children[{child_index}]")
                    )
                else:
                    add_issue(
                        issues,
                        "warning",
                        "children entries should be component ID strings",
                        f"{cpath}.children[{child_index}]",
                    )
        elif isinstance(value, dict):
            ref = value.get("componentId")
            path = value.get("path")
            if isinstance(ref, str):
                state.child_refs.append((cid, ref, f"{cpath}.children.componentId"))
            else:
                add_issue(
                    issues,
                    "warning",
                    "template children should include componentId",
                    f"{cpath}.children.componentId",
                )
            if path is not None and not isinstance(path, str):
                add_issue(
                    issues,
                    "warning",
                    "template children path should be a string",
                    f"{cpath}.children.path",
                )
        else:
            add_issue(
                issues,
                "warning",
                "children should be an array of IDs or a template object",
                f"{cpath}.children",
            )
    if "tabItems" in comp:
        items = comp["tabItems"]
        if isinstance(items, list):
            for i, item in enumerate(items):
                if isinstance(item, dict) and isinstance(item.get("child"), str):
                    state.child_refs.append(
                        (cid, item["child"], f"{cpath}.tabItems[{i}].child")
                    )
                else:
                    add_issue(
                        issues,
                        "warning",
                        "tabItems entries should include a child component ID",
                        f"{cpath}.tabItems[{i}]",
                    )


def validate_v08(messages: list[Any], initial_issues: list[Issue]) -> ValidationResult:
    issues = list(initial_issues)
    surfaces: dict[str, SurfaceState] = {}

    for index, msg in enumerate(messages):
        base = f"$[{index}]"
        if not isinstance(msg, dict):
            add_issue(issues, "error", "Message must be a JSON object", base)
            continue
        if msg.get("version") == "v0.9":
            add_issue(
                issues, "error", "v0.8 payload should not include version: v0.9", base
            )
        keys = payload_keys(msg, V08_KEYS)
        if len(keys) != 1:
            add_issue(
                issues,
                "error",
                "v0.8 message must contain exactly one A2UI payload key",
                base,
            )
            continue
        key = keys[0]
        payload = msg[key]
        if not isinstance(payload, dict):
            add_issue(
                issues, "error", f"{key} payload must be an object", f"{base}.{key}"
            )
            continue

        if key == "surfaceUpdate":
            sid = payload.get("surfaceId", "main")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "surfaceUpdate.surfaceId must be a non-empty string when present",
                    f"{base}.surfaceUpdate.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            state.created = (
                True  # v0.8 surfaces are often implicit until beginRendering.
            )
            components = payload.get("components")
            if not isinstance(components, list):
                add_issue(
                    issues,
                    "error",
                    "surfaceUpdate.components must be an array",
                    f"{base}.surfaceUpdate.components",
                )
                continue
            seen_in_message: set[str] = set()
            for comp_index, comp in enumerate(components):
                cpath = f"{base}.surfaceUpdate.components[{comp_index}]"
                if not isinstance(comp, dict):
                    add_issue(issues, "error", "Component must be an object", cpath)
                    continue
                cid = comp.get("id")
                wrapper = comp.get("component")
                if not isinstance(cid, str) or not cid:
                    add_issue(
                        issues,
                        "error",
                        "Component id must be a non-empty string",
                        f"{cpath}.id",
                    )
                    continue
                if cid in seen_in_message:
                    add_issue(
                        issues,
                        "error",
                        f"Duplicate component id {cid!r} within one surfaceUpdate message",
                        f"{cpath}.id",
                    )
                seen_in_message.add(cid)
                if cid == "root":
                    state.root_seen = True
                state.component_ids.add(cid)
                if not isinstance(wrapper, dict) or len(wrapper) != 1:
                    add_issue(
                        issues,
                        "error",
                        "v0.8 component must be a wrapper object with exactly one component type key",
                        f"{cpath}.component",
                    )
                    continue
                ctype, props = next(iter(wrapper.items()))
                if not isinstance(ctype, str) or not ctype:
                    add_issue(
                        issues,
                        "error",
                        "v0.8 component wrapper key must be a non-empty type name",
                        f"{cpath}.component",
                    )
                    continue
                if not isinstance(props, dict):
                    add_issue(
                        issues,
                        "error",
                        "v0.8 component wrapper value must be an object",
                        f"{cpath}.component.{ctype}",
                    )
                    continue
                collect_child_refs_v08(
                    props, cid, f"{cpath}.component.{ctype}", state, issues
                )

        elif key == "dataModelUpdate":
            sid = payload.get("surfaceId", "main")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "dataModelUpdate.surfaceId must be a non-empty string when present",
                    f"{base}.dataModelUpdate.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            state.created = True
            contents = payload.get("contents")
            if contents is not None and not isinstance(contents, (list, dict)):
                add_issue(
                    issues,
                    "warning",
                    "dataModelUpdate.contents should be an array of typed entries or an object in some older examples",
                    f"{base}.dataModelUpdate.contents",
                )
            if isinstance(contents, list):
                for item_index, item in enumerate(contents):
                    if not isinstance(item, dict) or "key" not in item:
                        add_issue(
                            issues,
                            "warning",
                            "dataModelUpdate.contents entries should contain key and typed value fields",
                            f"{base}.dataModelUpdate.contents[{item_index}]",
                        )

        elif key == "beginRendering":
            sid = payload.get("surfaceId", "main")
            root = payload.get("root")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "beginRendering.surfaceId must be a non-empty string when present",
                    f"{base}.beginRendering.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            state.created = True
            if not isinstance(root, str) or not root:
                add_issue(
                    issues,
                    "error",
                    "beginRendering.root must be a non-empty string",
                    f"{base}.beginRendering.root",
                )
            else:
                state.begin_root = root
                if root == "root":
                    state.root_seen = True
            if isinstance(payload.get("catalogId"), str):
                state.catalog_id = payload["catalogId"]

        elif key == "deleteSurface":
            sid = payload.get("surfaceId")
            if not isinstance(sid, str) or not sid:
                add_issue(
                    issues,
                    "error",
                    "deleteSurface.surfaceId must be a non-empty string",
                    f"{base}.deleteSurface.surfaceId",
                )
                continue
            state = surface_for(surfaces, sid)
            state.deleted = True

        elif key == "userAction":
            for req in ("name", "surfaceId", "context"):
                if req not in payload:
                    add_issue(
                        issues,
                        "warning",
                        f"userAction is missing {req!r}",
                        f"{base}.userAction",
                    )

    finalize_graph_checks("v0.8", surfaces, issues)
    return ValidationResult("v0.8", len(messages), surfaces, issues)


def collect_child_refs_v08(
    props: dict[str, Any],
    cid: str,
    cpath: str,
    state: SurfaceState,
    issues: list[Issue],
) -> None:
    for field_name in CHILD_REF_FIELDS:
        if field_name in props:
            value = props[field_name]
            if isinstance(value, str):
                state.child_refs.append((cid, value, f"{cpath}.{field_name}"))
            else:
                add_issue(
                    issues,
                    "warning",
                    f"{field_name} should be a component ID string",
                    f"{cpath}.{field_name}",
                )
    if "children" in props:
        children = props["children"]
        if isinstance(children, dict):
            if "explicitList" in children:
                refs = children["explicitList"]
                if isinstance(refs, list):
                    for child_index, ref in enumerate(refs):
                        if isinstance(ref, str):
                            state.child_refs.append(
                                (
                                    cid,
                                    ref,
                                    f"{cpath}.children.explicitList[{child_index}]",
                                )
                            )
                        else:
                            add_issue(
                                issues,
                                "warning",
                                "explicitList entries should be component ID strings",
                                f"{cpath}.children.explicitList[{child_index}]",
                            )
                else:
                    add_issue(
                        issues,
                        "warning",
                        "children.explicitList should be an array",
                        f"{cpath}.children.explicitList",
                    )
            if "template" in children:
                template = children["template"]
                if isinstance(template, dict) and isinstance(
                    template.get("componentId"), str
                ):
                    state.child_refs.append(
                        (
                            cid,
                            template["componentId"],
                            f"{cpath}.children.template.componentId",
                        )
                    )
                else:
                    add_issue(
                        issues,
                        "warning",
                        "children.template should include componentId",
                        f"{cpath}.children.template",
                    )
        else:
            add_issue(
                issues,
                "warning",
                "v0.8 children should be an object with explicitList or template",
                f"{cpath}.children",
            )
    if "tabItems" in props:
        items = props["tabItems"]
        if isinstance(items, list):
            for i, item in enumerate(items):
                if isinstance(item, dict) and isinstance(item.get("child"), str):
                    state.child_refs.append(
                        (cid, item["child"], f"{cpath}.tabItems[{i}].child")
                    )


def finalize_graph_checks(
    version: str, surfaces: dict[str, SurfaceState], issues: list[Issue]
) -> None:
    for sid, state in surfaces.items():
        if (
            version == "v0.9"
            and state.created
            and not state.deleted
            and not state.root_seen
        ):
            add_issue(
                issues,
                "warning",
                f"Surface {sid!r} has no component with id 'root'",
                f"surface:{sid}",
            )
        if version == "v0.8" and state.begin_root:
            if state.begin_root not in state.component_ids:
                add_issue(
                    issues,
                    "error",
                    f"beginRendering.root {state.begin_root!r} is not defined in surface {sid!r}",
                    f"surface:{sid}.beginRendering.root",
                )
        for from_id, to_id, path in state.child_refs:
            if from_id == to_id:
                add_issue(
                    issues,
                    "error",
                    f"Component {from_id!r} references itself as a child",
                    path,
                )
            if to_id not in state.component_ids:
                add_issue(
                    issues,
                    "error",
                    f"Component {from_id!r} references missing child {to_id!r} in surface {sid!r}",
                    path,
                )


def format_text(result: ValidationResult) -> str:
    status = "OK" if result.ok else "FAILED"
    lines = [
        f"A2UI validation: {status}",
        f"Version: {result.version}",
        f"Messages: {result.message_count}",
        f"Surfaces: {len(result.surfaces)}",
        f"Components: {result.component_count}",
        f"Errors: {result.error_count}",
        f"Warnings: {result.warning_count}",
    ]
    if result.issues:
        lines.append("")
        for issue in result.issues:
            where = f" ({issue.path})" if issue.path else ""
            lines.append(f"{issue.level.upper()}: {issue.message}{where}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lightweight structural validator for A2UI payloads."
    )
    parser.add_argument(
        "path",
        nargs="?",
        help="Path to JSON, JSONL, or A2A DataPart. Reads stdin when omitted or '-'.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="json",
        help="Output format. Default: json",
    )
    parser.add_argument(
        "--version",
        choices=("auto", "v0.8", "v0.9"),
        default="auto",
        help="Force a protocol version. Default: auto",
    )
    args = parser.parse_args(argv)

    messages, load_issues = load_messages(args.path)
    version = args.version if args.version != "auto" else detect_version(messages)

    if version == "v0.9":
        result = validate_v09(messages, load_issues)
    elif version == "v0.8":
        result = validate_v08(messages, load_issues)
    else:
        issues = load_issues + [
            Issue(
                "error",
                f"Could not determine A2UI version automatically ({version})",
                "$",
            )
        ]
        result = ValidationResult(version, len(messages), {}, issues)

    if args.format == "json":
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
    else:
        print(format_text(result))

    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
