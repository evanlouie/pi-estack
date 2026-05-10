---
name: markitdown
description: Use this skill when a user asks to convert files, documents, Office files, PDFs, spreadsheets, slides, HTML, CSV, JSON, XML, images, audio, ZIP archives, EPubs, YouTube links, or trusted public URLs into Markdown using Microsoft MarkItDown; extract LLM-ready Markdown text; batch-convert documents; troubleshoot MarkItDown output; or use MarkItDown plugins, Azure Document Intelligence, or optional LLM image descriptions.
license: MIT
compatibility: Requires Python 3.10+ and uv. The bundled script installs markitdown[all]>=0.1.5,<0.2 in an isolated uv environment. Some conversions may require network access, API credentials, or third-party plugins when explicitly requested.
metadata:
  source: https://github.com/microsoft/markitdown
  skill_version: "1.0.0"
---

# MarkItDown

Use Microsoft MarkItDown to convert source files or trusted public URLs into Markdown optimized for LLM ingestion and text analysis.

## Default workflow

1. Identify the input files or URLs, the requested output location, and whether the user needs local-only conversion, remote URL conversion, plugins, Azure Document Intelligence, or LLM-generated image descriptions.
2. Prefer the bundled helper script for repeatable conversion and safer defaults:

```bash
uv run scripts/convert_to_markdown.py INPUT_FILE --output-dir OUTPUT_DIR --json
```

3. Verify the result before returning it: confirm the Markdown file exists, is non-empty, and has plausible headings/tables/text for the source type.
4. Report output paths and any conversion limitations. Do not claim high-fidelity visual/layout preservation; MarkItDown is intended for structured Markdown content, not exact visual reproduction.

## Common commands

Convert one local file to an output directory:

```bash
uv run scripts/convert_to_markdown.py ~/Downloads/report.pdf --output-dir ./converted --json
```

Convert multiple local files:

```bash
uv run scripts/convert_to_markdown.py docs/*.pdf docs/*.docx --output-dir ./converted --json
```

Write a single conversion to stdout:

```bash
uv run scripts/convert_to_markdown.py ./notes.docx --stdout
```

Write a single conversion to an explicit file:

```bash
uv run scripts/convert_to_markdown.py ./deck.pptx --output ./deck.md --overwrite --json
```

Convert a trusted public URL only when the user explicitly asks for URL conversion:

```bash
uv run scripts/convert_to_markdown.py 'https://example.com/page.html' --allow-remote --output-dir ./converted --json
```

Use Azure Document Intelligence for a PDF when the user requested it and provided/approved the endpoint:

```bash
uv run scripts/convert_to_markdown.py ./scanned.pdf --docintel-endpoint "$AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT" --output-dir ./converted --json
```

Use an LLM client for image descriptions only when the user asked for it and the required credentials are available:

```bash
uv run scripts/convert_to_markdown.py ./diagram.png --llm-model "$MODEL" --output-dir ./converted --json
```

## When to use plugins

Plugins are disabled by default. Enable them only when the user asks for plugin behavior or when a conversion requires a known installed plugin:

```bash
uv run scripts/convert_to_markdown.py ./file.pdf --use-plugins --output-dir ./converted --json
```

List installed plugins with the MarkItDown CLI:

```bash
uvx --from 'markitdown[all]>=0.1.5,<0.2' markitdown --list-plugins
```

## Fallback one-off CLI

For a simple trusted local file, the direct CLI is acceptable:

```bash
uvx --from 'markitdown[all]>=0.1.5,<0.2' markitdown path-to-file.pdf -o document.md
```

Use the bundled script instead for batch conversion, explicit JSON summaries, URL safety checks, output naming, overwrite control, Azure/LLM options, or format hints.

## Format hints

If MarkItDown cannot infer a stream or file type, retry with hints:

```bash
uv run scripts/convert_to_markdown.py ./unknown.bin --extension .pdf --mime-type application/pdf --output-dir ./converted --json
```

Use `--charset UTF-8` for ambiguous text encodings.

## Safety and privacy defaults

- Treat inputs as sensitive. Convert local files locally unless the user explicitly requests a remote service, Azure Document Intelligence, plugins, or LLM image descriptions.
- Do not run MarkItDown on untrusted paths or URLs in hosted/server contexts without validation. The helper script is local-only unless `--allow-remote` is supplied, and it blocks private, loopback, link-local, reserved, multicast, and non-HTTP(S) remote destinations.
- Do not enable plugins automatically. Third-party plugins may run additional code or make external calls.
- Do not send private files to Azure Document Intelligence or an LLM client unless the user explicitly requests it.
- For very large files, convert one at a time and check output incrementally.

## Troubleshooting

- Empty or low-quality PDF output: the file may be scanned/image-only. Ask whether OCR, Azure Document Intelligence, or a MarkItDown OCR plugin should be used; do not silently send the file externally.
- Broken tables: try converting the source spreadsheet/CSV directly rather than a PDF export.
- Misdetected type: use `--extension`, `--mime-type`, or `--charset`.
- Remote conversion failure: download the public file separately if appropriate, then convert the local copy.
- Plugin conversion failure: list installed plugins, confirm the requested plugin is installed, and retry with `--use-plugins` only for that file.

Read `references/markitdown-reference.md` for supported formats, API notes, and CLI option details.
