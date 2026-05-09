# A2UI review and validation checklist

Use this checklist before returning A2UI JSON/JSONL or before approving an existing payload.

## Version and message shape

- The chosen version matches the user's request.
- v0.9 messages include `"version": "v0.9"`.
- v0.9 server messages use only `createSurface`, `updateComponents`, `updateDataModel`, and `deleteSurface`.
- v0.8 server messages use only `surfaceUpdate`, `dataModelUpdate`, `beginRendering`, and `deleteSurface`.
- Each message contains exactly one A2UI payload key, ignoring the v0.9 `version` field.
- JSON is parseable. JSONL has exactly one complete JSON object per non-empty line.

## Surface lifecycle

- Every surface has a stable `surfaceId`.
- v0.9 creates a new surface before updating it, unless the user explicitly says it already exists.
- v0.9 `createSurface` includes a valid `catalogId`.
- v0.8 sends `beginRendering` after enough components have been defined.
- Deleting and then updating the same surface is intentional and ordered correctly.

## Component graph

- Each component has a non-empty unique `id` within its surface.
- A complete v0.9 surface has one component with `id: "root"`.
- v0.8 `beginRendering.root` points to a defined component.
- Components are flat; they reference child IDs rather than nesting child component objects.
- Every `child`, `children`, `entryPointChild`, `contentChild`, and tab item `child` reference points to a defined component.
- The graph has no obvious self-child or circular references.
- IDs are descriptive and stable.

## Catalog correctness

- Component types exist in the selected catalog.
- Component properties are valid for their component types.
- Custom catalog IDs are preserved.
- Output does not assume Basic Catalog fields when a custom catalog is in use.
- For custom catalogs, child-reference fields use the catalog's component ID/child-list types so validators can check links.

## Data model and bindings

- v0.9 `updateDataModel.path` values are JSON Pointer paths and usually start with `/`.
- v0.9 bound values use `{ "path": "/..." }` where dynamic values are needed.
- v0.8 literal values use typed wrappers such as `literalString` when required.
- v0.8 data values use typed fields such as `valueString`, `valueNumber`, `valueBoolean`, or `valueMap`.
- Dynamic lists have a valid template component and a valid data path.
- Computed display strings are preformatted by the agent/server when the renderer does not provide an approved function.

## Actions and interaction

- Buttons and interactive components use the correct version-specific action shape.
- v0.9 server actions use `action.event` for agent-handled events.
- Local function calls name functions available in the catalog/renderer.
- Event `context` includes only the fields needed for the action.
- Client-side checks are treated as UX help, not as security or data-integrity enforcement.
- The action name and visible label do not conflict.

## Accessibility and UX

- Icon-only buttons have accessible labels or equivalent context.
- Images have descriptions where the catalog supports them.
- Form fields have labels.
- Layout is shallow enough for a renderer to present predictably.
- The UI can render progressively without showing misleading partial information.

## Transport packaging

- A2A DataParts use `metadata.mimeType: "application/json+a2ui"`.
- v0.9 A2A `data` is a list of A2UI messages when using the v0.9 extension packaging.
- Transport preserves message order and message boundaries.
- Metadata containing full data models is routed only to authorized recipients.

## Quick local validation

Run:

```bash
python3 scripts/validate_a2ui.py <payload-file> --format text
```

Interpretation:

- `OK`: no structural issues found by the lightweight validator.
- `WARNING`: likely issue or limitation that may still pass a full schema validator.
- `ERROR`: fix before returning or rendering.

For final integration, validate against the official protocol schema and the negotiated catalog schema.
