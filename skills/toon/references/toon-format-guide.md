# TOON format guide

Source repositories:

- Reference implementation and CLI: https://github.com/toon-format/toon
- Specification: https://github.com/toon-format/spec
- Documentation: https://toonformat.dev

This guide is a practical operating reference for agents. For exact normative wording, consult the specification repository.

## What TOON is

TOON encodes the JSON data model in a line-oriented text format. It keeps objects readable through indentation and makes uniform arrays compact by declaring array length and field names once.

A typical JSON object:

```json
{
  "users": [
    { "id": 1, "name": "Alice", "role": "admin" },
    { "id": 2, "name": "Bob", "role": "user" }
  ]
}
```

TOON:

```toon
users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
```

## Format choice

Use TOON when:

- The user is preparing structured data for an LLM prompt.
- Data includes uniform arrays of objects, especially multiple fields per row.
- Exact array lengths and fixed row widths help catch truncation or malformed output.
- The user asks for `.toon`, `text/toon`, `@toon-format/toon`, or JSON↔TOON conversion.

Avoid or benchmark TOON when:

- Data is deeply nested and non-uniform; compact JSON may be smaller.
- Data is a flat table only; CSV is usually smaller.
- The user needs a public API format or long-term application storage; JSON is more standard.
- Latency is the top priority; compact representations can affect model/runtime behavior differently.

## Conversion commands

Bundled script:

```bash
bun run scripts/toon.ts encode input.json -o output.toon
bun run scripts/toon.ts decode input.toon -o output.json
bun run scripts/toon.ts validate input.toon
bun run scripts/toon.ts roundtrip input.json --toon-output encoded.toon -o restored.json
```

Official CLI:

```bash
npx @toon-format/cli@2.2.0 input.json -o output.toon
npx @toon-format/cli@2.2.0 input.toon -o output.json
npx @toon-format/cli@2.2.0 input.json --stats
```

Stdin examples:

```bash
cat data.json | bun run scripts/toon.ts encode > data.toon
cat data.toon | bun run scripts/toon.ts decode > data.json
echo '{"name":"Ada","role":"dev"}' | bun run scripts/toon.ts encode
```

## TypeScript API

Use the official TypeScript package when writing application code:

```ts
import { encode, decode } from '@toon-format/toon'

const data = {
  users: [
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Bob', role: 'user' },
  ],
}

const toon = encode(data, { delimiter: ',', keyFolding: 'off' })
const restored = decode(toon, { strict: true })
```

For large output, stream lines:

```ts
import { encodeLines } from '@toon-format/toon'

for (const line of encodeLines(data, { delimiter: '\t' })) {
  process.stdout.write(`${line}\n`)
}
```

## Syntax reference

### Objects

```toon
name: Ada
active: true
profile:
  role: admin
  team: platform
```

- A primitive field is `key: value`.
- A nested or empty object is `key:` with children indented one level deeper.
- Preserve object key order from the source JSON.

### Primitive values

Unquoted tokens decode as:

- `true` and `false` → booleans
- `null` → null
- Decimal/exponent numeric tokens → numbers, unless they have forbidden leading zeros
- Otherwise → strings

Quoted tokens always decode as strings.

### Primitive arrays

```toon
tags[3]: admin,ops,dev
empty[0]:
```

Rules:

- `[N]` is the declared item count.
- Inline primitive array values are split only by the active delimiter.
- Strict mode errors when the decoded value count does not match `N`.
- Root primitive arrays omit the key: `[3]: a,b,c`.

### Arrays of arrays

```toon
pairs[2]:
  - [2]: 1,2
  - [2]: 3,4
```

Each inner primitive array is a list item with its own header.

### Uniform arrays of objects

Tabular form applies when every array element is an object, all objects have the same keys, and all row values are primitive:

```toon
items[2]{sku,qty,price}:
  A1,2,9.99
  B2,1,14.5
```

Rules:

- The field order is usually the first object's key order.
- The number of rows must equal `[N]`.
- Each row must contain the same number of values as the field list.
- Root tabular arrays omit the key: `[2]{sku,qty}:`.

### Mixed arrays and nested arrays

Use expanded list form when data is non-uniform or contains nested arrays/objects:

```toon
events[3]:
  - id: 1
    type: click
  - id: 2
    error:
      code: E42
  - heartbeat
```

List-item object convention:

