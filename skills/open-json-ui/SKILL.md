---
name: open-json-ui
description: Use this skill when generating, reviewing, validating, or adapting Open-JSON-UI declarative generative UI payloads for agent-produced interfaces, including cards, screens, lists, forms, charts, tables, AG-UI-carried UI specs, and renderer-ready JSON component descriptions.
license: MIT
compatibility: Requires a skills-compatible agent. Optional validation script uses uv and Python 3.10+ with no third-party dependencies.
---

# Open-JSON-UI

Use this skill to produce or review Open-JSON-UI payloads: structured JSON UI
descriptions that an application renderer interprets into native UI components.
This skill is for declarative UI specs, not for arbitrary HTML/JS, React
components, or raw markdown.

## Default approach

1. **Find the renderer contract first.** If the user provides a project schema,
   renderer docs, component catalog, or examples, treat that as the source of
   truth and conform to it exactly.
2. **Pick the right dialect.** Public Open-JSON-UI references are not perfectly
   consistent. Use the dialect the project expects:
   - `screen/content` dialect for flattened agent-friendly specs.
   - `version/components` dialect for component-catalog renderers.
   - `type: "open-json-ui"` wrapper when the host expects an explicit
     Open-JSON-UI envelope.
   - AG-UI `STATE_DELTA` carrier only when the user asks to embed the UI spec in
     AG-UI events.
3. **Generate minimal, renderable JSON.** Prefer simple top-level fields, short
   strings, and predictable component types. Do not invent deeply nested layouts
   unless the renderer requires them.
4. **Validate before finalizing.** Run
   `uv run scripts/validate_open_json_ui.py <file>` when working with a saved
   JSON file, or use the checklist below for inline payloads.
5. **Explain assumptions.** When no renderer schema is supplied, state which
   dialect you used and that it is a conservative default.

Read `references/spec-notes.md` when you need more detail about dialects,
component conventions, renderer mapping, or edge cases. Read
`references/examples.md` when drafting a payload from scratch.

## Recommended output shape when no project schema is supplied

Prefer this flattened `screen/content` form because it is compact and easy for
agents to generate:

```json
{
  "type": "screen",
  "title": "Customer summary",
  "content": [
    {
      "type": "card",
      "title": "Account health",
      "content": [
        { "type": "text", "text": "Status: healthy" },
        { "type": "badge", "label": "Low risk", "tone": "success" }
      ]
    }
  ]
}
```

For hosts expecting an explicit Open-JSON-UI wrapper, wrap the spec:

```json
{
  "type": "open-json-ui",
  "spec": {
    "type": "screen",
    "title": "Customer summary",
    "content": []
  }
}
```

## Component authoring rules

- Every component must have a string `type`.
- Prefer these generic component types unless the renderer supplies a catalog:
  `screen`, `card`, `text`, `heading`, `list`, `table`, `form`, `input`,
  `select`, `button`, `chart`, `image`, `badge`, `divider`, `row`, `column`,
  `section`.
- Use semantic fields (`title`, `label`, `text`, `description`, `items`,
  `columns`, `rows`, `data`, `content`, `actions`) before custom fields.
- Keep nesting shallow. A `screen` can contain cards/sections; a card can
  contain text, lists, tables, charts, or forms.
- Use arrays for repeated items. Avoid objects with dynamic keys unless the
  renderer explicitly requires them.
- Do not include executable JavaScript, inline event handlers, CSS code, raw
  HTML, script tags, or URLs that imply untrusted execution.
- For actions, describe intent using stable names and parameters; do not include
  code:

```json
{
  "type": "button",
  "label": "Approve",
  "action": {
    "name": "approve_request",
    "parameters": { "requestId": "req_123" }
  }
}
```

## Validation checklist

Before returning or committing a payload, verify:

- The root object matches the expected host dialect.
- All JSON is valid and contains no comments, trailing commas, or markdown
  fences.
- The root has renderable content: `content`, `components`, `spec`, or AG-UI
  `delta.ui.content`.
- Each component has a valid `type` and only fields the renderer is likely to
  understand.
- Components with IDs use stable, unique string IDs.
- Tables have `columns` and `rows`; forms have named fields or inputs; charts
  have a clear chart type and data series.
- User-provided text is escaped as JSON strings and is not treated as code.
- Accessibility fields are present where useful: `label`, `alt`, `description`,
  `ariaLabel`.

## Running the validator

Use the bundled script for a quick sanity check:

```bash
uv run scripts/validate_open_json_ui.py payload.json
```

The script prints structured JSON with `valid`, `dialect`, `errors`, `warnings`,
and a component count. The exit code is `0` on success, `1` on validation
failures, and `2` on JSON parse/read errors. It is intentionally permissive: it
catches common mistakes without replacing the project renderer's authoritative
schema.

When the host accepts JSON Schema 2020-12 validation for the `screen/content`
dialect, point them at `assets/open-json-ui-screen.schema.json` — it is a
standalone JSON Schema describing the recommended flattened screen payload and
can be plugged into any 2020-12-compatible validator.

## Common gotchas

- **Do not assume one universal schema.** Match the consuming renderer.
  Open-JSON-UI examples in public material use more than one envelope.
- **AG-UI is a carrier, not the UI schema.** Only wrap Open-JSON-UI in AG-UI
  events when the transport/runtime expects it.
- **Avoid over-specifying layout.** Declarative renderers usually own spacing,
  typography, responsiveness, and theme.
- **Do not generate arbitrary code.** If the user needs executable or iframe UI,
  they likely need MCP Apps or another open-ended UI path, not Open-JSON-UI.
- **State uncertainty.** When the user has not supplied a renderer catalog,
  produce a conservative payload and note that it may need adjustment to the
  target renderer.
