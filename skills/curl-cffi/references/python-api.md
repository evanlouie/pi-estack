# curl_cffi Python API Reference

Use this file when writing or reviewing `curl_cffi` Python code.

## Imports

Prefer explicit imports that make it clear this is not the third-party `requests` package:

```python
from curl_cffi import requests
from curl_cffi import AsyncSession, CurlError, CurlFollow, CurlHttpVersion, CurlMime
```

If the project also imports `requests`, alias one of them:

```python
from curl_cffi import requests as crequests
```

## Requests-like API

`requests.get`, `post`, `put`, `delete`, `patch`, `head`, `options`, `trace`, and `query` are aliases over `request(method, url, **kwargs)`.

Common kwargs:

```python
requests.get(
    url,
    params={"page": 1},
    headers={"X-Trace": "agent"},
    cookies={"session": "abc"},
    timeout=15,
    impersonate="chrome",
    proxy="http://user:pass@127.0.0.1:8080",
    http_version="v2",
)
```

Response patterns:

```python
r.status_code
r.headers["content-type"]
r.content        # bytes
r.text           # decoded text
r.json()         # parsed JSON
r.raise_for_status()
```

## Sessions

Use `Session` whenever more than one request may share cookies, headers, connection reuse, impersonation, retry settings, or redirects.

```python
from curl_cffi import requests

with requests.Session(impersonate="chrome", timeout=15) as s:
    s.headers.update({"X-App": "example"})
    login = s.post("https://example.com/login", data={"u": "alice", "p": "secret"})
    login.raise_for_status()
    profile = s.get("https://example.com/me")
    profile.raise_for_status()
```

`Session` is thread-safe, but use a separate session per thread for simpler lifecycle and isolation. Session-level parameters are overridden by request-level parameters.

## Retries

Use the native retry support for transient failures:

```python
from curl_cffi import RetryStrategy, requests

strategy = RetryStrategy(count=3, delay=0.2, jitter=0.1, backoff="exponential")
with requests.Session(retry=strategy, timeout=15) as s:
    r = s.get("https://example.com")
    r.raise_for_status()
```

## AsyncSession

Use `AsyncSession` for concurrent HTTP requests. Prefer `async with` and tune `max_clients` to the expected concurrency and target limits.

```python
import asyncio
from curl_cffi import AsyncSession

async def fetch(url: str, s: AsyncSession) -> bytes:
    r = await s.get(url)
    r.raise_for_status()
    return r.content

async def main(urls: list[str]) -> list[bytes]:
    async with AsyncSession(impersonate="chrome", timeout=15, max_clients=10) as s:
        return await asyncio.gather(*(fetch(url, s) for url in urls))
```

## WebSockets

For async applications, prefer `AsyncSession.ws_connect`.

```python
import asyncio
from curl_cffi import AsyncSession
from curl_cffi import WebSocketError, WebSocketTimeout

async def main() -> None:
    async with AsyncSession(impersonate="chrome") as session:
        async with session.ws_connect("wss://example.com/socket", timeout=10) as ws:
            await ws.send_json({"op": "subscribe", "channel": "updates"})
            try:
                msg = await ws.recv_json(timeout=5.0)
            except WebSocketTimeout:
                msg = None
            except WebSocketError as exc:
                raise RuntimeError(f"WebSocket transport failed: {exc}") from exc
```

Async iteration yields raw `bytes`; decode or parse them explicitly.

## POST data

Use `data=` for form fields or bytes, `json=` for JSON, and `multipart=` with `CurlMime` for uploads.

```python
requests.post(url, data={"name": "Alice"})          # form-encoded
requests.post(url, data=b"raw bytes")               # raw body
requests.post(url, json={"name": "Alice"})          # JSON body
```

`files=` is not supported. Use `CurlMime`:

```python
from curl_cffi import CurlMime, requests

mp = CurlMime()
mp.addpart(name="file", local_path="./image.png", filename="image.png", content_type="image/png")
try:
    r = requests.post(url, multipart=mp, timeout=30)
finally:
    mp.close()
```

## Streaming

`stream=True` supports iterative-style streaming, but the response begins streaming immediately. Consume immediately:

```python
with requests.Session() as s:
    with s.stream("GET", url) as r:
        for chunk in r.iter_content():
            process(chunk)
```

Prefer `content_callback` for large downloads or when writing to disk:

```python
def write_chunk(chunk: bytes) -> None:
    output.write(chunk)

r = requests.get(url, content_callback=write_chunk, timeout=60)
```

## Proxies

Prefer a single `proxy=` when the same proxy handles all schemes:

```python
requests.get(url, proxy="http://user:pass@proxy.example:3128")
```

Use `proxies=` only when HTTP and HTTPS should route differently:

```python
requests.get(url, proxies={"http": "http://localhost:3128", "https": "http://localhost:3128"})
```

Environment variables `http_proxy`, `https_proxy`, `ws_proxy`, and `wss_proxy` can also apply when `trust_env=True`.

## HTTP versions

Common values:

```python
requests.get(url, http_version="v1")
requests.get(url, http_version="v2")
requests.get(url, http_version="v3")
requests.get(url, http_version="v3only")
```

For constants:

```python
from curl_cffi import CurlHttpVersion, requests

r = requests.get(url, http_version=CurlHttpVersion.V1_1)
```

Use HTTP/3 only when the target and network path support it. Keep a fallback path to HTTP/2 or HTTP/1.1.

## Low-level curl options

When a libcurl option is not exposed directly, prefer `curl_options=`:

```python
from curl_cffi import CurlOpt, requests

r = requests.get(
    url,
    curl_options={CurlOpt.CONNECTTIMEOUT: 10},
)
```

Use low-level `Curl` only for tasks that cannot be represented by the requests-like API:

```python
from io import BytesIO
from curl_cffi import Curl, CurlOpt

buf = BytesIO()
c = Curl()
try:
    c.setopt(CurlOpt.URL, b"https://example.com")
    c.setopt(CurlOpt.WRITEDATA, buf)
    c.impersonate("chrome")
    c.perform()
finally:
    c.close()
```

## Self-contained scripts

When creating a standalone Python script for the user, include PEP 723 metadata and pin the major/minor range:

```python
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "curl_cffi>=0.15,<0.16",
# ]
# ///
```

Run with:

```bash
uv run scripts/example.py
```
