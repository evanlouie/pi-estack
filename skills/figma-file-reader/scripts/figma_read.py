#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Efficient Figma file reader/parser for Agent Skills.

Supports:
- Parsing Figma URLs into file keys and API node ids.
- Fetching Figma REST API JSON with shallow/node-scoped queries, caching, and 429 retries.
- Summarizing local Figma API JSON without loading huge raw trees into agent context.
- Searching node trees by name/type/text/id.
- Extracting design-token candidates from node data.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

VERSION = "1.0.0"
DEFAULT_BASE_URL = "https://api.figma.com"
FIGMA_WEB_HOSTS = {"figma.com", "www.figma.com"}
KNOWN_FIGMA_PATH_TYPES = {
    "file",
    "design",
    "proto",
    "board",
    "figjam",
    "slides",
    "deck",
}
TOKEN_ENV_ORDER = ("FIGMA_OAUTH_TOKEN", "FIGMA_TOKEN", "FIGMA_ACCESS_TOKEN")

Json = dict[str, Any]


class FigmaReadError(RuntimeError):
    """CLI-facing error."""


def eprint(*parts: object) -> None:
    print(*parts, file=sys.stderr)


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False))


def first_value(value: list[str] | None) -> str | None:
    if not value:
        return None
    return value[0]


def normalize_node_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = urllib.parse.unquote(str(raw)).strip()
    if not value:
        return None
    # Figma web URLs commonly encode node id 12:34 as node-id=12-34.
    # API endpoints expect the colon form.
    if ":" not in value and "-" in value:
        value = value.replace("-", ":")
    return value


def normalize_node_ids(raw: str | None) -> str | None:
    if raw is None:
        return None
    values = [normalized for part in str(raw).split(",") if (normalized := normalize_node_id(part))]
    return ",".join(values) if values else None


def parse_figma_ref(ref: str) -> Json:
    ref = ref.strip()
    result: Json = {
        "input": ref,
        "is_url": False,
        "file_key": None,
        "node_id": None,
        "file_type": None,
        "url_host": None,
        "source": "raw-key",
    }

    if not ref:
        raise FigmaReadError("Empty Figma reference.")

    # Allow a bare key with query parameters, e.g. abc123?node-id=1-2
    if not ref.startswith(("http://", "https://")):
        if "?" in ref:
            maybe_key, query = ref.split("?", 1)
            result["file_key"] = maybe_key.strip().strip("/")
            qs = urllib.parse.parse_qs(query)
            result["node_id"] = normalize_node_id(
                first_value(qs.get("node-id"))
                or first_value(qs.get("node_id"))
                or first_value(qs.get("node"))
            )
            result["source"] = "raw-key-with-query"
        else:
            result["file_key"] = ref.strip().strip("/")
        return result

    parsed = urllib.parse.urlparse(ref)
    host = (parsed.netloc or "").lower()
    result["is_url"] = True
    result["url_host"] = host
    qs = urllib.parse.parse_qs(parsed.query)
    result["node_id"] = normalize_node_id(
        first_value(qs.get("node-id"))
        or first_value(qs.get("node_id"))
        or first_value(qs.get("node"))
    )

    path_parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]

    # Web URLs: /design/:key/:name, /file/:key/:name, /proto/:key/:name, etc.
    if host in FIGMA_WEB_HOSTS and len(path_parts) >= 2:
        result["file_type"] = path_parts[0]
        if path_parts[0] in KNOWN_FIGMA_PATH_TYPES:
            result["file_key"] = path_parts[1]
            result["source"] = "figma-web-url"
            return result

    # API URLs: /v1/files/:key, /v1/files/:key/nodes, /v1/images/:key
    if host.startswith("api.figma") and len(path_parts) >= 3 and path_parts[0] == "v1":
        if path_parts[1] in {"files", "images"}:
            result["file_key"] = path_parts[2]
            result["file_type"] = f"api-{path_parts[1]}"
            result["source"] = "figma-api-url"
            ids = first_value(qs.get("ids"))
            if ids and not result["node_id"]:
                result["node_id"] = normalize_node_id(ids.split(",")[0])
            return result

    # Fallback: use the second path segment if it looks like a normal Figma URL.
    if host.endswith("figma.com") and len(path_parts) >= 2:
        result["file_type"] = path_parts[0]
        result["file_key"] = path_parts[1]
        result["source"] = "figma-url-fallback"
        return result

    return result


def token_from_env(explicit_token: str | None) -> tuple[str | None, str | None]:
    if explicit_token:
        return explicit_token, "--token"
    for name in TOKEN_ENV_ORDER:
        value = os.environ.get(name)
        if value:
            return value, name
    return None, None


