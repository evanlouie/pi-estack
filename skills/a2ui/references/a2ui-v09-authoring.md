# A2UI v0.9 authoring guide

Use this guide for modern A2UI examples, reviews, and payload generation. v0.9 is draft; be explicit about that when production stability matters.

## Message model

A v0.9 stream is a sequence of JSON messages. A transport may carry these as JSONL, SSE events, WebSocket frames, A2A DataParts, AG UI events, MCP tool results, or a plain JSON array. Every v0.9 message includes:

```json
{"version": "v0.9", "<messageType>": {}}
```

Exactly one A2UI payload key should appear per message:

- `createSurface`
- `updateComponents`
- `updateDataModel`
- `deleteSurface`
- `action` for client-to-server events
- `error` for client-to-server error reports

## Surface lifecycle

1. Send `createSurface` before component or data updates unless the surface is already known to exist.
2. Use a unique `surfaceId` per independent renderable region.
3. Use a `catalogId` that the client supports. For Basic Catalog examples, use `https://a2ui.org/specification/v0_9/basic_catalog.json`.
4. Do not change a surface's `surfaceId` or `catalogId` in place. Delete and recreate the surface to reconfigure it.
5. Include exactly one root component with `"id": "root"` in the component set for a complete surface.

Example:

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "reservation-panel",
    "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
    "sendDataModel": true
  }
}
```

Use `sendDataModel: true` only when the agent needs the renderer to include the full current surface data model in client-to-server message metadata.

## Component model

A2UI uses a flat adjacency list. Components have a unique `id`, a string `component` type, and top-level properties:

```json
{"id": "header", "component": "Text", "text": "Order summary", "variant": "h2"}
```

Containers reference child components by ID:

```json
{"id": "root", "component": "Column", "children": ["title", "summary-card", "actions-row"]}
{"id": "summary-card", "component": "Card", "child": "summary-content"}
```

Do not nest child components inline. Define children as separate component objects in the same surface.

## Basic Catalog quick reference

Always check the negotiated catalog for exact field names. As a practical v0.9 Basic Catalog starting point:

| Category | Components | Common properties |
|---|---|---|
| Layout | `Row`, `Column`, `List` | `children`, `justify`, `align`, `direction`, `weight` |
| Display | `Text`, `Image`, `Icon`, `Divider` | `text`, `url`, `description`, `name`, `axis`, `variant` |
| Interactive | `Button`, `TextField`, `CheckBox`, `Slider`, `DateTimeInput`, `ChoicePicker` | `child`, `label`, `value`, `variant`, `minValue`, `maxValue`, `options`, `enableDate`, `enableTime`, `action`, `checks` |
| Containers | `Card`, `Modal`, `Tabs` | `child`, `entryPointChild`, `contentChild`, `tabItems` |

Prefer these v0.9 idioms:

```json
{"id": "name-field", "component": "TextField", "label": "Name", "value": {"path": "/profile/name"}, "variant": "shortText"}
{"id": "agree", "component": "CheckBox", "label": "I agree", "value": {"path": "/form/agreed"}}
{"id": "submit", "component": "Button", "child": "submit-label", "variant": "primary", "action": {"event": {"name": "submit_form"}}}
```

## Data binding

Dynamic component properties accept either literals or path bindings:

```json
{"text": "Static title"}
{"text": {"path": "/user/displayName"}}
```

Rules:

- Absolute paths start with `/` and resolve from the root of the surface data model.
- `updateDataModel` uses JSON Pointer paths. Omit `path` or use `/` to replace the whole model.
- Omit `value` in `updateDataModel` to delete the key at `path`.
- Input components write locally to their bound data path before the renderer resolves event context.
- Prefer granular `updateDataModel` messages for changing data without resending structure.

Example full-model update:

```json
{
  "version": "v0.9",
  "updateDataModel": {
    "surfaceId": "reservation-panel",
    "path": "/",
    "value": {
      "reservation": {"partySize": 2, "time": "19:00"},
      "status": "draft"
    }
  }
}
```

Example granular update:

```json
{
  "version": "v0.9",
  "updateDataModel": {
    "surfaceId": "reservation-panel",
    "path": "/status",
    "value": "confirmed"
  }
}
```

## Dynamic lists

For repeatable data, define a template component and bind a container's `children` to the array path:

```json
{
  "id": "items-list",
  "component": "List",
  "children": {"componentId": "item-row-template", "path": "/items"},
  "direction": "vertical"
}
```

Inside template-rendered components, use relative paths when the negotiated renderer/catalog supports scoped path resolution. Use absolute paths when you need unambiguous root-scope binding.

## Actions

Server-handled events use `action.event`:

```json
{
  "id": "submit-button",
  "component": "Button",
  "child": "submit-button-label",
  "variant": "primary",
  "action": {
    "event": {
      "name": "submit_reservation",
      "context": {
        "reservation": {"path": "/reservation"},
        "source": "reservation-panel"
      }
    }
  }
}
```

Local client functions use `action.functionCall` and must be functions explicitly supported by the catalog/renderer:

```json
{
  "action": {
    "functionCall": {
      "call": "openUrl",
      "args": {"url": "https://example.com/help"}
    }
  }
}
```

Do not put arbitrary JavaScript, HTML event handlers, or code strings in action fields.

## Validation and repair loop

When generating A2UI with an LLM:

1. Include the target version, desired UI, negotiated catalog, and valid examples in the prompt.
2. Generate a message sequence.
3. Validate the generated JSON and catalog-specific component properties.
4. If validation fails, feed back a concise `error` message with `code`, `surfaceId`, `path`, and `message`, then regenerate only the broken part when possible.

A client-to-server validation error shape is:

```json
{
  "version": "v0.9",
  "error": {
    "code": "VALIDATION_FAILED",
    "surfaceId": "reservation-panel",
    "path": "/updateComponents/components/2/children",
    "message": "Expected an array of component IDs."
  }
}
```

## Common v0.9 mistakes

- Using v0.8 wrappers such as `"component": {"Text": {...}}`.
- Forgetting `"version": "v0.9"`.
- Omitting `createSurface` for a new surface.
- Omitting the `root` component.
- Referencing child IDs that are never defined.
- Mixing `surfaceUpdate`, `beginRendering`, or `dataModelUpdate` into a v0.9 stream.
- Trusting client-side validation instead of validating on the agent/server side too.
