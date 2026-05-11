---
name: figma-file-reader
description: Use this skill when a user asks to read, inspect, summarize, parse, search, audit, extract design tokens from, or understand a Figma file, Figma URL, Figma node link, Dev Mode handoff, prototype, FigJam/Figma Design file, or Figma API JSON. Provides efficient REST API fetching, node-scoped parsing, caching, compact summaries, node search, and token extraction.
license: MIT
compatibility: Requires uv and Python 3.11+ for bundled scripts. Network access and a Figma token with file_content:read are required for API fetches; local Figma API JSON can be parsed without network.
metadata:
  version: "1.0.0"
  author: "evanlouie"
---

# Figma file reading and parsing

## Use this skill when

The user gives a Figma URL, file key, node link, exported Figma API JSON, design
handoff request, design-token extraction request, layer search request, or asks
to understand what is in a Figma file.

## Core rules

1. Prefer **small, targeted reads** over fetching a full file.
2. Parse Figma links first. A node URL usually contains both the file key and
   `node-id`; the URL form often uses `1-2`, while the API ID uses `1:2`.
3. Start with `depth=2` for file overviews. Fetch deeper only for pages, frames,
   or nodes that matter to the user's request.
4. Use `GET /v1/files/:key/nodes` for node-specific tasks. Batch node IDs in one
   request instead of sending many separate requests.
5. Cache API responses locally unless the user explicitly needs fresh data.
6. Never print, write, or expose the Figma token. Use environment variables
   rather than command-line token literals when possible.
7. Do not treat local `.fig` exports as a stable public JSON format. Use the
   REST API, a plugin export, or an existing Figma API JSON file.

## Available script

- `scripts/figma_read.py` — self-contained Python CLI for parsing Figma URLs,
  fetching API JSON with caching and 429 retry handling, summarizing file
  structure, searching nodes, and extracting design-token candidates.

Run `uv run scripts/...` commands from the skill directory root (cd into
`skills/figma-file-reader` first), matching the invocation shown in `README.md`:

```bash
cd skills/figma-file-reader
uv run scripts/figma_read.py --help
```

## Authentication

For private files, set one of these environment variables before fetching:

```bash
export FIGMA_TOKEN="<personal-access-token>"
# or
export FIGMA_ACCESS_TOKEN="<access-or-plan-token>"
# or, for OAuth bearer tokens
export FIGMA_OAUTH_TOKEN="<oauth-access-token>"
```

The script's default `--auth auto` picks the header based on token source:
`FIGMA_OAUTH_TOKEN` → `Authorization: Bearer <token>`; `FIGMA_TOKEN` /
`FIGMA_ACCESS_TOKEN` / `--token` → `X-Figma-Token: <token>`. Override with
`--auth bearer` or `--auth x-figma-token` when needed.

Use a token with at least `file_content:read` for file and node JSON. Read
`references/figma-api-notes.md` before using variables, comments, dev resources,
images, or metadata-only endpoints.

## Workflow

### 1. Parse the input reference

```bash
uv run scripts/figma_read.py parse-url "$FIGMA_REF"
```

Use the parsed `file_key` and `node_id` in later steps. If the user provides
only a file key, continue with that key.

### 2. Fetch the smallest useful JSON

For a whole-file overview:

```bash
uv run scripts/figma_read.py fetch "$FIGMA_REF" --depth 2 --output file-overview.json
```

For a node link or known frame/component ID:

```bash
uv run scripts/figma_read.py fetch "$FIGMA_REF" --endpoint nodes --depth 2 --output node-overview.json
```

For multiple nodes:

```bash
uv run scripts/figma_read.py fetch "$FIGMA_REF" --endpoint nodes --ids "12:34,56:78" --depth 3 --output nodes.json
```

Add `--refresh` only when cached data is stale or the user asks for the latest
file state.

### 3. Summarize before reading raw JSON

```bash
uv run scripts/figma_read.py summarize file-overview.json --format markdown --max-items 80
```

Use the summary to decide what to fetch next. Avoid pasting or reading entire
raw Figma JSON payloads unless they are very small.

### 4. Search for relevant nodes

```bash
uv run scripts/figma_read.py find file-overview.json --name "button|cta|checkout" --types FRAME COMPONENT INSTANCE TEXT --max 50
```

If matches are shallow placeholders, fetch the matching node IDs with
`--endpoint nodes` and an appropriate `--depth`.

### 5. Extract design-token candidates

```bash
uv run scripts/figma_read.py tokens file-overview.json --format markdown --max-items 120
```

Treat token output as **candidates**. Figma style metadata and variable
references do not always include resolved values in the same response. For
authoritative variables, use the Variables API when access and plan requirements
allow it.

## Response pattern

When answering a user, report only the useful parsed results:

```markdown
## Figma file summary

- File: [name]
- Last modified: [timestamp if available]
- Scope read: [file depth / node IDs / local JSON]
- Pages: [count and names]
- Main frames/components: [short list]

## Findings

[Relevant structure, tokens, copy, components, issues, or handoff details]

## Notes / limits

[Any missing permissions, null nodes, truncated depth, unresolved variables, or
cache status]
```

## Gotchas

- `GET /v1/files/:key` without `depth` can return a very large tree. Use `depth`
  or `ids`.
- `GET /v1/files/:key/nodes` can return `null` values for missing node IDs;
  handle them explicitly.
- Top-level canvas/page nodes may be returned even when requesting specific IDs.
- Vector path data is omitted by default; request `geometry=paths` only when
  vector geometry is needed.
- Rendered image URLs from the image endpoint are temporary; do not present them
  as permanent assets.
- Styles maps identify style metadata. Actual color/typography values usually
  live on nodes using those styles.
- Variables and dev resources have separate endpoints and additional scopes/plan
  constraints. Use this skill's file parser for bound references; use the API
  notes for separate endpoint calls.
- If the user gives a `.fig` file, ask for a Figma URL/file key or a JSON export
  from the Figma API/plugin. Do not reverse-engineer binary exports.

## More detail

Read `references/figma-api-notes.md` for endpoint and auth details. Read
`references/output-contracts.md` for compact output templates.