def auth_headers(token: str, token_source: str | None, auth: str) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": f"figma-file-reader/{VERSION}"}
    if auth == "auto":
        auth = "bearer" if token_source == "FIGMA_OAUTH_TOKEN" else "x-figma-token"
    if auth == "bearer":
        headers["Authorization"] = f"Bearer {token}"
    elif auth == "x-figma-token":
        headers["X-Figma-Token"] = token
    else:
        raise FigmaReadError(f"Unknown auth mode: {auth}")
    return headers


def build_api_url(base_url: str, endpoint: str, key: str, params: dict[str, Any]) -> str:
    base = base_url.rstrip("/")
    quoted_key = urllib.parse.quote(key, safe="")
    if endpoint == "file":
        path = f"/v1/files/{quoted_key}"
    elif endpoint == "nodes":
        path = f"/v1/files/{quoted_key}/nodes"
    elif endpoint == "metadata":
        path = f"/v1/files/{quoted_key}/meta"
    elif endpoint == "image":
        path = f"/v1/images/{quoted_key}"
    elif endpoint == "image-fills":
        path = f"/v1/files/{quoted_key}/images"
    else:
        raise FigmaReadError(f"Unsupported endpoint: {endpoint}")

    clean_params: dict[str, str] = {}
    for name, value in params.items():
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            clean_params[name] = "true" if value else "false"
        else:
            clean_params[name] = str(value)
    query = urllib.parse.urlencode(clean_params, safe=":,")
    return f"{base}{path}" + (f"?{query}" if query else "")


