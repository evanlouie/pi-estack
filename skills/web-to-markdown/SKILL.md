---
name: web-to-markdown
description: Fetch a webpage that fingerprints, blocks, or rate-limits scripted clients (Cloudflare, Akamai, PerimeterX, DataDome, "Just a moment...", 403/429 from plain curl) and convert the response to clean Markdown for LLMs/RAG by piping `curl-cffi` into `markitdown`. Use whenever the goal is "read this URL into Markdown" and a bare `curl`/`requests`/`markitdown URL` is or might be blocked, or you need impersonation, cookies, auth, or a saved HTML artifact alongside the conversion. Covers the basic pipe, browser impersonation targets, cookie/header carry-over, charset/encoding hints, downloading non-HTML payloads (PDF/DOCX behind a site) before conversion, batch URL lists, detecting Cloudflare challenges in output, and knowing when to fall back to the agent-browser skill (JS-rendered pages, hard CAPTCHAs).
---

# web-to-markdown

The job: turn a URL into LLM-ready Markdown, even when the site fingerprints scripted clients. The recipe is a two-stage pipe:

```
curl-cffi get <URL> -i <browser>  |  markitdown -x html  >  out.md
```

`curl-cffi` handles the **fetch** (real-browser TLS/JA3, HTTP/2 SETTINGS, header order, cookies, redirects). `markitdown` handles the **convert** (HTML → Markdown). Each tool stays in its lane.

> Refer to the `curl-cffi` and `markitdown` skills for full per-tool detail. This skill is just the integration.

## Why not just `markitdown URL`?

`markitdown` accepts HTTP/HTTPS URLs for static pages and specialty converters — but generic fetching uses a normal Python HTTP stack, not browser-like TLS fingerprints. On any bot-protected origin (Cloudflare, Akamai, etc.) it may get the challenge page, not the content. The pipe pattern routes the fetch through `curl-cffi` so the same Markdown converter runs on the real HTML.

Use bare `markitdown URL` only for the **URL-shaped specialty converters** (YouTube, Wikipedia, Bing SERP, RSS) where the converter knows the API surface, or for unprotected static sites.

## Mental model

```
┌──────────────┐  HTTPS   ┌───────────────────────┐  HTML   ┌──────────────┐  Markdown
│  curl-cffi   │ ───────► │  origin (TLS-checks)  │ ──────► │  markitdown  │ ─────────► stdout / file
│  get -i ...  │          │  Cloudflare/Akamai/…  │         │  -x html     │
└──────────────┘                                            └──────────────┘
       ▲                                                           ▲
       │ optional: +cookies, Headers,                              │ optional: -c <charset>,
       │ --proxy, --no-verify, --http3                             │ --keep-data-uris
```

- HTTP body is text/HTML → `-x html` hint to `markitdown` (stdin has no extension).
- Body is a binary doc (PDF/DOCX/etc) → save raw bytes to disk first (prefer `--download --output basename` from the target directory; see the `curl-cffi --output` gotcha below), then `markitdown FILE`. Do not use stdout redirection for binary bodies because normal `curl-cffi` body output is decoded text.
- Body is JSON/RSS → `-x json` or `-x rss` (markitdown picks the right converter).

## Quick recipes

### 1. Plain pipe (the default move)

```bash
curl-cffi get https://example.com -i chrome146 | markitdown -x html > example.md
```

### 2. Heavily protected site (start here if anything 403s)

```bash
curl-cffi get https://shielded.example.com/article \
    -i chrome146 \
    "User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36" \
    Accept-Language:en-US,en;q=0.9 \
    Referer:https://www.google.com/ \
  | markitdown -x html > article.md
```

`-i chrome146` covers TLS+H2 fingerprints; the `User-Agent`/`Accept-Language`/`Referer` items make the _application-layer_ request look like a real browser too. Match the UA's Chrome version to the impersonation target.

### 3. With Cloudflare clearance / session cookies

Get `cf_clearance` (and any session cookies) once via a real browser (`agent-browser` skill or DevTools), then reuse:

```bash
curl-cffi get https://protected.example.com/api/page \
    -i chrome146 \
    +cf_clearance="$CF_CLEARANCE" \
    +session="$SESSION_COOKIE" \
  | markitdown -x html > page.md
```

`cf_clearance` is bound to the IP + UA + JA3 that solved the challenge. Keep impersonation target stable across runs, or it'll invalidate.

### 4. Save the HTML alongside the Markdown (debug-friendly default)

```bash
URL='https://news.example.com/post/123'
curl-cffi get "$URL" -i chrome146 --download --output page.html
markitdown page.html -o page.md
# now you can re-render without refetching, diff converter changes, etc.
```

