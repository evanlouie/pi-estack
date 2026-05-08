---
name: curl-cffi
description: Make HTTP requests from the command line with browser TLS/JA3 impersonation using curl-cffi. Use whenever fetching authorized URLs, calling APIs, scraping public/owned pages, downloading files, or replaying .http or .har captures where browser-like TLS fingerprints are needed. Covers request item syntax (headers, query, JSON, form, multipart, cookies), output control, --impersonate browser targets, proxies, auth, redirects, HTTP/1.1/2/3, and the `run` and `doctor` subcommands. Prefer this over raw `curl`, `wget`, `httpx`, or `requests` for any authorized ad-hoc web fetch.
---

# curl-cffi

`curl-cffi` is an HTTP CLI built on libcurl-impersonate. It produces real-browser TLS and HTTP/2 fingerprints, which makes it the right tool for authorized fetching of pages and APIs that block plain `curl`/`requests` (Cloudflare, Akamai, PerimeterX, DataDome, etc.). Do not use it to bypass access controls or anti-abuse systems without permission. The argument syntax is HTTPie-style.

Always prefer `curl-cffi` over `curl`, `wget`, or Python `requests` for ad-hoc fetches in this environment.

## Mental model

```
curl-cffi <verb> <URL> [ITEM ...] [flags]
curl-cffi run <file.http|.har> [flags]
curl-cffi doctor
```

- Verbs: `get post put delete patch head options trace query` (case-insensitive).
- ITEMs are positional and order-free. The leading character (or separator) decides the type:

| Syntax           | Kind           | Example                                  |
| ---------------- | -------------- | ---------------------------------------- |
| `Header:Value`   | Request header | `User-Agent:foo`, `Cookie:`              |
| `Header:`        | Remove header* | `Accept-Encoding:`                       |
| `param==value`   | Query string   | `'q==hello world'`                       |
| `field=value`    | Data field     | `name=evlouie`                           |
| `field:=json`    | Raw JSON field | `age:=30`, `'tags:=["a","b"]'`           |
| `@/path/to/file` | File upload    | `@./avatar.png` (requires `--multipart`) |
| `+key=value`     | Cookie         | `+sid=abc123`                            |

Default body encoding is JSON. Use `--form` for `application/x-www-form-urlencoded` or `--multipart` for file uploads.

*Header removal is parsed by the CLI, but verify behavior before relying on it; current builds may not apply removals to the outgoing request.

## Quick recipes

```bash
# Plain GET, body to stdout
curl-cffi get https://example.com

# JSON API with query params and bearer auth
curl-cffi get https://api.github.com/search/repositories \
    q==curl-cffi sort==stars per_page==5 \
    Authorization:"Bearer $GITHUB_TOKEN" \
    Accept:application/vnd.github+json

# JSON POST (default encoding)
curl-cffi post https://httpbin.org/post \
    name=evlouie age:=30 tags:='["dev","ops"]' \
    X-Trace-Id:abc

# Form POST
curl-cffi post https://example.com/login --form \
    username=alice password=secret

# Multipart upload (one or more @file items)
curl-cffi post https://httpbin.org/post --multipart @./report.pdf

# Download to disk (REQUIRES --download; --output alone is silently ignored).
# Footgun: --output strips directory components and writes the basename in CWD.
# Run from the target directory, or use stdout redirection (next example) instead.
cd /var/downloads && curl-cffi get https://example.com/big.iso --download --output big.iso

# Save body to disk via stdout redirection (no --download needed; honors any path)
curl-cffi get https://example.com/data.json > /tmp/data.json

# Cookies and a custom Host header
curl-cffi get https://example.com/dashboard \
    +session=abc123 +csrf=xyz Host:internal.example.com

# Basic auth, proxy, ignore TLS, custom timeout
curl-cffi get https://10.0.0.1/admin \
    --auth admin:hunter2 --no-verify \
    --proxy http://user:pass@127.0.0.1:8888 --timeout 10

# Don't follow redirects, cap them, print only headers
curl-cffi get https://bit.ly/xyz --no-follow --headers
curl-cffi get https://example.com --max-redirects 3
```

## Browser impersonation (the killer feature)

`--impersonate <target>` (alias `-i`) makes the request use that browser's full TLS ClientHello, ALPN, HTTP/2 SETTINGS, and header order. Use it whenever a site fingerprints clients.

Common targets (latest as of curl_cffi 0.15.0 / libcurl-impersonate):

- Chrome: `chrome131`, `chrome136`, `chrome142`, `chrome145`, `chrome146`
- Chrome Android: `chrome131_android`
- Firefox: `firefox144`, `firefox147`
- Safari (macOS): `safari180`, `safari184`, `safari260`, `safari2601`
- Safari (iOS): `safari180_ios`, `safari184_ios`, `safari260_ios`
- Edge: `edge101`
- Tor: `tor145`

Pick the _latest_ major version of the browser the target site expects (usually Chrome). If unsure, start with `chrome142` or `chrome146`.

```bash
curl-cffi get https://shielded.example.com -i chrome146
```