def cache_path(cache_dir: Path, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.json"


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise FigmaReadError(f"Invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise FigmaReadError(f"Could not read {path}: {exc}") from exc


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_json_url(url: str, headers: dict[str, str], max_retries: int) -> Any:
    attempts = 0
    while True:
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8")
                try:
                    return json.loads(body)
                except json.JSONDecodeError as exc:
                    raise FigmaReadError(f"Figma API returned non-JSON response from {url}: {body[:500]}") from exc
        except urllib.error.HTTPError as exc:
            status = exc.code
            body_bytes = exc.read() or b""
            body = body_bytes.decode("utf-8", errors="replace")[:1000]
            retry_after = exc.headers.get("Retry-After")
            if status == 429 and attempts < max_retries:
                attempts += 1
                sleep_seconds = max(1, int(float(retry_after or "1")))
                eprint(f"Rate limited by Figma API; retrying in {sleep_seconds}s ({attempts}/{max_retries}).")
                time.sleep(sleep_seconds)
                continue
            hint = ""
            if status == 403:
                hint = " Check token, scopes, and file permissions."
            elif status == 404:
                hint = " Check the file key and whether the token can access the file."
            elif status == 400:
                hint = " Check query parameters and node IDs."
            elif status == 429:
                hint = " Retry later or use cached/shallow/batched requests."
            raise FigmaReadError(f"Figma API HTTP {status}.{hint} Response: {body}") from exc
        except urllib.error.URLError as exc:
            raise FigmaReadError(f"Network error calling Figma API: {exc}") from exc


def child_nodes(node: Any) -> list[Json]:
    if not isinstance(node, dict):
        return []
    children = node.get("children")
    if isinstance(children, list):
        return [child for child in children if isinstance(child, dict)]
    return []


def node_name(node: Any) -> str:
    if isinstance(node, dict):
        return str(node.get("name") or "")
    return ""


def node_type(node: Any) -> str:
    if isinstance(node, dict):
        return str(node.get("type") or "UNKNOWN")
    return "UNKNOWN"


def node_id(node: Any) -> str:
    if isinstance(node, dict):
        return str(node.get("id") or "")
    return ""


def walk_tree(root: Json, path: tuple[str, ...] = ()) -> Iterable[tuple[Json, tuple[str, ...]]]:
    current_name = node_name(root) or node_type(root)
    current_path = path + (current_name,)
    yield root, current_path
    for child in child_nodes(root):
        yield from walk_tree(child, current_path)


def roots_from_data(data: Any) -> tuple[list[Json], list[str]]:
    roots: list[Json] = []
    null_node_ids: list[str] = []
    if not isinstance(data, dict):
        return roots, null_node_ids
    document = data.get("document")
    if isinstance(document, dict):
        roots.append(document)
    nodes_map = data.get("nodes")
    if isinstance(nodes_map, dict):
        for requested_id, wrapper in nodes_map.items():
            if wrapper is None:
                null_node_ids.append(str(requested_id))
                continue
            if isinstance(wrapper, dict):
                document = wrapper.get("document")
                if isinstance(document, dict):
                    roots.append(document)
    return roots, null_node_ids


def iter_nodes(data: Any, dedupe: bool = True) -> Iterable[tuple[Json, tuple[str, ...]]]:
    roots, _ = roots_from_data(data)
    seen: set[str] = set()
    for root in roots:
        for node, path in walk_tree(root):
            nid = node_id(node)
            if dedupe and nid:
                if nid in seen:
                    continue
                seen.add(nid)
            yield node, path


def collect_maps(data: Any, key: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if not isinstance(data, dict):
        return result
    top = data.get(key)
    if isinstance(top, dict):
        result.update(top)
    nodes_map = data.get("nodes")
    if isinstance(nodes_map, dict):
        for wrapper in nodes_map.values():
            if isinstance(wrapper, dict) and isinstance(wrapper.get(key), dict):
                result.update(wrapper[key])
    return result


def bbox_summary(node: Json) -> str | None:
    box = node.get("absoluteBoundingBox") or node.get("absoluteRenderBounds") or node.get("size")
    if not isinstance(box, dict):
        return None
    width = box.get("width")
    height = box.get("height")
    x = box.get("x")
    y = box.get("y")
    try:
        if width is not None and height is not None:
            wh = f"{float(width):g}×{float(height):g}"
            if x is not None and y is not None:
                return f"{wh} @ ({float(x):g},{float(y):g})"
            return wh
    except (TypeError, ValueError):
        return None
    return None


def top_level_pages(data: Any, max_items: int) -> list[Json]:
    pages: list[Json] = []
    roots, _ = roots_from_data(data)
    for root in roots:
        if node_type(root) == "DOCUMENT":
            candidates = child_nodes(root)
        elif node_type(root) == "CANVAS":
            candidates = [root]
        else:
            candidates = []
        for page in candidates:
            if node_type(page) != "CANVAS":
                continue
            top_children = child_nodes(page)
            pages.append(
                {
                    "id": node_id(page),
                    "name": node_name(page),
                    "top_level_count": len(top_children),
                    "top_level": [compact_node(child) for child in top_children[:max_items]],
                }
            )
    # Deduplicate page IDs where node endpoint wrappers include shared ancestors.
    seen: set[str] = set()
    deduped: list[Json] = []
    for page in pages:
        pid = str(page.get("id") or page.get("name"))
        if pid not in seen:
            seen.add(pid)
            deduped.append(page)
    return deduped


def compact_node(node: Json) -> Json:
    result: Json = {
        "id": node_id(node),
        "name": node_name(node),
        "type": node_type(node),
        "children": len(child_nodes(node)),
    }
    bbox = bbox_summary(node)
    if bbox:
        result["bounds"] = bbox
    if node.get("visible") is False:
        result["visible"] = False
    if "layoutMode" in node:
        result["layoutMode"] = node.get("layoutMode")
    if "componentId" in node:
        result["componentId"] = node.get("componentId")
    return result


def metadata_summary(data: Any) -> Json:
    if not isinstance(data, dict):
        return {}
    keys = [
        "name",
        "role",
        "lastModified",
        "editorType",
        "linkAccess",
        "version",
        "thumbnailUrl",
        "schemaVersion",
        "mainFileKey",
        "err",
    ]
    meta = {key: data[key] for key in keys if key in data}
    if isinstance(data.get("file"), dict):
        meta["file"] = data["file"]
    return meta


def summarize_data(data: Any, max_items: int) -> Json:
    roots, null_node_ids = roots_from_data(data)
    counts: collections.Counter[str] = collections.Counter()
    total_nodes = 0
    text_examples: list[Json] = []
    component_instance_count = 0
    bound_variable_refs = 0

    for node, path in iter_nodes(data, dedupe=True):
        total_nodes += 1
        typ = node_type(node)
        counts[typ] += 1
        if typ == "INSTANCE":
            component_instance_count += 1
        if isinstance(node.get("boundVariables"), dict):
            bound_variable_refs += count_variable_aliases(node.get("boundVariables"))
        if typ == "TEXT" and len(text_examples) < max_items:
            chars = str(node.get("characters") or "").replace("\n", " ")
            text_examples.append(
                {
                    "id": node_id(node),
                    "name": node_name(node),
                    "text": truncate(chars, 160),
                    "path": " / ".join(path),
                }
            )

    components = collect_maps(data, "components")
    component_sets = collect_maps(data, "componentSets")
    styles = collect_maps(data, "styles")

    return {
        "metadata": metadata_summary(data),
        "root_count": len(roots),
        "total_nodes_seen": total_nodes,
        "node_type_counts": dict(counts.most_common()),
        "null_node_ids": null_node_ids,
        "pages": top_level_pages(data, max_items=max_items),
        "components": summarize_map(components, max_items),
        "componentSets": summarize_map(component_sets, max_items),
        "styles": summarize_map(styles, max_items),
        "instance_count": component_instance_count,
        "bound_variable_reference_count": bound_variable_refs,
        "text_examples": text_examples,
    }


def summarize_map(values: dict[str, Any], max_items: int) -> Json:
    examples: list[Json] = []
    for key, value in list(values.items())[:max_items]:
        if isinstance(value, dict):
            item = {"key": key}
            for field in ("name", "description", "componentSetId", "documentationLinks", "remote", "key", "node_id", "style_type"):
                if field in value:
                    item[field] = value[field]
            examples.append(item)
        else:
            examples.append({"key": key, "value": value})
    return {"count": len(values), "examples": examples}


def count_variable_aliases(value: Any) -> int:
    if isinstance(value, dict):
        total = 0
        if value.get("type") == "VARIABLE_ALIAS" and value.get("id"):
            total += 1
        for child in value.values():
            total += count_variable_aliases(child)
        return total
    if isinstance(value, list):
        return sum(count_variable_aliases(child) for child in value)
    return 0


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def format_summary_markdown(summary: Json) -> str:
    lines: list[str] = []
    meta = summary.get("metadata", {}) if isinstance(summary.get("metadata"), dict) else {}
    lines.append("## Figma file summary")
    if meta:
        for key in ("name", "lastModified", "editorType", "version", "linkAccess", "role"):
            if key in meta:
                lines.append(f"- {key}: {meta[key]}")
    lines.append(f"- Nodes seen: {summary.get('total_nodes_seen', 0)}")
    lines.append(f"- Pages: {len(summary.get('pages') or [])}")
    nulls = summary.get("null_node_ids") or []
    if nulls:
        lines.append(f"- Null requested node IDs: {', '.join(nulls)}")
    lines.append("")

    counts = summary.get("node_type_counts") or {}
    if counts:
        lines.append("## Node type counts")
        for typ, count in list(counts.items())[:40]:
            lines.append(f"- {typ}: {count}")
        lines.append("")

    pages = summary.get("pages") or []
    if pages:
        lines.append("## Pages and top-level nodes")
        for page in pages:
            lines.append(f"### {page.get('name') or '(unnamed page)'} (`{page.get('id')}`)")
            lines.append(f"Top-level nodes: {page.get('top_level_count', 0)}")
            for child in page.get("top_level", []):
                bits = [f"{child.get('name') or '(unnamed)'}", f"`{child.get('type')}`", f"`{child.get('id')}`"]
                if child.get("bounds"):
                    bits.append(str(child["bounds"]))
                if child.get("layoutMode"):
                    bits.append(f"layout={child['layoutMode']}")
                lines.append("- " + " — ".join(bits))
        lines.append("")

    lines.append("## Design-system maps")
    for key in ("components", "componentSets", "styles"):
        section = summary.get(key) or {}
        lines.append(f"- {key}: {section.get('count', 0)}")
        for ex in (section.get("examples") or [])[:10]:
            label = ex.get("name") or ex.get("key")
            extra = ex.get("style_type") or ex.get("description") or ""
            lines.append(f"  - {label}" + (f" ({extra})" if extra else ""))
    lines.append(f"- bound variable references: {summary.get('bound_variable_reference_count', 0)}")
    lines.append("")

    texts = summary.get("text_examples") or []
    if texts:
        lines.append("## Text examples")
        for item in texts[:20]:
            lines.append(f"- `{item.get('id')}` {item.get('name')}: {item.get('text')}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def is_visible_node(node: Json) -> bool:
    return node.get("visible", True) is not False


def paint_visible(paint: Json) -> bool:
    return paint.get("visible", True) is not False


def rgba_to_value(color: Json, alpha: float | int | None = 1.0) -> str | None:
    try:
        r = int(round(float(color.get("r", 0)) * 255))
        g = int(round(float(color.get("g", 0)) * 255))
        b = int(round(float(color.get("b", 0)) * 255))
        a = float(alpha if alpha is not None else 1.0)
    except (TypeError, ValueError):
        return None
    r = min(255, max(0, r))
    g = min(255, max(0, g))
    b = min(255, max(0, b))
    if a >= 0.999:
        return f"#{r:02X}{g:02X}{b:02X}"
    a = min(1.0, max(0.0, a))
    return f"rgba({r},{g},{b},{a:.3g})"


def style_name_for(node: Json, style_field: str, styles_map: dict[str, Any]) -> str | None:
    styles = node.get("styles")
    if isinstance(styles, dict):
        style_id = styles.get(style_field)
        if style_id:
            style = styles_map.get(style_id)
            if isinstance(style, dict) and style.get("name"):
                return str(style["name"])
            return str(style_id)
    return None


def add_source(bucket: Json, source: Json, max_sources: int = 6) -> None:
    sources = bucket.setdefault("sources", [])
    if len(sources) < max_sources:
        sources.append(source)
    bucket["count"] = int(bucket.get("count") or 0) + 1


def extract_tokens(data: Any, include_invisible: bool, max_items: int) -> Json:
    styles_map = collect_maps(data, "styles")
    colors: dict[str, Json] = {}
    typography: dict[str, Json] = {}
    spacing: dict[str, Json] = {}
    radius: dict[str, Json] = {}
    variable_aliases: dict[str, Json] = {}

    for node, path in iter_nodes(data, dedupe=True):
        if not include_invisible and not is_visible_node(node):
            continue
        compact_source = {
            "node_id": node_id(node),
            "node_name": node_name(node),
            "node_type": node_type(node),
            "path": " / ".join(path[-5:]),
        }
        extract_color_tokens(node, styles_map, colors, compact_source)
        extract_typography_tokens(node, styles_map, typography, compact_source)
        extract_spacing_tokens(node, spacing, compact_source)
        extract_radius_tokens(node, radius, compact_source)
        extract_variable_aliases(node.get("boundVariables"), variable_aliases, compact_source)

    return {
        "colors": sorted_token_map(colors, max_items),
        "typography": sorted_token_map(typography, max_items),
        "spacing": sorted_token_map(spacing, max_items, numeric=True),
        "radius": sorted_token_map(radius, max_items, numeric=True),
        "variable_aliases": sorted_token_map(variable_aliases, max_items),
    }


def extract_color_tokens(node: Json, styles_map: dict[str, Any], colors: dict[str, Json], source: Json) -> None:
    for paint_field, style_field in (("fills", "fill"), ("strokes", "stroke")):
        paints = node.get(paint_field)
        if not isinstance(paints, list):
            continue
        style_label = style_name_for(node, style_field, styles_map)
        for index, paint in enumerate(paints):
            if not isinstance(paint, dict) or not paint_visible(paint):
                continue
            if paint.get("type") != "SOLID" or not isinstance(paint.get("color"), dict):
                continue
            value = rgba_to_value(paint["color"], paint.get("opacity", 1.0))
            if not value:
                continue
            label = style_label or f"{paint_field[:-1]}:{node_name(node) or node_id(node)}:{index}"
            key = f"{label}|{value}"
            bucket = colors.setdefault(key, {"name": label, "value": value, "kind": paint_field[:-1], "count": 0, "sources": []})
            add_source(bucket, source)


def extract_typography_tokens(node: Json, styles_map: dict[str, Any], typography: dict[str, Json], source: Json) -> None:
    if node_type(node) != "TEXT":
        return
    style = node.get("style")
    if not isinstance(style, dict):
        return
    label = style_name_for(node, "text", styles_map) or f"text:{node_name(node) or node_id(node)}"
    fields = {
        "fontFamily": style.get("fontFamily"),
        "fontPostScriptName": style.get("fontPostScriptName"),
        "fontWeight": style.get("fontWeight"),
        "fontSize": style.get("fontSize"),
        "lineHeightPx": style.get("lineHeightPx"),
        "lineHeightPercent": style.get("lineHeightPercent"),
        "letterSpacing": style.get("letterSpacing"),
        "textCase": style.get("textCase"),
        "textDecoration": style.get("textDecoration"),
    }
    normalized = json.dumps(fields, ensure_ascii=False, sort_keys=True)
    key = f"{label}|{normalized}"
    bucket = typography.setdefault(key, {"name": label, "style": fields, "count": 0, "sources": []})
    add_source(bucket, {**source, "text": truncate(str(node.get("characters") or "").replace("\n", " "), 120)})


def extract_spacing_tokens(node: Json, spacing: dict[str, Json], source: Json) -> None:
    fields = [
        "itemSpacing",
        "counterAxisSpacing",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "horizontalPadding",
        "verticalPadding",
        "gridColumnGap",
        "gridRowGap",
    ]
    for field in fields:
        value = node.get(field)
        if isinstance(value, (int, float)):
            key = f"{field}:{float(value):g}"
            bucket = spacing.setdefault(key, {"name": field, "value": float(value), "count": 0, "sources": []})
            add_source(bucket, source)


def extract_radius_tokens(node: Json, radius: dict[str, Json], source: Json) -> None:
    for field in ("cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"):
        value = node.get(field)
        if isinstance(value, (int, float)):
            key = f"{field}:{float(value):g}"
            bucket = radius.setdefault(key, {"name": field, "value": float(value), "count": 0, "sources": []})
            add_source(bucket, source)
    radii = node.get("rectangleCornerRadii")
    if isinstance(radii, list):
        for idx, value in enumerate(radii):
            if isinstance(value, (int, float)):
                field = f"rectangleCornerRadii[{idx}]"
                key = f"{field}:{float(value):g}"
                bucket = radius.setdefault(key, {"name": field, "value": float(value), "count": 0, "sources": []})
                add_source(bucket, source)


def extract_variable_aliases(value: Any, aliases: dict[str, Json], source: Json, field_path: tuple[str, ...] = ()) -> None:
    if isinstance(value, dict):
        if value.get("type") == "VARIABLE_ALIAS" and value.get("id"):
            alias_id = str(value["id"])
            label = "/".join(field_path) or "boundVariable"
            bucket = aliases.setdefault(alias_id, {"id": alias_id, "fields": set(), "count": 0, "sources": []})
            bucket["fields"].add(label)
            add_source(bucket, source)
        for key, child in value.items():
            extract_variable_aliases(child, aliases, source, field_path + (str(key),))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            extract_variable_aliases(child, aliases, source, field_path + (str(idx),))


def sorted_token_map(token_map: dict[str, Json], max_items: int, numeric: bool = False) -> list[Json]:
    def sort_key(item: tuple[str, Json]) -> Any:
        _, value = item
        if numeric:
            return (float(value.get("value", 0)), str(value.get("name", "")))
        return (-int(value.get("count", 0)), str(value.get("name", "")), str(value.get("value", "")))

    result = []
    for _, token in sorted(token_map.items(), key=sort_key)[:max_items]:
        # Sets are not JSON serializable.
        if isinstance(token.get("fields"), set):
            token = {**token, "fields": sorted(token["fields"])}
        result.append(token)
    return result


def format_tokens_markdown(tokens: Json) -> str:
    lines: list[str] = ["## Design-token candidates", ""]

    colors = tokens.get("colors") or []
    lines.append("### Colors")
    if colors:
        lines.append("| Name | Value | Uses | Example sources |")
        lines.append("|---|---:|---:|---|")
        for token in colors:
            sources = ", ".join(source_label(s) for s in token.get("sources", [])[:3])
            lines.append(f"| {md_escape(token.get('name'))} | `{token.get('value')}` | {token.get('count', 0)} | {md_escape(sources)} |")
    else:
        lines.append("No solid fill/stroke color candidates found.")
    lines.append("")

    typography = tokens.get("typography") or []
    lines.append("### Typography")
    if typography:
        lines.append("| Name | Family | Weight | Size | Line height | Uses | Example sources |")
        lines.append("|---|---|---:|---:|---:|---:|---|")
        for token in typography:
            style = token.get("style") or {}
            line_height = style.get("lineHeightPx") or style.get("lineHeightPercent") or ""
            sources = ", ".join(source_label(s) for s in token.get("sources", [])[:3])
            lines.append(
                "| "
                + " | ".join(
                    [
                        md_escape(token.get("name")),
                        md_escape(style.get("fontFamily")),
                        str(style.get("fontWeight") or ""),
                        str(style.get("fontSize") or ""),
                        str(line_height),
                        str(token.get("count", 0)),
                        md_escape(sources),
                    ]
                )
                + " |"
            )
    else:
        lines.append("No typography candidates found.")
    lines.append("")

    for section_name, key in (("Spacing", "spacing"), ("Radius", "radius")):
        values = tokens.get(key) or []
        lines.append(f"### {section_name}")
        if values:
            rendered = ", ".join(f"{item.get('name')}={float(item.get('value')):g}" for item in values[:80])
            lines.append(rendered)
        else:
            lines.append(f"No {section_name.lower()} candidates found.")
        lines.append("")

    aliases = tokens.get("variable_aliases") or []
    lines.append("### Bound variable aliases")
    if aliases:
        for token in aliases[:80]:
            fields = ", ".join(token.get("fields") or [])
            sources = ", ".join(source_label(s) for s in token.get("sources", [])[:3])
            lines.append(f"- `{token.get('id')}` ({token.get('count', 0)} refs; fields: {fields}; examples: {md_escape(sources)})")
    else:
        lines.append("No bound variable aliases found in parsed nodes.")
    lines.append("")
    lines.append("_These are candidates from node data. Resolve named variables/styles with dedicated API endpoints when authoritative design-token values are required._")
    return "\n".join(lines).rstrip() + "\n"


def source_label(source: Json) -> str:
    name = source.get("node_name") or "(unnamed)"
    nid = source.get("node_id") or ""
    return f"{name} [{nid}]" if nid else str(name)


def md_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def compile_regex(pattern: str | None, case_sensitive: bool) -> re.Pattern[str] | None:
    if not pattern:
        return None
    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        return re.compile(pattern, flags)
    except re.error as exc:
        raise FigmaReadError(f"Invalid regex {pattern!r}: {exc}") from exc


def find_nodes(
    data: Any,
    name_pattern: str | None,
    text_pattern: str | None,
    ids: set[str] | None,
    types: set[str] | None,
    case_sensitive: bool,
    max_items: int,
) -> list[Json]:
    name_re = compile_regex(name_pattern, case_sensitive)
    text_re = compile_regex(text_pattern, case_sensitive)
    normalized_types = {typ.upper() for typ in types} if types else None
    matches: list[Json] = []

    for node, path in iter_nodes(data, dedupe=True):
        nid = node_id(node)
        typ = node_type(node)
        name = node_name(node)
        chars = str(node.get("characters") or "")
        if ids and nid not in ids:
            continue
        if normalized_types and typ.upper() not in normalized_types:
            continue
        if name_re and not name_re.search(name):
            continue
        if text_re and not text_re.search(chars):
            continue
        matches.append(
            {
                **compact_node(node),
                "path": " / ".join(path),
                **({"characters": truncate(chars.replace("\n", " "), 240)} if chars else {}),
            }
        )
        if len(matches) >= max_items:
            break
    return matches


def format_find_markdown(matches: list[Json]) -> str:
    lines = [f"## Node matches ({len(matches)})", ""]
    if not matches:
        lines.append("No matching nodes found.")
        return "\n".join(lines) + "\n"
    for item in matches:
        bits = [f"`{item.get('id')}`", f"`{item.get('type')}`", str(item.get("name") or "(unnamed)")]
        if item.get("bounds"):
            bits.append(str(item["bounds"]))
        lines.append("- " + " — ".join(bits))
        if item.get("characters"):
            lines.append(f"  - Text: {item['characters']}")
        if item.get("path"):
            lines.append(f"  - Path: {item['path']}")
    return "\n".join(lines).rstrip() + "\n"


def cmd_parse_url(args: argparse.Namespace) -> int:
    print_json(parse_figma_ref(args.ref))
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    parsed = parse_figma_ref(args.ref)
    key = args.key or parsed.get("file_key")
    if not key:
        raise FigmaReadError("Could not determine Figma file key. Provide a file key or a Figma URL.")

    ids = normalize_node_ids(args.ids)
    if not ids and args.endpoint == "nodes" and parsed.get("node_id"):
        ids = parsed["node_id"]
    if args.endpoint in {"nodes", "image"} and not ids:
        raise FigmaReadError(f"Endpoint '{args.endpoint}' requires --ids or a Figma URL with node-id.")

    params: dict[str, Any] = {}
    if ids:
        params["ids"] = ids
    if args.depth is not None and args.endpoint in {"file", "nodes"}:
        params["depth"] = args.depth
    if args.version:
        params["version"] = args.version
    if args.geometry:
        params["geometry"] = args.geometry
    if args.plugin_data:
        params["plugin_data"] = args.plugin_data
    if args.branch_data and args.endpoint == "file":
        params["branch_data"] = True
    if args.endpoint == "image":
        if args.scale is not None:
            params["scale"] = args.scale
        if args.format:
            params["format"] = args.format
        if args.svg_include_node_id:
            params["svg_include_node_id"] = True
        if args.svg_include_id:
            params["svg_include_id"] = True
        if args.svg_outline_text is not None:
            params["svg_outline_text"] = args.svg_outline_text

    base_url = args.base_url or os.environ.get("FIGMA_BASE_URL") or DEFAULT_BASE_URL
    url = build_api_url(base_url, args.endpoint, key, params)

    token, token_source = token_from_env(args.token)
    if not token:
        raise FigmaReadError(
            "No Figma token found. Set FIGMA_TOKEN, FIGMA_ACCESS_TOKEN, or FIGMA_OAUTH_TOKEN, "
            "or pass --token. Prefer environment variables so tokens do not appear in shell history."
        )

    cache_dir = Path(args.cache_dir)
    cpath = cache_path(cache_dir, url)
    if not args.no_cache and not args.refresh and cpath.exists():
        data = read_json(cpath)
        eprint(f"Using cached response: {cpath}")
    else:
        data = fetch_json_url(url, auth_headers(token, token_source, args.auth), args.max_retries)
        if not args.no_cache:
            write_json(cpath, data)
            meta_path = cpath.with_suffix(".meta.json")
            write_json(meta_path, {"url": redact_url(url), "fetched_at": int(time.time()), "endpoint": args.endpoint, "file_key": key})
            eprint(f"Cached response: {cpath}")

    if args.output == "-":
        print_json(data)
    else:
        out = Path(args.output)
        write_json(out, data)
        eprint(f"Wrote {out}")
    return 0


def redact_url(url: str) -> str:
    # URLs here should not contain tokens, but keep helper for future safety.
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    safe = [(k, "<redacted>" if "token" in k.lower() else v) for k, v in qs]
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(safe, safe=":,")))


def cmd_summarize(args: argparse.Namespace) -> int:
    data = read_json(Path(args.json_file))
    summary = summarize_data(data, args.max_items)
    if args.format == "json":
        print_json(summary)
    else:
        print(format_summary_markdown(summary), end="")
    return 0


def cmd_find(args: argparse.Namespace) -> int:
    data = read_json(Path(args.json_file))
    normalized_ids = normalize_node_ids(args.ids)
    ids = set(normalized_ids.split(",")) if normalized_ids else None
    types = set(args.types) if args.types else None
    matches = find_nodes(data, args.name, args.text, ids, types, args.case_sensitive, args.max)
    if args.format == "json":
        print_json(matches)
    else:
        print(format_find_markdown(matches), end="")
    return 0


def cmd_tokens(args: argparse.Namespace) -> int:
    data = read_json(Path(args.json_file))
    tokens = extract_tokens(data, args.include_invisible, args.max_items)
    if args.format == "json":
        print_json(tokens)
    else:
        print(format_tokens_markdown(tokens), end="")
    return 0


def positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def optional_bool(value: str) -> bool:
    lowered = value.lower()
    if lowered in {"true", "1", "yes", "y"}:
        return True
    if lowered in {"false", "0", "no", "n"}:
        return False
    raise argparse.ArgumentTypeError("must be true or false")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Efficiently parse, fetch, summarize, search, and extract token candidates from Figma API JSON.",
    )
    parser.add_argument("--version", action="version", version=f"figma_read.py {VERSION}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_url = subparsers.add_parser("parse-url", help="Parse a Figma URL or file key.")
    parse_url.add_argument("ref", help="Figma URL, API URL, file key, or key?node-id=... reference.")
    parse_url.set_defaults(func=cmd_parse_url)

    fetch = subparsers.add_parser("fetch", help="Fetch Figma REST API JSON with caching and retries.")
    fetch.add_argument("ref", help="Figma URL, API URL, or file key.")
    fetch.add_argument("--key", help="Override parsed file key.")
    fetch.add_argument("--endpoint", choices=["file", "nodes", "metadata", "image", "image-fills"], default="file")
    fetch.add_argument("--ids", help="Comma-separated node IDs. URL hyphen form is accepted but colon form is preferred.")
    fetch.add_argument("--depth", type=positive_int, help="Depth for file/node JSON traversal. Use 1-3 for efficient reconnaissance.")
    fetch.add_argument("--version", dest="version", help="Specific Figma version ID.")
    fetch.add_argument("--geometry", choices=["paths"], help="Request vector path data. Expands responses.")
    fetch.add_argument("--plugin-data", help="Comma-separated plugin IDs or 'shared'.")
    fetch.add_argument("--branch-data", action="store_true", help="Include branch metadata for file endpoint.")
    fetch.add_argument("--scale", type=float, help="Image endpoint scale.")
    fetch.add_argument("--format", choices=["jpg", "png", "svg", "pdf"], help="Image endpoint output format.")
    fetch.add_argument("--svg-include-node-id", action="store_true", help="Image endpoint: include node IDs in SVG output.")
    fetch.add_argument("--svg-include-id", action="store_true", help="Image endpoint: include layer names as SVG IDs.")
    fetch.add_argument("--svg-outline-text", type=optional_bool, help="Image endpoint: true/false for text outlines in SVG.")
    fetch.add_argument("--base-url", help="Figma API base URL. Defaults to FIGMA_BASE_URL or https://api.figma.com.")
    fetch.add_argument("--token", help="Figma token. Prefer environment variables instead.")
    fetch.add_argument("--auth", choices=["auto", "x-figma-token", "bearer"], default="auto")
    fetch.add_argument("--cache-dir", default=".figma-cache", help="Cache directory. Default: .figma-cache")
    fetch.add_argument("--refresh", action="store_true", help="Bypass cache read and fetch fresh data.")
    fetch.add_argument("--no-cache", action="store_true", help="Do not read or write cache.")
    fetch.add_argument("--max-retries", type=positive_int, default=3, help="Retries for HTTP 429. Default: 3")
    fetch.add_argument("--output", "-o", default="figma-response.json", help="Output JSON path, or '-' for stdout.")
    fetch.set_defaults(func=cmd_fetch)

    summarize = subparsers.add_parser("summarize", help="Summarize a local Figma API JSON file.")
    summarize.add_argument("json_file")
    summarize.add_argument("--format", choices=["markdown", "json"], default="markdown")
    summarize.add_argument("--max-items", type=positive_int, default=60)
    summarize.set_defaults(func=cmd_summarize)

    find = subparsers.add_parser("find", help="Search nodes in a local Figma API JSON file.")
    find.add_argument("json_file")
    find.add_argument("--name", help="Regex to match node names.")
    find.add_argument("--text", help="Regex to match TEXT node characters.")
    find.add_argument("--ids", help="Comma-separated node IDs to match exactly.")
    find.add_argument("--types", nargs="+", help="Node types to include, e.g. FRAME COMPONENT INSTANCE TEXT.")
    find.add_argument("--case-sensitive", action="store_true")
    find.add_argument("--max", type=positive_int, default=50)
    find.add_argument("--format", choices=["markdown", "json"], default="markdown")
    find.set_defaults(func=cmd_find)

    tokens = subparsers.add_parser("tokens", help="Extract design-token candidates from a local Figma API JSON file.")
    tokens.add_argument("json_file")
    tokens.add_argument("--include-invisible", action="store_true")
    tokens.add_argument("--max-items", type=positive_int, default=120)
    tokens.add_argument("--format", choices=["markdown", "json"], default="markdown")
    tokens.set_defaults(func=cmd_tokens)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except FigmaReadError as exc:
        eprint(f"Error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
