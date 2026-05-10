---
name: curl-cffi
description: Use this skill when writing, reviewing, or debugging Python code that uses curl_cffi/curl-cffi for HTTP clients, browser TLS/JA3/HTTP2/HTTP3 impersonation, requests-compatible sessions, asyncio, WebSockets, proxies, cookies, retries, multipart uploads, SSRF-safe redirects, or the curl-cffi CLI. Use for authorized scraping/API access and network diagnostics; do not use it to bypass access controls or violate site terms.
license: MIT
compatibility: Requires Python 3.10+ for curl_cffi. Network access is required only when making HTTP requests. uv is recommended when creating standalone scripts.
metadata:
  version: "1.0.0"
  source_project: "lexiforest/curl_cffi"
---

# curl_cffi Skill

Use this skill for tasks involving the `curl_cffi` Python package or the `curl-cffi` command-line tool.

## Operating boundaries

Use `curl_cffi` for authorized HTTP/API clients, diagnostics, compatibility testing, and browser-like TLS/HTTP fingerprinting where the user has a legitimate reason to access the target. Do not help use it for credential attacks, spam, unauthorized scraping, evading bans, bypassing paywalls, or defeating access controls. When a request target is user-supplied in server-side code, treat it as SSRF-sensitive.

## Default workflow

1. Classify the task:
   - **Application code**: use the requests-like API from `curl_cffi import requests`.
   - **Repeated requests/cookies/connection reuse**: use `requests.Session`.
   - **Concurrency**: use `AsyncSession`.
   - **WebSockets**: use `AsyncSession.ws_connect` for async code; use sync WebSocket APIs only when the project is already synchronous.
   - **One-off diagnostics or reproductions**: use the `curl-cffi` CLI.
   - **Unsupported libcurl knobs**: use `curl_options` first; use low-level `Curl` only when the requests-like API cannot express the operation.
2. Check environment assumptions:
   - Require Python 3.10+.
   - If the package is missing, suggest `pip install curl_cffi --upgrade` or `pip install 'curl_cffi[cli]'` when CLI syntax highlighting/progress bars are useful.
   - Prefer adding a dependency to the project’s package manager instead of ad hoc installs when editing an existing repository.
3. Choose safe defaults:
   - Use `timeout=` on network calls.
   - Use `with requests.Session(...) as s:` or `async with AsyncSession(...) as s:`.
   - For server-side user-supplied URLs, set `allow_redirects=CurlFollow.SAFE` or `allow_redirects="safe"`.
   - Keep TLS verification enabled unless the user is explicitly debugging a local MITM proxy or test certificate.
4. Validate the result:
   - Run unit tests or a small smoke request against a user-approved target.
   - For code generation, include error handling around `HTTPError`, `CurlError`, and timeout/network failures.
   - For CLI diagnostics, capture headers/status and show the exact command used.

## Core code patterns

### Basic request

```python
from curl_cffi import requests

r = requests.get(
    "https://example.com/api",
    impersonate="chrome",
    timeout=15,
)
r.raise_for_status()
data = r.json()
```

### Session with browser impersonation and SSRF-safe redirects

```python
from curl_cffi import CurlFollow, requests

with requests.Session(
    impersonate="chrome",
    timeout=15,
    allow_redirects=CurlFollow.SAFE,
) as s:
    r = s.get("https://example.com")
    r.raise_for_status()
    print(r.text)
```

### Async concurrency

```python
import asyncio
from curl_cffi import AsyncSession

async def fetch_all(urls: list[str]) -> list[str]:
    async with AsyncSession(impersonate="chrome", timeout=15, max_clients=20) as s:
        responses = await asyncio.gather(*(s.get(url) for url in urls))
        for r in responses:
            r.raise_for_status()
        return [r.text for r in responses]
```

### Multipart upload

Do not use the `requests` package’s `files=` pattern. Use `CurlMime`:

```python
from curl_cffi import CurlMime, requests

mp = CurlMime()
mp.addpart(
    name="attachment",
    filename="report.csv",
    content_type="text/csv",
    local_path="./report.csv",
)
try:
    r = requests.post("https://example.com/upload", multipart=mp, timeout=30)
    r.raise_for_status()
finally:
    mp.close()
```

### Streaming without buffering too much

Prefer `content_callback` when downloading large or indefinite streams:

```python
from pathlib import Path
from curl_cffi import requests

out = Path("download.bin")
with out.open("wb") as f:
    def write_chunk(chunk: bytes) -> None:
        f.write(chunk)

    r = requests.get("https://example.com/large.bin", content_callback=write_chunk, timeout=60)
    r.raise_for_status()
```

### CLI diagnostics

```bash
curl-cffi get https://example.com --impersonate chrome --headers
curl-cffi get https://example.com --body --timeout 15
curl-cffi post https://httpbin.org/post name=Alice age:=30
curl-cffi doctor
```

## Reference lookup

Read these files when the task needs more detail:

- `references/python-api.md` — requests-like API, sessions, async, WebSockets, multipart, streaming, proxies, HTTP versions, retries, and low-level curl options.
- `references/impersonation-and-cli.md` — impersonation target selection, default browser headers, custom fingerprints, fingerprint updates, and CLI request syntax.
- `references/security-and-troubleshooting.md` — SSRF-safe redirects, TLS verification, cookies, proxy gotchas, common protocol errors, and packaging notes.

## Gotchas

- `impersonate="chrome"` adds browser-like default headers. Override individual headers with `headers=...`, disable them with `default_headers=False`, or edit a loaded fingerprint when exact header control/order matters.
- `files=` is not supported in the requests-like API; use `CurlMime` and `multipart=`.
- For multiple requests, prefer `Session` so cookies and connections are reused. `response.cookies` only covers the current response; use `session.cookies` for accumulated cookies.
- `stream=True` is compatible with iterative APIs, but the response begins streaming immediately; consume it immediately or use `content_callback` to avoid memory growth.
- Use `proxy="http://user:pass@host:port"` for a single proxy. For HTTPS destinations, the proxy URL often still starts with `http://`; do not assume it should be `https://`.
- If HTTP/2 fails with `PROTOCOL_ERROR`, try removing a manual `Content-Length`, testing without proxies, and forcing HTTP/1.1 with `http_version="v1"` or `CurlHttpVersion.V1_1`.
- `curl_cffi` can mimic TLS/HTTP fingerprints, but it does not run JavaScript, solve CAPTCHAs, change browser DOM fingerprints, or guarantee access through anti-bot systems.