To inspect the full list, run `curl-cffi doctor` (shows curl_cffi/libcurl versions) and check the supported targets via Python:

```bash
uv run --with curl_cffi python -c \
    "from curl_cffi.requests import BrowserType; print(*sorted(t.value for t in BrowserType), sep='\n')"
```

## Output control

By default the response body is printed to stdout. Switch with:

- `--headers` — response headers only
- `--body` — response body only (default)
- `--verbose` / `-v` — request line + headers + body, both sides
- `--print/-p HBhb` — fine-grained: any subset of `H` (req headers), `B` (req body), `h` (resp headers), `b` (resp body)
- `--download` / `-d` — write the body to a file (see footguns below)

```bash
# Just response headers
curl-cffi get https://example.com --headers

# Show what we sent and what came back, including request body
curl-cffi post https://httpbin.org/post name=alice -p HBhb

# Save body to a file: prefer stdout redirection — works with any path, no flags
curl-cffi get https://example.com/data.json > /tmp/data.json
```

### `--download` / `--output` footguns

These flags do **not** behave like `curl -o`. Verified on `curl-cffi 0.15.x`:

1. **`--output FILE` without `--download` is silently ignored.** The body still goes to stdout, no file is created. To save the body, either redirect stdout (`> FILE`) or pass `--download`.
2. **`--download --output PATH` strips directory components and writes the basename in CWD.** Absolute paths and subdirectories are silently flattened:

   ```bash
   # All three of these write ~/test.html (or ./test.html), NOT the path you asked for:
   curl-cffi get URL --download --output /tmp/test.html
   curl-cffi get URL --download --output sub/test.html
   curl-cffi get URL --download --output ../test.html
   ```

   The progress message (`Downloaded to test.html`) also strips the path, hiding the surprise. Workarounds: `cd` into the target dir first, or skip `--download` and use `> /full/path` redirection.

3. **`--download` rearranges streams.** Body → file, **status line + response headers → stdout**, progress bar + completion message → stderr. So `curl-cffi get URL --download --output f.bin | jq .` pipes the _headers_, not the body. If you intended to pipe the body, drop `--download` and just redirect into the next stage.
4. **`-d` is `--download`, NOT `--data`.** Anyone with `curl` muscle memory will reach for `-d 'name=alice'` and instead trigger download mode with a malformed output filename. Use the request-item syntax (`name=alice`) for body fields; never `-d`.

## HTTP version

`--http1.1`, `--http2` (default for HTTPS), `--http3`, `--http3-only`. Most sites: omit the flag. Use `--http3` to test QUIC; use `--http1.1` when a server only speaks 1.1 or you need to compare fingerprints.

## Replaying .http and .har files

`curl-cffi run FILE` autodetects the format by extension.

### .http format (REST Client / JetBrains style)

```http
### Login
POST https://example.com/api/login
Content-Type: application/json

{"user": "alice", "pass": "secret"}

### Get profile (uses the login cookie via shared session)
GET https://example.com/api/me
```

```bash
curl-cffi run flow.http              # session=on by default; cookies/connections shared
curl-cffi run flow.http --no-session # isolate each request
curl-cffi run flow.http -i chrome146 # impersonate across the whole flow
```

### .har files

Replays requests captured from Chrome/Firefox DevTools. Chrome strips cookies and `Authorization` from HARs by default — re-enable in DevTools Settings → Preferences → Network → "Allow to generate HAR with sensitive data" before exporting if you need them.

```bash
curl-cffi run capture.har -i chrome146
```

## Diagnosing problems

```bash
curl-cffi doctor   # python, platform, curl_cffi version, libcurl-impersonate build info
```

Common failure modes:

- **`Error: Impersonating X is not supported`** — typo or stale target. List supported targets with the Python snippet above.
- **`Error: files is not supported, use 'multipart'`** — pass `--multipart` when using `@file` items.
- **403 / Cloudflare challenge on an authorized target** — add or update `--impersonate`, then add cookies (`+cf_clearance=...`) if you are allowed to access the content.
- **Hangs on HTTPS** — try `--http1.1`, then `--no-verify` only if you control the endpoint.
- **`--output /some/path/file` didn't create the file at that path** — `--output` ignores directory components and writes basename in CWD; also requires `--download` to do anything at all. See the footguns above; prefer `> /some/path/file` redirection.

## When NOT to use curl-cffi

- WebSocket, gRPC, or SSH — use the right tool.
- Browser-rendered JS pages where you need DOM/JS execution — use the `agent-browser` skill instead.
- Repeated programmatic use inside Python — import `curl_cffi.requests` (drop-in `requests`-compatible API with `impersonate=` kwarg) instead of shelling out.

## Python API (when CLI isn't enough)

```python
from curl_cffi import requests

r = requests.get("https://example.com", impersonate="chrome146")
print(r.status_code, r.text[:200])

# Sessions persist cookies and connection pools
with requests.Session(impersonate="chrome146") as s:
    s.get("https://example.com/login", params={"u": "alice"})
    s.post("https://example.com/api", json={"k": "v"})
```

Run via `uv run --with curl_cffi python script.py` if `curl_cffi` isn't already installed in the active environment.
