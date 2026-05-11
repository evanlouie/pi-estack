# Catalogs, actions, transports, and security

## Catalogs

A2UI is catalog-driven. The core protocol defines the envelope and surface/data
semantics; the catalog defines the actual components, functions, theme
properties, and valid component fields.

Use the Basic Catalog for prototypes and examples:

- v0.9: `https://a2ui.org/specification/v0_9/basic_catalog.json`
- v0.8: `https://a2ui.org/specification/v0_8/standard_catalog_definition.json`

For production applications, prefer a custom catalog that mirrors the client's
existing design system. This keeps the agent constrained to components the
client can safely render.

Catalog authoring guidance:

- Give each catalog a stable, versioned `catalogId`, ideally under a domain
  controlled by the organization.
- Treat breaking component or function changes as a new catalog ID.
- Keep published catalogs freestanding when possible. Build-time `$ref`
  composition is fine, but agents and validators work best with a single
  assembled catalog.
- Use `ComponentId` and `ChildList` references for child links when authoring
  schema definitions, so validators can identify structural references.
- Provide the catalog to the model before asking it to generate payloads.
- Validate generated payloads against the envelope schema and the selected
  catalog schema.

## Actions

A2UI has two action paths:

1. **Events** go back to the agent/server.
2. **Functions** run locally in the renderer, only if the renderer and catalog
   explicitly expose them.

Event action shape for v0.9:

```json
{
  "action": {
    "event": {
      "name": "submit_order",
      "context": {
        "order": { "path": "/order" },
        "buttonId": "submit-order-button"
      }
    }
  }
}
```

Client action message shape for v0.9:

```json
{
  "version": "v0.9",
  "action": {
    "name": "submit_order",
    "surfaceId": "checkout",
    "sourceComponentId": "submit-order-button",
    "timestamp": "2026-01-01T00:00:00Z",
    "context": { "order": { "id": "123" } }
  }
}
```

Function action shape for v0.9:

```json
{
  "action": {
    "functionCall": {
      "call": "openUrl",
      "args": { "url": "https://example.com" }
    }
  }
}
```

Action rules:

- Use stable event names that the agent can switch on.
- Keep `context` small and explicit. Use paths to pull exactly the fields needed
  for the event.
- Do not embed secrets in event context unless the receiving agent is authorized
  to see them.
- Client-side checks improve UX but do not replace server-side validation.
- For forms, bind fields to data paths and send the relevant bound values in
  event context.

## Data model synchronization

In v0.9, `sendDataModel: true` in `createSurface` asks the renderer to include
the full current data model for the surface in metadata on client-to-server
messages.

Use it when:

- The agent needs the full form state even if the user submits through text or
  voice.
- The event context would otherwise be too incomplete.
- The surface owner is trusted to receive all surface state.

Avoid or strip it when:

- Routing events through an orchestrator that should not see all field values.
- A surface contains sensitive information not needed for the action.
- Another agent does not own the surface.

## Transport packaging

A2UI is transport-agnostic. Common transports are A2A, AG UI, MCP, SSE/JSON-RPC,
WebSockets, and REST.

Transport contract:

- Preserve message order.
- Frame individual JSON messages clearly.
- Provide metadata for capabilities, catalog negotiation, and optional data
  model synchronization.
- Provide a client-to-server return channel for interactive `action` messages.

## A2A extension packaging

For A2A, A2UI payloads are carried as DataParts with metadata:

```json
{
  "kind": "data",
  "metadata": { "mimeType": "application/json+a2ui" },
  "data": [
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "main",
        "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json"
      }
    }
  ]
}
```

Use the extension URI that matches the protocol version:

- v0.9: `https://a2ui.org/a2a-extension/a2ui/v0.9`
- v0.8: `https://a2ui.org/a2a-extension/a2ui/v0.8`

Receivers process a DataPart's message list sequentially. A failed message
should be reported or logged without preventing later messages from being
considered, unless the transport or application explicitly requires stricter
behavior.

## Security and trust boundaries

A2UI is safer than executable UI generation because it is declarative and
catalog-bounded, but it is not automatically risk-free.

Security checklist:

- Render only components and functions from a trusted catalog.
- Reject or sanitize unknown component types, unknown functions, and
  unrecognized properties.
- Treat URLs, images, markdown, and action context as untrusted input.
- Do not let the agent inject JavaScript, HTML event handlers, CSS with unsafe
  side effects, or arbitrary iframe content unless a trusted custom component
  intentionally supports and sandboxes it.
- Keep action labels and action names semantically aligned; do not let a button
  labeled `View invoice` trigger `delete_account`.
- Strip or redact data model metadata when routing actions to agents that do not
  own the surface.
- Log validation failures with enough detail for correction, but avoid leaking
  sensitive user data into logs.
