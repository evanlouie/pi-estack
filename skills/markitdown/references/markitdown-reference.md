# MarkItDown reference

## Purpose

MarkItDown converts files and selected URLs into Markdown for LLM workflows,
indexing, and text analysis. The output should preserve useful document
structure such as headings, lists, links, and tables when the source converter
can extract them. It is not intended to be a high-fidelity page-layout
converter.

## Supported source types

Commonly supported sources include:

- PDF
- PowerPoint (`.pptx`)
- Word (`.docx`)
- Excel (`.xlsx`, `.xls` with the appropriate optional dependency)
- Images, including metadata and optional image descriptions/OCR workflows
- Audio, including metadata and optional speech transcription workflows
- HTML
- CSV, JSON, XML, and other text-based formats
- ZIP files, by iterating over contents
- YouTube URLs
- EPubs

Exact behavior depends on the installed MarkItDown version, optional
dependencies, plugins, and available credentials.

## Installation patterns

The skill uses a self-contained uv script with pinned dependency ranges:

```bash
uv run scripts/convert_to_markdown.py ./file.pdf --output-dir ./converted --json
```

For one-off CLI use without the helper script:

```bash
uvx --from 'markitdown[all]>=0.1.5,<0.2' markitdown ./file.pdf -o ./file.md
```

## CLI options useful to agents

Direct MarkItDown CLI:

```bash
markitdown INPUT -o OUTPUT.md
markitdown INPUT --extension .pdf --mime-type application/pdf --charset UTF-8 -o OUTPUT.md
markitdown INPUT --use-plugins -o OUTPUT.md
markitdown --list-plugins
markitdown INPUT -d -e "$AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT" -o OUTPUT.md
```

Bundled helper script:

```bash
uv run scripts/convert_to_markdown.py INPUT [INPUT ...] --output-dir DIR --json
uv run scripts/convert_to_markdown.py INPUT --output OUTPUT.md --overwrite --json
uv run scripts/convert_to_markdown.py INPUT --stdout
uv run scripts/convert_to_markdown.py URL --allow-remote --max-remote-mb 50 --output-dir DIR --json
uv run scripts/convert_to_markdown.py INPUT --use-plugins --output-dir DIR --json
uv run scripts/convert_to_markdown.py INPUT --docintel-endpoint ENDPOINT --output-dir DIR --json
uv run scripts/convert_to_markdown.py INPUT --llm-model MODEL --output-dir DIR --json
```

## Python API notes

Basic local conversion:

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False)
result = md.convert_local("document.pdf")
markdown = result.text_content
```

Use the narrowest method for the task:

- `convert_local(path)` for local files.
- `convert_stream(stream, ...)` for controlled byte streams.
- `convert_response(response, ...)` after making a validated `requests` call
  yourself.
- Avoid the broad `convert(source)` method in security-sensitive contexts
  because it can accept local paths, URLs, responses, and streams.

## Security guidance

MarkItDown performs I/O with the privileges of the current process. In hosted or
untrusted environments:

- Validate paths and only pass files the user is allowed to read.
- Avoid broad URL conversion. Validate URL schemes, hosts, redirects, and
  maximum size before fetching.
- Block private, loopback, link-local, metadata-service, and other non-public
  addresses.
- Keep plugins disabled unless the user explicitly requested a trusted plugin.
- Do not send documents to Azure Document Intelligence or an LLM provider
  without explicit user approval.

## Quality checks after conversion

After writing Markdown, inspect:

1. File exists and has non-zero size.
2. Headings, tables, and links are plausible for the original source.
3. For spreadsheets, tabs/sheets appear in a readable sequence.
4. For PDFs, output is not just page headers/footers or blank text.
5. For ZIP files, contents are clearly separated.
6. For image-only/scanned documents, report that OCR or Document Intelligence
   may be required.

## Troubleshooting matrix

| Symptom               | Likely cause                               | Next step                                                                    |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Empty PDF output      | Scanned/image-only PDF                     | Ask whether to use OCR, Azure Document Intelligence, or a trusted OCR plugin |
| Incorrect source type | Missing/ambiguous extension                | Retry with `--extension` and `--mime-type`                                   |
| Garbled text          | Charset issue                              | Retry with `--charset UTF-8` or source-specific encoding                     |
| Tables missing        | Source PDF flattened table structure       | Convert the original spreadsheet/CSV if available                            |
| Plugin output missing | Plugins disabled or not installed          | Run `markitdown --list-plugins`; retry with `--use-plugins` only if trusted  |
| Remote URL blocked    | Safety validation rejected URL or redirect | Download only if the URL is trusted and public, then convert the local file  |