```toon
users[2]:
  - id: 1
    name: Alice
  - id: 2
    name: Bob
```

When the first field of a list-item object is itself a tabular array, put the header on the hyphen line and rows two levels deeper:

```toon
items[1]:
  - users[2]{id,name}:
      1,Ada
      2,Bob
    status: active
```

## Quoting and escaping

Quote string values when they:

- Are empty.
- Have leading or trailing whitespace.
- Equal `true`, `false`, or `null`.
- Look numeric, including exponent-like strings or leading-zero decimals.
- Contain colon, quote, backslash, brackets, braces, newline, carriage return, tab, or the active delimiter.
- Are exactly `-` or begin with `-`.

Escapes inside quoted strings and keys are limited to:

```text
\
"



	
```

Do not invent other escapes such as `\xNN` or `\uNNNN`.

Examples:

```toon
empty: ""
looks_number: "00123"
literal_bool: "true"
url: "https://example.com?a:b"
dash: "-value"
```

## Keys

Unquoted keys and tabular field names should match:

```text
^[A-Za-z_][A-Za-z0-9_.]*$
```

Quote anything else:

```toon
"full-name": Ada Lovelace
"my-key"[2]: a,b
"field with spaces": value
```

Dotted keys are literal unless path expansion is explicitly enabled:

```toon
user.name: Ada
```

This decodes by default as:

```json
{ "user.name": "Ada" }
```

With `expandPaths: "safe"`, it decodes as:

```json
{ "user": { "name": "Ada" } }
```

## Delimiters

TOON supports comma, tab, and pipe delimiters. The delimiter applies to inline primitive arrays and tabular rows within the nearest array header.

Comma default:

```toon
items[2]{sku,name}:
  A1,Widget
  B2,Gadget
```

Pipe:

```toon
items[2|]{sku|name}:
  A1|Widget
  B2|Gadget
```

Tab uses actual tab characters in the bracket, fields, and rows. Prefer a tool for tab-delimited output:

```bash
bun run scripts/toon.ts encode data.json --delimiter tab -o data.toon
```

Delimiter strategy:

- Comma is the default and easiest to read.
- Tab often tokenizes well for large tabular prompts and rarely appears in values.
- Pipe is useful when values contain many commas.

## Key folding and path expansion

Key folding reduces nested single-key wrapper chains:

```json
{ "data": { "metadata": { "items": ["a", "b"] } } }
```

With safe folding:

```toon
data.metadata.items[2]: a,b
```

Round-trip safely by pairing encode and decode options:

```bash
bun run scripts/toon.ts encode input.json --keyFolding safe -o folded.toon
bun run scripts/toon.ts decode folded.toon --expandPaths safe -o restored.json
```

Safe folding only folds identifier-like segments and avoids collisions. Do not enable path expansion unless the user wants dotted keys reconstructed as nested objects.

## Strict validation checklist

Strict decoding should fail on:

- Declared array count mismatch.
- Tabular row count mismatch.
- Tabular row width mismatch.
- Missing colon after keys or headers.
- Invalid or unterminated quoted strings.
- Header delimiter mismatches.
- Leading spaces not a multiple of the configured indent.
- Tabs used as indentation.
- Blank lines inside array/list/tabular row blocks.

Use:

```bash
bun run scripts/toon.ts validate data.toon
```

Expected structured result:

```json
{ "valid": true }
```

Invalid documents produce a JSON error object and a non-zero exit code.

## LLM prompt patterns

For input data, show TOON rather than explaining it:

````markdown
Use the structured data below.

```toon
orders[2]{id,total,status}:
  O-1,125.5,paid
  O-2,80,pending
```

Question: Which order is pending?
````

For model-generated TOON, provide the exact target header:

````markdown
Return only TOON matching this header and exactly 3 rows:

```toon
recommendations[3]{rank,title,reason}:
```
````

Then validate the model output before feeding it into code.

## Common mistakes

- Using YAML lists without a TOON array header.
- Forgetting `[N]` or using a count that does not match actual rows/items.
- Mixing commas in a pipe-delimited or tab-delimited row.
- Treating dotted keys as nested paths without `expandPaths: safe`.
- Leaving a trailing newline or trailing spaces in generated `.toon` files.
- Writing literal `\t` instead of an actual tab delimiter.
- Hand-generating large TOON blocks instead of using encoder tooling.
