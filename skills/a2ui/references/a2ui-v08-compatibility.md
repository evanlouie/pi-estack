# A2UI v0.8 compatibility and conversion guide

Use v0.8 when the user asks for stable or production-oriented A2UI output, or
when the target renderer only supports v0.8.

## v0.8 message model

A v0.8 server-to-client stream is usually JSONL. Message keys are:

- `surfaceUpdate`: adds or updates component definitions in a surface.
- `dataModelUpdate`: updates the surface data model using typed key-value
  entries.
- `beginRendering`: tells the client to render from a specified root component.
- `deleteSurface`: removes a surface.

Client-to-server keys are:

- `userAction`: user-generated action event.
- `error`: renderer/client error report.

## v0.8 component format

In v0.8, each component object has an `id` and a `component` wrapper object that
contains exactly one component type:

```json
{
  "id": "title",
  "component": {
    "Text": {
      "text": { "literalString": "Welcome" },
      "usageHint": "h1"
    }
  }
}
```

Containers use `children.explicitList` for static children:

```json
{
  "id": "root",
  "component": {
    "Column": {
      "children": { "explicitList": ["title", "body"] }
    }
  }
}
```

Dynamic children use `children.template`:

```json
{
  "children": {
    "template": {
      "dataBinding": "/items",
      "componentId": "item-template"
    }
  }
}
```

## v0.8 data model updates

The v0.8 data model uses typed value entries instead of plain JSON values:

```json
{
  "dataModelUpdate": {
    "surfaceId": "profile",
    "contents": [
      {
        "key": "user",
        "valueMap": [
          { "key": "name", "valueString": "Alice" },
          { "key": "age", "valueNumber": 42 },
          { "key": "active", "valueBoolean": true }
        ]
      }
    ]
  }
}
```

Paths are typically relative segments such as `user` or slash-delimited paths
depending on renderer behavior. For conversion to v0.9, normalize to JSON
Pointer paths such as `/user/name`.

## v0.8 render signal

Send `beginRendering` after enough structure and data has arrived for a coherent
initial render:

```json
{
  "beginRendering": {
    "surfaceId": "profile",
    "root": "root",
    "catalogId": "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"
  }
}
```

## Conversion map: v0.8 to v0.9

| v0.8                                               | v0.9                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `beginRendering`                                   | `createSurface`, with root convention moved to a component whose `id` is `root` |
| `surfaceUpdate`                                    | `updateComponents`                                                              |
| `dataModelUpdate`                                  | `updateDataModel`                                                               |
| `userAction`                                       | `action`                                                                        |
| `component: {"Text": {...}}`                       | `component: "Text", ...props`                                                   |
| `children: {"explicitList": ["a", "b"]}`           | `children: ["a", "b"]`                                                          |
| `children.template.dataBinding`                    | `children.path`                                                                 |
| `literalString`, `literalNumber`, `literalBoolean` | direct JSON literals                                                            |
| `usageHint`                                        | `variant`                                                                       |
| `primary: true`                                    | `variant: "primary"`                                                            |
| `action: {"name": "x"}`                            | `action: {"event": {"name": "x"}}`                                              |
| `MultipleChoice`                                   | `ChoicePicker`                                                                  |
| typed `contents` values                            | plain JSON `value`                                                              |

## Conversion algorithm: v0.8 to v0.9

1. Gather all v0.8 messages by `surfaceId`.
2. Create a v0.9 `createSurface` for each surface. Use the v0.9 Basic Catalog
   unless the user gives a custom catalog.
3. Convert each `surfaceUpdate` component:
   - Read the single wrapper key as the v0.9 `component` string.
   - Lift wrapped properties to the component object.
   - Convert literal wrappers to raw literals.
   - Convert `children.explicitList` to `children` array.
   - Convert template children to `{ "componentId": "...", "path": "/..." }`.
   - Convert style names and action shapes.
4. Convert `dataModelUpdate.contents` to one or more `updateDataModel` messages
   with plain JSON values.
5. Ensure the component named by `beginRendering.root` is renamed to `root` or
   add a new `root` wrapper component that points to it.
6. Remove `beginRendering`; v0.9 renders after `createSurface` and
   `updateComponents` are processed.
7. Validate child references and data bindings.

## Conversion algorithm: v0.9 to v0.8

1. For each v0.9 `createSurface`, remember `surfaceId`, `catalogId`, and theme.
2. Convert `updateComponents` to `surfaceUpdate`:
   - Wrap each component's properties under its type name.
   - Convert raw literals to `literal*` wrappers where appropriate.
   - Convert `children` arrays to `children.explicitList`.
   - Convert `variant` to v0.8 fields such as `usageHint` for Text or `primary`
     for Button when possible.
   - Convert `action.event.name` to v0.8 action shape.
3. Convert each `updateDataModel` value into typed `contents` entries.
4. Add `beginRendering` for each surface after its initial component/data
   messages. The root is `root` unless the user specifies a different root.
5. Convert client `action` messages to `userAction`.

## Stable-output cautions

- Use v0.8 only if the target client or user asks for it. v0.9 is simpler for
  LLMs and current examples, but draft status matters.
- Do not assume a v0.8 renderer can consume v0.9 payloads, or vice versa.
- Preserve custom `catalogId` values. A catalog ID is a compatibility contract,
  not just documentation.
