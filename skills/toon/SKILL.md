---
name: toon
description: Use this skill when the user asks to convert JSON to or from TOON, author or validate .toon files, compact structured data for LLM prompts, choose delimiters/key folding/path expansion, compare TOON with JSON/YAML/CSV, or use the @toon-format/toon CLI/API.
license: MIT
compatibility: Requires Deno plus Node/npm/npx for bundled scripts/toon.ts, which wraps npx @toon-format/cli@2.2.0. Agents may run the official npx CLI directly when Deno is unavailable.
metadata:
  source_repository: "https://github.com/toon-format/toon"
  specification_repository: "https://github.com/toon-format/spec"
  toon_package: "@toon-format/toon@2.2.0"
  cli_package: "@toon-format/cli@2.2.0"
  spec_version: "3.0"
---

# TOON

TOON (Token-Oriented Object Notation) is a compact, line-oriented, indentation-based encoding of the JSON data model for LLM prompts. Use it as a translation layer: keep programmatic data as JSON, encode to TOON for prompt input, and decode or validate TOON before relying on it.

## Default workflow

1. Decide whether TOON is appropriate.
   - Prefer TOON for uniform arrays of objects, mixed structured data sent to LLMs, and prompts where explicit `[N]` lengths and `{fields}` improve readability and validation.
   - Prefer compact JSON for deeply nested or highly non-uniform data when token savings are uncertain.
   - Prefer CSV for purely flat tables when maximum compactness matters and nesting/type awareness is unnecessary.
   - Prefer JSON for public APIs, persistent storage, and application-level interchange unless the user specifically requests TOON.

2. Use official tooling for conversion, decoding, and validation whenever possible. Do not hand-convert large datasets.

3. Validate model-generated TOON before using it. Strict decode catches row-count, field-width, indentation, delimiter, and syntax errors.

4. For nontrivial syntax questions, validation-error diagnosis, or delimiter/key-folding/path-expansion details, read `references/toon-format-guide.md`.

## Bundled script

Run from the skill root:

```bash
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode input.json -o output.toon
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode data.toon -o output.json
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts validate data.toon
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts roundtrip input.json --toon-output output.toon -o restored.json
```

Useful options:

```bash
# Tab delimiter for large tabular data
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode data.json --delimiter tab -o data.toon

# Pipe delimiter when commas are common in values
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode data.json --delimiter pipe -o data.toon

# Collapse safe single-key wrapper chains
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode data.json --keyFolding safe -o folded.toon

# Reconstruct folded dotted paths while decoding
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode folded.toon --expandPaths safe -o restored.json
```

When Deno is unavailable but Node/npm are available, use the official CLI:

```bash
npx @toon-format/cli@2.2.0 input.json -o output.toon
npx @toon-format/cli@2.2.0 data.toon -o output.json
npx @toon-format/cli@2.2.0 data.json --stats
```

## Authoring rules to keep in working memory

### Objects

```toon
id: 123
name: Ada
profile:
  role: admin
  active: true
```

Use `key: value` for primitive fields and `key:` plus indented children for nested or empty objects. Preserve source key order.

### Primitive arrays

```toon
tags[3]: admin,ops,dev
empty[0]:
```

Array headers declare the exact length. Root arrays omit the key: `[3]: a,b,c`.

### Uniform arrays of objects

Use tabular form when every element is an object, all objects have the same keys, and all row values are primitive:

```toon
users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
```

The row count must equal `[N]`. Every row width must equal the field count in `{...}`.

### Mixed or nested arrays

Use expanded list form when array elements are non-uniform or contain nested objects/arrays:

```toon
items[3]:
  - 1
  - id: 2
    name: Nested
  - [2]: a,b
```

### Quoting

Quote string values when they are empty, have leading/trailing whitespace, look like a number/boolean/null, contain `:`, `"`, `\`, `[`, `]`, `{`, `}`, a control character, the active delimiter, or start with `-`.

Escape only these sequences inside quoted strings and keys: `\\`, `\"`, `\n`, `\r`, `\t`.

Unquoted keys and tabular field names should match:

```text
^[A-Za-z_][A-Za-z0-9_.]*$
```

Quote keys that do not match, including hyphenated keys:

```toon
"my-key"[2]: a,b
```

### Numbers, indentation, and whitespace

- Encode numbers in canonical decimal form: no exponent notation, no leading zeros, no trailing fractional zeros, and `-0` becomes `0`.
- Use two spaces per indentation level unless the user requests another indent size.
- Never use tabs for indentation. Tabs are allowed only as quoted string content or as the tab delimiter.
- Avoid comments, trailing spaces, and trailing newline in generated `.toon` files.

## Delimiters

Comma is the default. Tab can reduce token usage for large tabular data and pipe is useful when values often contain commas.

```toon
items[2|]{sku|name|qty}:
  A1|Widget|2
  B2|Gadget|1
```

When writing tab-delimited TOON by hand, the header and rows require actual tab characters, not the literal string `\t`; prefer the script or CLI.

## Key folding and path expansion

Dotted keys are literal by default:

```toon
user.name: Ada
```

Only decode them into nested objects when the user wants folded paths expanded:

```bash
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode data.toon --expandPaths safe
```

Use paired options for round-trips:

```bash
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts encode input.json --keyFolding safe -o folded.toon
deno run --allow-read --allow-write --allow-env --allow-run=npx scripts/toon.ts decode folded.toon --expandPaths safe -o restored.json
```

## Prompting with TOON

When embedding TOON in an LLM prompt, wrap it in a fenced code block and rely on the self-describing headers:

````markdown
```toon
users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
```
````

When asking a model to produce TOON, show the target header and require exact `[N]` counts and row widths. Decode or validate the generated TOON before using it in a pipeline.
