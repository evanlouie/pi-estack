# Figma API notes for file parsing

## Default API path

The efficient path is:

1. Parse file key and optional node ID from the Figma URL.
2. Fetch a shallow overview with `GET /v1/files/:key?depth=2`.
3. Fetch specific subtrees with `GET /v1/files/:key/nodes?ids=<ids>&depth=<n>`.
4. Summarize or search the JSON using `scripts/figma_read.py`; do not load huge
   raw JSON into the agent context.

## Authentication headers

For personal access tokens, Figma supports the `X-Figma-Token` header. OAuth
bearer tokens use `Authorization: Bearer <token>`. The bundled script defaults
to `X-Figma-Token` unless `FIGMA_OAUTH_TOKEN` is used or `--auth bearer` is
passed.

Recommended environment variables:

```bash
export FIGMA_TOKEN="..."        # personal token, default X-Figma-Token header
export FIGMA_ACCESS_TOKEN="..." # access or plan token; choose --auth if needed
export FIGMA_OAUTH_TOKEN="..."  # OAuth bearer token
```

Do not pass tokens in prompts or commit them to files.

## Common endpoints

- `GET /v1/files/:key` — returns file metadata and a `document` root node. Use
  `depth`, `ids`, `geometry=paths`, `plugin_data`, `branch_data`, or `version`
  query parameters as needed.
- `GET /v1/files/:key/nodes?ids=...` — returns a `nodes` map for specific IDs;
  best for node links and targeted analysis.
- `GET /v1/images/:key?ids=...` — renders selected nodes. Batch IDs and remember
  URLs expire.
- `GET /v1/files/:key/styles` and component/style endpoints — useful for library
  metadata, not necessarily resolved style values.
- Variables API — use only when the token, plan, seat, and scopes support it.
  The file JSON can show `boundVariables`, but not every variable value is
  resolved there.
- Dev Resources API — use for developer-contributed links attached to nodes;
  requires dev-resource scopes.

## Query parameters to prefer

- `depth=1` or `depth=2` for initial reconnaissance.
- `ids=<node ids>` to include only relevant subtrees and ancestors.
- `geometry=paths` only for SVG/vector analysis; it can significantly enlarge
  responses.
- `plugin_data=shared` only if plugin-written shared data is relevant.
- `version=<version id>` only when the user asks about a historical version.
- `branch_data=true` only when branch/main relationships are needed.

## Rate limits and caching

Figma rate limits vary by endpoint tier, seat type, and plan. To avoid wasting
requests:

- Cache responses by file key, endpoint, and query parameters.
- Batch IDs in one request.
- Use shallow depth first.
- Respect `429` responses and `Retry-After` headers.
- Use `--refresh` only when fresh data is required.

The bundled script handles simple 429 retries and writes cached responses to
`.figma-cache/` by default.

## Figma JSON model

- The root is a `DOCUMENT` node.
- Pages are `CANVAS` nodes under the document.
- Frames, groups, components, instances, text, vectors, etc. appear as nested
  child nodes.
- Most nodes have `id`, `name`, `type`, and optional `visible`.
- Useful layout fields often include `absoluteBoundingBox`, `relativeTransform`,
  `layoutMode`, `layoutAlign`, `constraints`, `fills`, `strokes`, `effects`,
  `characters`, `style`, `styles`, `componentId`, `componentProperties`, and
  `boundVariables`.

## Interpreting design tokens

Treat tokens extracted from nodes as candidates:

- Color candidates come from visible `SOLID` fills/strokes and some effects.
- Typography candidates come from TEXT node style fields such as `fontFamily`,
  `fontPostScriptName`, `fontWeight`, `fontSize`, `lineHeightPx`,
  `letterSpacing`, and `textCase`.
- Spacing candidates can be inferred from auto-layout fields such as
  `itemSpacing`, `paddingLeft`, `paddingRight`, `paddingTop`, and
  `paddingBottom`.
- Radius candidates can be inferred from `cornerRadius` or per-corner radius
  fields.
- Resolved variable values may require the Variables API; bound aliases alone
  are not always enough.

## Error handling

- `403` usually means the token is missing, expired, lacks scopes, or lacks file
  permission.
- `404` usually means the file key is wrong or the token cannot access the file.
- `400` often means invalid query parameters or malformed node IDs.
- A `nodes` response can include requested IDs with `null` values; mention this
  to the user instead of treating it as a parser failure.
