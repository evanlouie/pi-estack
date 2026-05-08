---
name: toon
description: "Use the TOON CLI (`toon` / `npx @toon-format/cli`) to convert JSON to Token-Oriented Object Notation and TOON back to JSON, analyze token savings, choose delimiters/key folding/path expansion options, and build stdin/stdout pipelines for LLM prompt data. Trigger when users mention TOON, .toon files, compact JSON for LLMs, token-efficient JSON serialization, or the toon-format CLI."
---

# TOON CLI

TOON (Token-Oriented Object Notation) is a compact, human-readable, schema-aware encoding of the JSON data model for LLM prompts. This skill is focused on the command-line tool: `@toon-format/cli` / `toon`.

Prefer the CLI when the user wants quick JSON↔TOON conversion, token-savings estimates, `.toon` files, shell pipelines, or large-data streaming without writing TypeScript code.

## Install / invoke

Use without installing:

```bash
npx @toon-format/cli input.json -o output.toon
```

Install globally for repeated use:

```bash
npm install -g @toon-format/cli
# then:
toon input.json -o output.toon
```

If `toon` is unavailable, use `npx @toon-format/cli` in examples or commands.

## Mental model

```bash
toon [input|-] [options]
```

- `.json` input → encode JSON to TOON.
- `.toon` input → decode TOON to JSON.
- No input, or `-`, reads stdin.
- Stdin defaults to encode; pass `--decode` for TOON from stdin.
- Output goes to stdout unless `-o, --output <file>` is provided.
- TOON files conventionally use `.toon`; media type is `text/toon`.

## Core recipes

```bash
# Encode JSON to TOON
toon input.json -o output.toon
npx @toon-format/cli input.json -o output.toon

# Decode TOON to JSON
toon data.toon -o output.json

# Print converted output to stdout
toon input.json

# Pipe JSON from stdin; defaults to encode
echo '{"name":"Ada","role":"dev"}' | toon
cat data.json | toon > data.toon

# Decode TOON from stdin
cat data.toon | toon --decode > data.json

# Analyze token savings while encoding
toon data.json --stats -o data.toon

# Use with jq/curl-style pipelines
jq '.results' response.json | toon > results.toon
curl https://api.example.com/data | toon --stats > data.toon
```

For authorized/web fetches in this environment, prefer the `curl-cffi` skill over raw `curl`, then pipe to `toon`.

## Options

| Option | Use |
| --- | --- |
| `-o, --output <file>` | Write output to a file instead of stdout. |
| `-e, --encode` | Force encode mode; useful with stdin or ambiguous file names. |
| `-d, --decode` | Force decode mode; required when decoding from stdin. |
| `--delimiter <char>` | Array delimiter: `,`, `\t`, or `|`. Use tab/pipe when it improves token efficiency or CSV-like readability. |
| `--indent <number>` | Indentation size; default `2`. |
| `--stats` | Show token estimates and savings; encode only. |
| `--no-strict` | Disable strict validation when decoding trusted input for faster processing. |
| `--keyFolding <mode>` | Key folding mode: `off` or `safe`; default `off`. |
| `--flattenDepth <number>` | Maximum folded path segments; only has an effect with `--keyFolding safe`. |
| `--expandPaths <mode>` | Path expansion mode: `off` or `safe`; default `off`. |

Combined efficiency example:

```bash
toon data.json --keyFolding safe --delimiter $'\t' --stats -o output.toon
```

## Large files and streaming

The CLI streams output incrementally, so it is useful for large datasets, but be precise about memory behavior:

- Encoding reads/parses the full JSON input, then streams TOON output.
- Decoding streams JSON output unless `--expandPaths safe` is used.
- `--stats` computes accurate token counts and may build the full TOON string internally.

```bash
toon huge-dataset.json -o huge-dataset.toon
toon huge-dataset.toon -o huge-dataset.json
cat million-records.json | toon --delimiter $'\t' > output.toon
```

Omit `--stats` for maximum memory efficiency on very large files.

`--expandPaths safe` on decode may fall back to non-streaming behavior to apply deep merge expansion before writing JSON.

## Validation and safety

- Decode strictly by default. This catches array count mismatches, indentation problems, and delimiter inconsistencies.
- Use `--no-strict` only when the input is trusted and speed matters:

```bash
toon data.toon --no-strict -o output.json
```

- Preserve original JSON when doing irreversible transformations or when comparing token savings.
- For generated `.toon`, validate round-trip when correctness matters:

```bash
toon input.json -o /tmp/input.toon
toon /tmp/input.toon -o /tmp/roundtrip.json
jq -S . input.json > /tmp/a.json
jq -S . /tmp/roundtrip.json > /tmp/b.json
diff -u /tmp/a.json /tmp/b.json
```

## When to recommend TOON

Use TOON for structured data sent to LLMs when compactness and readability matter, especially arrays of similarly-shaped objects. It is not always the right representation for tiny payloads, deeply irregular data, binary content, or contexts where only strict JSON is accepted.

## References

- Repository: https://github.com/toon-format/toon
- CLI docs: https://toonformat.dev/cli/
- Markdown docs for LLMs: https://toonformat.dev/cli.md
- Specification: https://github.com/toon-format/spec
