---
name: web-to-markdown
description: Fetch a webpage that fingerprints, blocks, or rate-limits scripted clients and convert it to clean Markdown for LLM/RAG. Use whenever the goal is "read this URL into Markdown" and a bare curl/requests/markitdown URL might be blocked, or cookies/headers/browser TLS impersonation/a saved HTML artifact are needed. Provides a PEP 723 self-contained Python script that installs/caches curl_cffi and markitdown through uv, so those packages do not need to be preinstalled; covers protected HTML, cookie/header carry-over, binary downloads, challenge-page detection, and when to fall back to agent-browser for JavaScript/CAPTCHA pages.
compatibility: Requires uv and network access. The helper script downloads/caches its PEP 723 dependencies on first run.
---

# web-to-markdown

Turn a URL into LLM-ready Markdown even when the site fingerprints scripted clients. Prefer the bundled Python script over hand-written shell pipelines. The script declares its dependencies inline with PEP 723, so `curl_cffi` and `markitdown` do **not** need to already exist on the host.

## Available script

Run commands from this skill directory, or use the path to the script from your current working directory. From the repository root, use `skills/web-to-markdown/scripts/url_to_markdown.py`.

- **`scripts/url_to_markdown.py`** — Self-contained Python script. Fetches with `curl_cffi.requests` using browser impersonation, then converts response bytes with `markitdown`.

The script includes pinned dependencies in its PEP 723 block:

```python
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "curl_cffi==0.15.0",
#   "markitdown[all]==0.1.5",
# ]
# ///
```

Check the interface first:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py --help
# or, from this skill directory:
uv run scripts/url_to_markdown.py --help
```

You can also run it directly if executable bits are preserved:

```bash
./scripts/url_to_markdown.py --help
```

## Default workflow

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://example.com/article' -o article.md
```

What the script does:

1. Fetches with browser TLS/HTTP impersonation (`chrome146` by default).
2. Keeps raw response bytes, so HTML and binary documents both work.
3. Converts through `markitdown`, using hints from URL/content-type or `-x`/`-m`/`-c`.
4. Warns if the Markdown looks like a Cloudflare/anti-bot challenge page.
5. Fails with concise agent-readable errors instead of Python tracebacks for fetch, conversion, argument, and output-write failures.

Save the fetched response for debugging or reprocessing:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://news.example.com/post/123' \
  --fetched-output page.html \
  -o page.md \
  --summary-json page.fetch.json
```

- Markdown goes to stdout unless `-o/--output` is set.
- Diagnostics go to stderr.
- Optional metadata is JSON via `--summary-json`.

## Protected-site recipe

Start with the script and add browser-looking application-layer headers:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://shielded.example.com/article' \
  -i chrome146 \
  -H 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36' \
  -H 'Accept-Language:en-US,en;q=0.9' \
  -H 'Referer:https://www.google.com/' \
  -o article.md
```

`-i chrome146` covers TLS/H2 fingerprints. `User-Agent`, `Accept-Language`, and `Referer` make the HTTP request look more like a real browser. Keep the `User-Agent` Chrome version aligned with the impersonation target.

## Cookies and authenticated pages

Get `cf_clearance` or session cookies with a real browser (`agent-browser` skill or DevTools), then reuse them:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://protected.example.com/page' \
  -i chrome146 \
  -b "cf_clearance=$CF_CLEARANCE" \
  -b "session=$SESSION_COOKIE" \
  -o page.md
```

Bearer and basic auth are first-class flags:

```bash
# Bearer token
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://api.example.com/doc/42' \
  --bearer-token "$TOKEN" \
  -o doc.md

# Basic auth
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://wiki.internal/page' \
  --basic-auth "$USER:$PASS" \
  -o page.md
```

Proxy, timeout, and TLS verification controls:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://example.com' \
  --proxy 'http://127.0.0.1:8888' \
  --timeout 20 \
  --no-verify \
  -o page.md
```

## Format hints

The script infers an extension from the final URL path or response `Content-Type`. Override when the URL/content-type is missing or misleading:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://example.com/feed' -x rss -o feed.md
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://api.example.com/data' -x json -o data.md
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://legacy.example.com/page' -x html -c iso-8859-1 -o legacy.md
```

Use MIME hints when they are more precise than extensions:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://example.com/blob' \
  -m application/pdf \
  -x pdf \
  -o paper.md
```

