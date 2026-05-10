# Security and Troubleshooting Reference

Use this file when the task involves user-supplied URLs, redirects, cookies, proxies, TLS errors, HTTP/2 issues, packaging, or production hardening.

## SSRF-safe redirects

Default behavior follows redirects. In server-side code that fetches a URL supplied by a user or external system, use `CurlFollow.SAFE` or the string `"safe"` so redirects to internal/private IP ranges are rejected.

```python
from curl_cffi import CurlFollow, requests

r = requests.get(user_supplied_url, allow_redirects=CurlFollow.SAFE, timeout=10)
```

Session-level:

```python
with requests.Session(allow_redirects=CurlFollow.SAFE, timeout=10) as s:
    r = s.get(user_supplied_url)
```

Also validate scheme and host before the request when building a production URL-fetching service.

## TLS verification

Keep `verify=True` by default. Use `verify=False` only for explicit local debugging cases such as Fiddler/Charles interception, local development certificates, or a user-approved test environment. Do not disable verification as a generic fix.

For certificate path errors, inspect the environment, certifi installation, corporate MITM requirements, and platform-specific certificate bundle configuration before disabling verification.

## Proxies

Prefer:

```python
requests.get(url, proxy="http://user:pass@proxy.example:3128")
```

A common mistake is using `https://` as the proxy scheme for an HTTPS target. Many HTTPS requests still use an `http://` proxy URL because the client establishes a CONNECT tunnel through the HTTP proxy.

If a request fails only behind a proxy:

1. Re-run without the proxy against an allowed target.
2. Confirm the proxy supports the requested protocol, especially HTTP/2, HTTP/3, WebSockets, or UDP SOCKS.
3. Confirm credentials and proxy authentication separately.
4. Try `http_version="v1"` if the proxy or upstream has broken HTTP/2 behavior.

## HTTP/2 `PROTOCOL_ERROR`

When seeing an error similar to `HTTP/2 stream 0 was not closed cleanly: PROTOCOL_ERROR`:

1. Remove any manually-set `Content-Length` header and let the client calculate it.
2. Test in a real browser and with `curl-cffi` without a proxy.
3. Try a better proxy or different egress IP if proxy-specific.
4. Force HTTP/1.1:

```python
from curl_cffi import CurlHttpVersion, requests

r = requests.get(url, http_version=CurlHttpVersion.V1_1, timeout=15)
# or
r = requests.get(url, http_version="v1", timeout=15)
```

## Cookies

Do not use a plain dictionary dump/load for durable cookies when cookie metadata matters. Use the session cookie jar or a cookie-jar-aware persistence strategy, and never load pickled cookies from an untrusted source.

```python
from http.cookiejar import MozillaCookieJar
from curl_cffi import requests

jar = MozillaCookieJar("cookies.txt")
try:
    jar.load(ignore_discard=True, ignore_expires=True)
except FileNotFoundError:
    pass

with requests.Session(cookies=jar) as s:
    s.get("https://example.com")
    jar.save(ignore_discard=True, ignore_expires=True)
```

For redirect flows, prefer `session.cookies` over `response.cookies`; response cookies may only represent the current response.

To reuse connections but discard cookies:

```python
s = requests.Session(discard_cookies=True)
```

## Redirects and history

`allow_redirects=True` follows redirects; `allow_redirects=False` disables them. Do not rely on `response.history` as a `requests`-compatible redirect history; track redirects explicitly if the application needs them.

## Header control

When impersonation is enabled, browser headers are added. If exact header order or custom browser headers are required:

1. Use `default_headers=False` and pass your own headers explicitly.
2. Use `ja3`, `akamai`, and `extra_fp` only when the user provides known-good fingerprint values for an authorized reproduction/debugging task.
3. Do not mix contradictory headers such as a Chrome TLS fingerprint with a Firefox user agent unless the user is intentionally testing a mismatch.

## Authentication

Built-in `auth=(user, password)` supports HTTP basic authentication. Digest auth is not supported by the high-level API; use low-level curl options only if the user specifically needs it.

## Encoding issues

`response.text` uses the explicit `response.encoding` when set, then response content-type, then `default_encoding`, then UTF-8. Override when needed:

```python
r = requests.get(url, default_encoding="latin-1")
r.encoding = "latin-1"
```

## PyInstaller packaging

When packaging with PyInstaller, include `_cffi_backend` and collect `curl_cffi` data/libs:

```bash
pyinstaller -F app.py --hidden-import=_cffi_backend --collect-all curl_cffi
```

If packaged binaries fail only on a target host, compare platform, Python, cert bundle, and bundled dynamic libraries with `curl-cffi doctor` or a small import/version smoke test.

## Production hardening checklist

- [ ] Use `timeout=` everywhere.
- [ ] Use `CurlFollow.SAFE` for user-supplied URLs.
- [ ] Keep TLS verification enabled by default.
- [ ] Avoid logging secrets, cookies, authorization headers, or proxy credentials.
- [ ] Rate-limit and back off; do not overwhelm targets.
- [ ] Reuse sessions where appropriate, but isolate sessions across tenants/users.
- [ ] Handle `curl_cffi.requests.exceptions.RequestException`/`HTTPError`/`Timeout` for high-level requests, `CurlError` for low-level `Curl`, WebSocket errors, and JSON decoding failures.
- [ ] Include a fallback HTTP version when HTTP/3 or HTTP/2 support varies by target/proxy.
