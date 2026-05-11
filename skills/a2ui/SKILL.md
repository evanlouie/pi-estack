---
name: a2ui
description: "Use this skill when the user asks to create, edit, review, validate, convert, or explain A2UI Agent to UI JSON, JSONL, surfaces, components, catalogs, data binding, actions, A2A DataParts, AG UI transport payloads, or generative UI schemas. Covers A2UI v0.9 draft and v0.8 stable."
license: MIT
compatibility: "Text and JSON authoring. Recommended validator requires uv with Python 3.10+."
metadata:
  version: "1.0.0"
  spec_versions: "A2UI v0.9 draft; A2UI v0.8 stable"
---

# A2UI skill

## When to use this skill

Use this skill for any task involving A2UI, Agent to UI, Agent-to-UI, agent-driven interfaces, generative UI payloads, A2UI catalogs, A2UI renderers, A2UI actions, A2A extension DataParts containing `application/json+a2ui`, or conversion between A2UI versions.

## Version policy

- If the user asks for production-ready, stable, or v0.8 output, use **A2UI v0.8 stable**.
- If the user asks for current A2UI, v0.9, modern, draft, custom catalogs, `createSurface`, or client-side functions, use **A2UI v0.9 draft**.
- If no version is specified, default to **v0.9 for new authoring examples**, but mention that v0.8 is the stable production release when that matters.
- When exact schema fidelity matters, validate against the negotiated catalog schema rather than assuming the Basic Catalog supports every property name.

## Core workflow

1. Identify the task type: author a payload, review/debug a payload, convert between v0.8 and v0.9, design a catalog, explain concepts, or wire A2UI through a transport.
2. Choose the target version using the version policy.
3. For v0.9 authoring, follow `references/a2ui-v09-authoring.md`.
4. For v0.8 or version conversion, follow `references/a2ui-v08-compatibility.md`.
5. For catalogs, actions, transport, or A2A DataParts, follow `references/catalogs-actions-transports.md`.
6. Before returning machine-consumable output, run the review checklist in `references/review-checklist.md`.
7. When possible, validate structural correctness with `scripts/validate_a2ui.py`.

## Output rules

- If the user asks for JSON, JSONL, a DataPart, or a schema, return only that artifact unless they request explanation.
- Keep A2UI payloads declarative. Do not emit executable UI code inside an A2UI surface. The client renderer owns component implementation.
- Use stable, descriptive IDs such as `reservation-form`, `submit-button-label`, and `order-summary-card`; avoid opaque IDs like `c1` except in tiny examples.
- Keep component trees shallow. Prefer `Column`, `Row`, `Card`, and `Tabs` for organization.
- Use data binding for dynamic values instead of regenerating full component trees for every content change.
- Preserve accessibility properties when present, and add accessibility labels for icon-only or image components.

## A2UI v0.9 essentials

Server-to-client messages use JSON objects with `"version": "v0.9"` and exactly one of these payload keys:

- `createSurface`: creates a surface and fixes its `surfaceId` and `catalogId`.
- `updateComponents`: adds or updates a flat list of components in a surface.
- `updateDataModel`: sets, replaces, or deletes data at a JSON Pointer path.
- `deleteSurface`: removes a surface.

A normal v0.9 sequence is:

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {"id": "root", "component": "Column", "children": ["title"]},
        {"id": "title", "component": "Text", "text": "Hello", "variant": "h1"}
      ]
    }
  }
]
```

A v0.9 surface must have one component with `"id": "root"`. Components are a flat adjacency list: containers reference children by ID rather than nesting component objects.

## A2UI v0.8 essentials

Server-to-client messages use `surfaceUpdate`, `dataModelUpdate`, `beginRendering`, and `deleteSurface`. v0.8 component definitions wrap properties under the component type, and `beginRendering` names the root component.

```jsonl
{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"Hello"},"usageHint":"h1"}}}]}}
{"beginRendering":{"surfaceId":"main","root":"root"}}
```

## Validation

Use the bundled structural validator for a quick check:

```bash
uv run --script scripts/validate_a2ui.py assets/examples/a2ui_v09_booking_form.json --format text
uv run --script scripts/validate_a2ui.py assets/examples/a2ui_v08_profile_card.jsonl --format text
```

The script uses a PEP 723 inline-metadata header, so `uv run --script` is recommended to ensure inline metadata is honored (bare `uv run` may not reliably honor it outside a uv project). Alternatively, the script is executable via its shebang (`#!/usr/bin/env -S uv run --script`), so you can run it directly, e.g. `./scripts/validate_a2ui.py …`.

The validator checks message shape, surface lifecycle, component IDs, obvious child references, and common v0.8/v0.9 structural mistakes. It is not a full replacement for validation against the official protocol and catalog JSON Schemas.
