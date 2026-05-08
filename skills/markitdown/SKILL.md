---
name: markitdown
description: Convert documents and rich files to Markdown for LLM/RAG pipelines using Microsoft's `markitdown` CLI. Use whenever you need to extract text from PDF, DOCX, PPTX, XLSX/XLS, Outlook .msg, EPUB, HTML, CSV/JSON/XML, ZIP archives, images (EXIF + OCR via LLM), audio (EXIF + transcription), Jupyter notebooks, YouTube/Wikipedia/Bing-SERP/RSS URLs, or any mixed file dump that needs a clean Markdown view. Covers stdin/stdout piping, format hints (`-x`/`-m`/`-c`), output redirection, plugin enablement, Azure Document Intelligence, and choosing the right install extras. Prefer this over hand-rolled parsers (`pdftotext`, `unzip + grep`, `pandoc`, `textract`) for ad-hoc "give me the text" jobs.
---

# markitdown

`markitdown` is Microsoft's "everything → Markdown" CLI/library, designed for LLM ingestion (RAG, summarization, indexing) rather than pixel-perfect document fidelity. It dispatches the input to a format-specific converter and prints Markdown.

Prefer `markitdown` over `pdftotext`, `pandoc`, `textract`, `unzip`-and-grep, or hand-rolled parsers when the goal is "extract readable text/structure for an LLM."

## Mental model

```
markitdown [FILE]            [-o OUT] [-x EXT] [-m MIME] [-c CHARSET]
                             [-p|--use-plugins] [-d -e ENDPOINT]
                             [--keep-data-uris]
```

- One positional input. Omitted → reads from stdin.
- One output: `-o FILE`, or stdout (use shell redirection `> out.md`).
- The converter is picked from extension + sniffed MIME. If you pipe via stdin or pass a file with a wrong/missing extension, pass a hint: `-x pdf`, `-m application/pdf`, `-c utf-8`.
- No batch / glob / recursive mode. Loop in shell for many files.

## Install

```bash
# Recommended: all converters
uv tool install 'markitdown[all]'
# or
pipx install 'markitdown[all]'
# or in a venv
pip install 'markitdown[all]'
```

Per-format extras (combine in one bracket list). Use these when image/size matters, e.g., container builds:

| Extra                     | Adds                                               |
| ------------------------- | -------------------------------------------------- |
| `[all]`                   | Everything below                                   |
| `[pdf]`                   | PDF parsing                                        |
| `[docx]`                  | Word `.docx`                                       |
| `[pptx]`                  | PowerPoint `.pptx`                                 |
| `[xlsx]`                  | Modern Excel `.xlsx`                               |
| `[xls]`                   | Legacy Excel `.xls`                                |
| `[outlook]`               | Outlook `.msg`                                     |
| `[audio-transcription]`   | `.wav` / `.mp3` / `.m4a` / `.mp4` speech → text (uses SpeechRecognition + pydub; Google recognizer by default) |
| `[youtube-transcription]` | YouTube transcript fetcher                         |
| `[az-doc-intel]`          | Azure Document Intelligence client                 |

Verify install: `markitdown --version` and `markitdown --list-plugins`.

## Supported inputs (built-in converters)

PDF, DOCX, PPTX, XLSX, XLS, Outlook MSG, EPUB, HTML, CSV, JSON (RSS/Atom feeds via dedicated converter), images (EXIF; OCR only when an LLM client is supplied via the Python API), audio (EXIF; transcription with `[audio-transcription]`), Jupyter `.ipynb`, ZIP (recurses contents), plain text, YouTube URLs, Wikipedia URLs, Bing SERP URLs, RSS.

HTTP/HTTPS URLs are accepted as positional input for static pages and the URL-shaped converters above. Fetch first (e.g., `curl-cffi`) and pipe with `-x html` when you need custom headers/cookies/browser impersonation, a saved HTML artifact, or JavaScript-rendered/challenge-page troubleshooting.

## Quick recipes

```bash
# Basic: file → stdout
markitdown report.pdf

# File → file
markitdown report.pdf -o report.md
markitdown deck.pptx > deck.md           # equivalent via redirection

# Stdin (must hint the format unless it's plain text)
cat report.pdf | markitdown -x pdf > report.md
curl-cffi get https://example.com/a.docx | markitdown -x docx -o a.md

# HTML snippet from stdin
echo '<h1>Hi</h1><p>world <b>bold</b></p>' | markitdown -x html

# CSV → Markdown table (TSV is not a built-in table converter; convert to CSV first)
markitdown data.csv -o data.md

# Spreadsheet → one section per sheet
markitdown workbook.xlsx -o workbook.md

# Outlook message
markitdown thread.msg -o thread.md

# EPUB book
markitdown book.epub -o book.md

# Jupyter notebook (markdown/code/raw cells preserved; cell outputs are not included)
markitdown analysis.ipynb -o analysis.md

# ZIP of mixed docs (recurses; each entry rendered with its own converter)
markitdown bundle.zip -o bundle.md

# YouTube watch URL → transcript + metadata (needs [youtube-transcription])
markitdown 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' -o video.md

# Wikipedia page
markitdown 'https://en.wikipedia.org/wiki/Markdown' -o wiki.md

# Keep base64 image payloads instead of truncating them
markitdown slides.pptx --keep-data-uris -o slides.md
```

## Format hints (`-x`, `-m`, `-c`)