Two-step is preferred when:

- You're iterating on the conversion (don't keep hitting the origin).
- You need to grep the raw HTML for missing data the converter dropped.
- The fetch is rate-limited or expensive.

### 5. Authenticated page (bearer / basic / form login)

```bash
# Bearer
curl-cffi get https://api.example.com/doc/42 -i chrome146 \
    Authorization:"Bearer $TOKEN" \
  | markitdown -x html

# Basic
curl-cffi get https://wiki.internal/page -i chrome146 --auth "$USER:$PASS" \
  | markitdown -x html

# Login flow that sets cookies, then fetch (use a .http file via `curl-cffi run`)
cat > flow.http <<'EOF'
### login
POST https://app.example.com/login
Content-Type: application/x-www-form-urlencoded

user=alice&pass=secret

### read
GET https://app.example.com/dashboard
EOF
# Caveat: `run -p b` prints every response body. Keep login responses bodyless,
# or fetch the dashboard as a separate single GET after obtaining cookies.
curl-cffi run flow.http -i chrome146 -p b | markitdown -x html > dashboard.md
```

`run` shares the cookie jar across requests by default, so the second `GET` carries the session.

### 6. Non-HTML payload behind a protected origin

PDFs, DOCX, PPTX, etc. — download raw bytes first, then convert (don't pipe binary into `-x html` and don't use stdout redirection for binary bodies):

```bash
URL='https://gated.example.com/whitepaper.pdf'
(cd /tmp && curl-cffi get "$URL" -i chrome146 +session="$SESSION" \
    --download --output paper.pdf)
markitdown /tmp/paper.pdf -o paper.md
```

If the URL doesn't reveal the extension, hint markitdown explicitly: `markitdown blob.bin -x pdf -o paper.md`.

### 7. Charset that isn't UTF-8

Old corp sites still ship `windows-1252` or `iso-8859-1`:

```bash
curl-cffi get https://legacy.example.com -i chrome146 > legacy.html
markitdown legacy.html -x html -c iso-8859-1 > legacy.md
```

Inspect first if unsure: `curl-cffi get URL --headers | grep -i charset`. For direct pipes, `curl-cffi` has already decoded the response and re-emits UTF-8 text, so omit `-c` or treat it as UTF-8.

### 8. Batch a URL list → mirrored directory

```bash
mkdir -p out
while IFS= read -r url; do
    [ -z "$url" ] && continue
    name=$(printf '%s' "$url" | sha1sum | cut -c1-12)
    echo "→ $url  ($name)"
    # NOTE: curl-cffi --output ignores directories. Stdout redirection honors any path; use it.
    curl-cffi get "$url" -i chrome146 > "out/$name.html" \
        && markitdown "out/$name.html" -o "out/$name.md"
done < urls.txt
```

Two-step keeps a recoverable HTML cache and avoids losing work if conversion crashes mid-run. Add `parallel` if you have it and the origin tolerates it.

### 9. Specialty URL converters (skip curl-cffi entirely)

These have dedicated converters that talk to the platform API, not generic HTTP — the impersonation pipe is unnecessary:

```bash
markitdown 'https://www.youtube.com/watch?v=XXXX' -o video.md      # needs [youtube-transcription]
markitdown 'https://en.wikipedia.org/wiki/Markdown' -o wiki.md
markitdown 'https://example.com/feed.rss' -o feed.md
```

## Picking the impersonation target

Default to **the latest stable Chrome** target available in your `curl-cffi` build:

```bash
curl-cffi doctor                                     # confirms versions
uv run --with curl_cffi python -c \
    "from curl_cffi.requests import BrowserType; print(*sorted(t.value for t in BrowserType), sep='\n')"
```

Heuristic:

1. Start with `chrome146` (or the newest `chromeXYZ` listed).
2. If the site is iOS/Safari-flavored or returns mobile HTML, try `safari260_ios` / `chrome131_android`.
3. Match your `User-Agent` header's claimed version to the impersonation target. Mismatches are a common silent fingerprint failure.
4. For Tor exit nodes use `tor145`.

## Detecting that the fetch was actually blocked

The pipe will gleefully convert a Cloudflare challenge page and hand you a "Just a moment…" Markdown file. Always sanity-check.

```bash
# Check status before piping
curl-cffi get "$URL" -i chrome146 --headers | head -3

# Or fail fast in scripts
out=$(curl-cffi get "$URL" -i chrome146 -p hb)
status=$(printf '%s\n' "$out" | head -1)
case "$status" in
  *" 200 "*|*" 200")
    printf '%s' "$out" | sed -n '/^$/,$p' | tail -n +2 | markitdown -x html > out.md
    ;;
  *)
    echo "Blocked or error: $status" >&2
    exit 1
    ;;
esac
```