## Binary files behind protected origins

The Python script keeps raw response bytes, so protected PDF/DOCX/PPTX/XLSX URLs can go through the same entrypoint:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://gated.example.com/whitepaper.pdf' \
  -i chrome146 \
  -b "session=$SESSION" \
  -x pdf \
  --fetched-output whitepaper.pdf \
  -o whitepaper.md
```

If the server returns an unhelpful `Content-Type`, pass `-x pdf`, `-x docx`, `-x pptx`, or `-x xlsx` explicitly.

## Batch URL lists

Use the script's batch mode instead of writing a shell loop. Blank lines and `#` comments in the URL list are ignored. Outputs use a stable 12-character SHA-1 prefix per URL:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py \
  --url-list urls.txt \
  --output-dir out
```

For each URL, batch mode writes:

- `out/<name>.md` — converted Markdown
- `out/<name>.body` — fetched response bytes
- `out/<name>.json` — fetch/conversion summary

## Picking the impersonation target

Default to the newest stable Chrome target supported by the pinned `curl_cffi` build. Inspect supported targets with a PEP 723 one-off using the same dependency version:

```bash
uv run --with 'curl_cffi==0.15.0' python -c \
  "from curl_cffi.requests import BrowserType; print(*sorted(t.value for t in BrowserType), sep='\n')"
```

Heuristic:

1. Start with `chrome146` or the newest listed `chromeXYZ`.
2. If the site is mobile/iOS/Safari-flavored, try `safari260_ios` or `chrome131_android`.
3. Keep the `User-Agent` version consistent with the impersonation target.
4. For Tor exit nodes, try `tor145`.

## Detecting blocked/challenge output

`scripts/url_to_markdown.py` warns when the converted Markdown contains common challenge-page fingerprints such as `Just a moment`, `Cloudflare`, or `verify you are human`.

If output looks blocked:

1. Try a newer/different `--impersonate` target.
2. Add browser-like headers (`User-Agent`, `Accept-Language`, `Referer`, and sometimes `Sec-Fetch-*`).
3. Add permitted cookies (`cf_clearance`, session cookies) from a real browser.
4. Save the fetched body and summary for inspection:

   ```bash
   uv run skills/web-to-markdown/scripts/url_to_markdown.py "$URL" \
     --allow-http-error \
     --fetched-output debug.body \
     --summary-json debug.json \
     -o debug.md
   ```

   If the built-in warning fires or `debug.md` is a challenge/consent page, proceed to the next step.

5. Fall back to `agent-browser` for JavaScript-rendered content or real CAPTCHAs.

## When to fall back to `agent-browser`

The curl_cffi → markitdown approach works best for server-rendered responses. Use `agent-browser` instead when:

- Content appears only after JavaScript runs (SPA placeholders, infinite scroll, client-side rendering).
- There is an interactive CAPTCHA/Turnstile/hCaptcha/reCAPTCHA.
- Login requires multi-step CSRF/browser-bound flows.
- Content arrives through Service Workers, WebSockets, or complex DOM interactions.

A good hybrid: use `agent-browser` to log in or solve an allowed challenge, export cookies, then return to `scripts/url_to_markdown.py` for cheap bulk fetching.

## Cleanup tips for Markdown

`markitdown` is not a readability extractor; nav, cookie banners, and footers may remain. Keep the fetched HTML/body when quality matters:

```bash
uv run skills/web-to-markdown/scripts/url_to_markdown.py 'https://example.com/page' \
  --fetched-output page.html \
  -o page.md
```

For higher-quality main-content extraction, pre-process saved HTML with a readability/trafilatura step, then convert that cleaned HTML separately with the `markitdown` skill. Do that only when the default Markdown contains too much boilerplate; the first pass should still be this script.

## See also

- `curl-cffi` skill — request-item syntax, impersonation matrix, `.http`/`.har` replay, proxies.
- `markitdown` skill — supported input formats, extras, plugins, Azure Document Intelligence, Python API.
- `agent-browser` skill — when JS execution or interactive browser state is unavoidable.