Use when the file has the wrong/no extension or comes via stdin:

```bash
# Wrong extension
markitdown -x pdf weird_name.bin -o out.md

# Force MIME
cat unknown.blob | markitdown -m application/vnd.openxmlformats-officedocument.wordprocessingml.document

# Latin-1 text
markitdown -x txt -c iso-8859-1 legacy.log
```

Pass at most what's needed; markitdown will sniff the rest.

## Batch conversion (shell loop)

There is no built-in glob mode. Use the shell:

```bash
# All PDFs in a tree → mirrored .md next to the source
find . -type f -name '*.pdf' -print0 | while IFS= read -r -d '' f; do
    markitdown "$f" -o "${f%.pdf}.md"
done

# Or with GNU parallel for speed
find . -name '*.docx' | parallel 'markitdown {} -o {.}.md'
```

## Plugins

Plugins ship separately, are off by default, and only load with `-p` / `--use-plugins`.

```bash
markitdown --list-plugins                # show installed plugins (and the discovery hint)
markitdown -p path-to-file.pdf -o out.md # run with plugins active
```

Search GitHub for the `#markitdown-plugin` hashtag to find more. Notable: `markitdown-ocr` (LLM-vision OCR for images embedded in PDF/DOCX/PPTX/XLSX) — install with `pip install markitdown-ocr` and supply an `llm_client` via the Python API; the CLI alone won't pass an OpenAI client through.

## Azure Document Intelligence (high-quality PDF/scan OCR)

Best path for scanned/complex PDFs when offline parsing produces garbage. Requires the `[az-doc-intel]` extra and an Azure endpoint.

```bash
markitdown scan.pdf -d -e "https://<your-resource>.cognitiveservices.azure.com/" -o scan.md
```

Auth uses `AZURE_API_KEY` with `AzureKeyCredential` when that environment variable is set; otherwise it falls back to `DefaultAzureCredential` (env vars / managed identity / `az login`). There is no CLI API-key flag.

## Image OCR / audio transcription notes

- **Images via the CLI alone**: extract EXIF only — no OCR. To OCR via vision LLM you must use the Python API with `llm_client=` (see below) or install the `markitdown-ocr` plugin and drive it from Python.
- **Audio via the CLI**: requires the `[audio-transcription]` extra; transcribes `.wav` / `.mp3` / `.m4a` / `.mp4` with SpeechRecognition + pydub and includes EXIF/ID3 metadata.
- **Scanned PDFs**: built-in PDF converter does _not_ OCR. Use `-d -e ENDPOINT` (Azure DocIntel) or pre-OCR with `ocrmypdf`.

## Output behavior gotchas

- Writes UTF-8 to stdout. Pipe to a file with `-o`/`>` for non-ASCII safety in some terminals.
- Embedded base64 images (`data:` URIs) are truncated by default; use `--keep-data-uris` to retain them (large outputs).
- Tables are emitted as GFM pipe tables; very wide spreadsheets stay valid Markdown but render unwieldy — fine for LLMs.
- ZIP conversion concatenates per-entry Markdown with file-name headings; nested archives recurse.

## Python API (when CLI isn't enough)

Reach for Python when you need: image OCR via LLM, custom prompts, batching with shared state, plugin configuration, or programmatic access to source metadata.

```python
from markitdown import MarkItDown
from openai import OpenAI

md = MarkItDown(
    enable_plugins=False,                 # set True to honor installed plugins
    llm_client=OpenAI(),                  # enables image OCR / descriptions
    llm_model="gpt-4o",
)

result = md.convert("deck.pptx")          # or convert_local / convert_stream / convert_response
print(result.text_content)                # the Markdown
print(result.title)                       # best-effort title (when available)
```

Security-conscious entry points (preferred in servers / untrusted input):

```python
md.convert_local("/safe/path/file.pdf")    # local files only
md.convert_stream(open("file.pdf", "rb"), file_extension=".pdf")
import requests
md.convert_response(requests.get(url))     # you control the fetch
```

Run ad-hoc without polluting the environment:

```bash
uv run --with 'markitdown[all]' python script.py
```

## Diagnosing problems

```bash
markitdown --version
markitdown --list-plugins
```

Common failure modes:

- **`MissingDependencyException` / "install markitdown[<ext>]"** — install the matching extra (e.g., `pip install 'markitdown[pdf]'`).
- **Empty / single-line output from a PDF** — it's a scan. Use `-d -e ENDPOINT` (Azure DocIntel) or pre-OCR.
- **`UnsupportedFormatException`** — converter didn't match. Re-run with `-x EXT` and/or `-m MIME` to force the right one.
- **Garbled non-ASCII text from stdin** — pass `-c utf-8` (or the actual charset).
- **Image yields only EXIF** — expected from CLI; need the Python API with an `llm_client`, or the `markitdown-ocr` plugin.
- **YouTube returns metadata only** — install `[youtube-transcription]`; use a `https://www.youtube.com/watch?...` URL and check the video actually has captions.

## When NOT to use markitdown

- High-fidelity human-facing conversions (layout, page numbers, footnotes preserved exactly) — use `pandoc` or commercial tools.
- Plain-text scrape of a JS-rendered web page — use the `agent-browser` skill, then pipe the resulting HTML in with `-x html`.
- Just need raw bytes / binary extraction — use the format's native CLI (`pdftotext`, `unzip`, `ffmpeg`).
- WebSocket/streaming sources — out of scope.