Cheaper sniff: grep the converted Markdown for known challenge fingerprints:

```bash
grep -qiE 'just a moment|checking your browser|attention required|cloudflare|enable javascript and cookies' out.md \
  && echo "WARN: looks like a challenge/consent page, not the article" >&2
```

If you see those:

1. Re-run with a newer / different `--impersonate` target.
2. Add browser-y headers (`User-Agent`, `Accept-Language`, `Referer`, `Sec-Fetch-*`).
3. Inject a `cf_clearance` cookie obtained via real browser.
4. As last resort, fall back to `agent-browser` (full DOM/JS).

## When to fall back to `agent-browser`

The `curl-cffi → markitdown` pipe only works on **server-rendered** HTML. Bail out and use the `agent-browser` skill when:

- Content only appears after JavaScript runs (SPA, React/Vue, "Loading…" placeholders).
- The site shows a real interactive CAPTCHA (Turnstile/hCaptcha/reCAPTCHA challenge, not just a TLS check).
- You need to click/login through a multi-step flow with anti-CSRF tokens that bind to a browser session.
- The target uses Service Worker / WebSocket streams for content delivery.

A useful hybrid: drive `agent-browser` to solve the challenge and dump the cookie jar, then resume bulk fetching through the cheap `curl-cffi → markitdown` pipe with those cookies.

## Cleanup tips for the resulting Markdown

`markitdown`'s HTML converter is a faithful tag-by-tag translation — it does _not_ run a readability/main-content extractor. Expect navigation, footers, and table-heavy layouts (Hacker News, old wikis) to show up.

Quick post-filters that are usually enough for LLM ingestion:

```bash
# Drop boilerplate lines
markitdown -x html < page.html \
  | sed -E '/^\s*\[(Home|Privacy|Terms|Cookie|Subscribe)\]/Id' \
  | awk 'NF || prev; {prev=NF}'  # collapse blank-line runs

# Take only the largest contiguous text block (good enough for articles)
markitdown -x html < page.html | awk '
  /^#/ {sec=$0; buf=""; next}
  {buf=buf "\n" $0; if (length(buf)>maxlen){maxlen=length(buf); best=sec "\n" buf}}
  END {print best}'
```

For higher quality, pre-process the HTML through `readability-cli` (`npm i -g @mozilla/readability` wrappers) or `trafilatura` before piping into `markitdown`:

```bash
curl-cffi get "$URL" -i chrome146 \
  | uv run --with trafilatura python -c 'import sys,trafilatura; print(trafilatura.extract(sys.stdin.read(), output_format="html") or "")' \
  | markitdown -x html > clean.md
```

## Diagnostics checklist

### `curl-cffi --output` gotcha (read this once)

`curl-cffi --output PATH` ignores the directory portion of `PATH` and writes the basename in the current working directory; it also requires `--download` to do anything at all. So `--download --output /tmp/page.html` from `~` writes `~/page.html`, not `/tmp/page.html`. Two safe patterns used throughout this skill:

```bash
# A. Textual bodies only: stdout redirection — any path, any depth, no flags. Preferred for HTML/JSON.
curl-cffi get "$URL" -i chrome146 > /tmp/page.html

# B. Binary bodies or exact raw bytes: cd into the target dir first, then --download --output basename.
(cd /tmp && curl-cffi get "$URL" -i chrome146 --download --output page.html)
```

The `--download` mode also redirects response headers to stdout and the progress bar to stderr, which surprises pipelines. See the `curl-cffi` skill's "Output control" section for the full footgun list.

When the pipe disappoints:

1. `curl-cffi doctor` — versions sane?
2. `curl-cffi get URL -i chrome146 --headers` — what status / `server` / `cf-ray` headers?
3. Save the raw body (`--download --output debug.html`) and `wc -l debug.html`. A few hundred bytes of `<title>Just a moment…</title>` is the giveaway.
4. Verify charset (`Content-Type: ...; charset=...`). For true source-byte charset handling, save raw/text to a file first and run `markitdown FILE -c <charset>`; direct pipes from `curl-cffi` are already decoded/re-encoded as UTF-8 text.
5. Check `curl-cffi --version` aligns with available impersonation targets.
6. Try an older / newer Chrome target; try `--http1.1` if HTTP/2 is being awkward.
7. Still 403? Add cookies, then fall back to `agent-browser`.

## See also

- `curl-cffi` skill — full request-item syntax, impersonation matrix, `.http`/`.har` replay, proxies.
- `markitdown` skill — all supported input formats, install extras, plugin / Azure DocIntel paths, Python API.
- `agent-browser` skill — when JS execution is unavoidable.
