# Open-JSON-UI reference notes

These notes summarize practical conventions for working with Open-JSON-UI-style declarative generative UI payloads.

## What Open-JSON-UI is for

Open-JSON-UI is used when an agent should describe a user interface as structured JSON and a frontend or host renderer should turn that JSON into actual UI. It fits the declarative generative UI pattern: the agent chooses what to show; the renderer controls how it is styled, laid out, secured, and made interactive.

Use this when the task asks for:

- JSON UI specifications
- agent-generated cards, screens, forms, tables, lists, charts, or widgets
- Open-JSON-UI review or validation
- mapping Open-JSON-UI into another renderer or protocol
- embedding an Open-JSON-UI payload in an AG-UI event stream

Do not use it for:

- React, JSX, HTML, CSS, or arbitrary JavaScript generation
- iframe-based MCP Apps payloads
- plain markdown responses
- direct frontend implementation unless the user asks for a renderer

## Public dialects to recognize

Public examples and docs around Open-JSON-UI are not all expressed with the same root envelope. Match the host system whenever possible.

### 1. Flattened screen/content dialect

A compact root object with `type: "screen"` and a `content` array.

```json
{
  "type": "screen",
  "title": "Revenue overview",
  "content": [
    { "type": "text", "text": "Q4 revenue increased 12%." }
  ]
}
```

This is good for LLM generation because the structure is shallow and content-first.

### 2. Component-catalog dialect

A root object with `version` and `components`, where components may have stable IDs and properties.

```json
{
  "version": "1.0",
  "components": [
    {
      "id": "main-card",
      "type": "card",
      "properties": {
        "title": "Revenue overview",
        "content": [
          { "type": "text", "text": "Q4 revenue increased 12%." }
        ]
      }
    }
  ]
}
```

Use this form when a renderer expects component identity, diffing, or a component catalog.

### 3. Explicit Open-JSON-UI wrapper

Some examples wrap a spec as `type: "open-json-ui"`.

```json
{
  "type": "open-json-ui",
  "spec": {
    "type": "screen",
    "title": "Revenue overview",
    "content": []
  }
}
```

Use this when the host accepts multiple payload kinds and needs a discriminator.

### 4. AG-UI carrier event

AG-UI is a runtime/transport protocol. It can carry an Open-JSON-UI payload, but it is not itself Open-JSON-UI.

```json
{
  "type": "STATE_DELTA",
  "delta": {
    "ui": {
      "spec": "open-json-ui",
      "content": {
        "type": "screen",
        "title": "Revenue overview",
        "content": []
      }
    }
  }
}
```

Only use this event shape when the user explicitly asks for AG-UI integration.

## Suggested generic component vocabulary

Use the project renderer's component catalog when one exists. Without one, prefer these generic types:

| Type | Typical fields | Notes |
|---|---|---|
| `screen` | `title`, `content`, `actions` | Root surface. |
| `section` | `title`, `content` | Group related blocks. |
| `card` | `title`, `description`, `content`, `actions` | Common container. |
| `heading` | `text`, `level` | Prefer `level` 1-6. |
| `text` | `text`, `variant` | Plain text only, no markdown unless renderer supports it. |
| `badge` | `label`, `tone` | Use tones such as `info`, `success`, `warning`, `danger`, `neutral`. |
| `list` | `ordered`, `items` | Items can be strings or simple objects. |
| `table` | `columns`, `rows` | Columns should have stable keys. |
| `chart` | `chartType`, `title`, `data`, `x`, `y`, `series` | Keep data small; summarize large datasets. |
| `form` | `title`, `fields`, `actions` | Include field names and validation hints. |
| `input` | `name`, `label`, `inputType`, `required`, `placeholder`, `value` | Use `inputType` values like `text`, `email`, `number`, `date`, `textarea`. |
| `select` | `name`, `label`, `options`, `required`, `value` | Options can be strings or `{label,value}` objects. |
| `button` | `label`, `action`, `style` | Action should be declarative, not executable. |
| `image` | `src`, `alt`, `caption` | Include `alt`. |
| `divider` | none or `label` | Visual separator. |
| `row` / `column` | `content`, `gap`, `align` | Use sparingly; renderers should own responsive layout. |

## Authoring forms

Good form payloads define names, labels, types, required state, and action semantics:

```json
{
  "type": "form",
  "title": "Create ticket",
  "fields": [
    { "type": "input", "name": "summary", "label": "Summary", "inputType": "text", "required": true },
    { "type": "select", "name": "priority", "label": "Priority", "options": ["Low", "Medium", "High"], "required": true }
  ],
  "actions": [
    { "type": "button", "label": "Submit", "action": { "name": "create_ticket" } }
  ]
}
```

Avoid using executable validation functions. Use declarative hints such as `required`, `pattern`, `min`, `max`, `minLength`, `maxLength`, or `description`.

## Authoring charts and tables

For charts:

- Keep data compact.
- Use `chartType` (`bar`, `line`, `area`, `pie`, `scatter`) and clear axis keys.
- Prefer arrays of records over parallel arrays.

```json
{
  "type": "chart",
  "chartType": "bar",
  "title": "Revenue by month",
  "x": "month",
  "y": "revenue",
  "data": [
    { "month": "Jan", "revenue": 12000 },
    { "month": "Feb", "revenue": 15000 }
  ]
}
```

For tables:

```json
{
  "type": "table",
  "columns": [
    { "key": "month", "label": "Month" },
    { "key": "revenue", "label": "Revenue" }
  ],
  "rows": [
    { "month": "Jan", "revenue": "$12,000" },
    { "month": "Feb", "revenue": "$15,000" }
  ]
}
```

## Mapping to renderers

When adapting Open-JSON-UI into a stricter renderer:

1. Detect the dialect.
2. Normalize to a root `screen` with a `content` array.
3. Assign stable IDs if the target renderer needs identity.
4. Convert generic components to the target catalog.
5. Convert strings to the target text value wrapper only if required by the renderer.
6. Convert actions into safe event names plus parameters.
7. Validate against the target renderer schema.

## Security and safety

- Treat all generated content as untrusted until rendered by a controlled renderer.
- Do not include script tags, event handler strings, arbitrary HTML, or inline CSS.
- Do not include secrets in payloads.
- Do not expose private data in UI fields unless the user has authorized it.
- Use declarative action names and parameters, not executable code.

## Final response pattern

When returning a payload to a user:

1. If the user asks for JSON-only output, provide only valid JSON.
2. Otherwise, state the dialect used in one sentence before the payload.
3. Provide the payload as JSON, without markdown fences if the host needs raw JSON.
4. If no target renderer schema was provided, include a brief caveat after the JSON that the target renderer may need field-name adjustments.
