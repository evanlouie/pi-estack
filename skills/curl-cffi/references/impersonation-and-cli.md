# Impersonation and curl-cffi CLI Reference

Use this file for browser impersonation, fingerprint updates, custom TLS/HTTP
fingerprints, and one-off CLI diagnostics.

## Choosing an impersonation target

Use generic targets by default so `curl_cffi` can track the latest bundled
target:

```python
requests.get(url, impersonate="chrome")
requests.get(url, impersonate="safari")
requests.get(url, impersonate="safari_ios")
```

Pin a specific target only when reproducibility matters:

```python
requests.get(url, impersonate="chrome124")
```

Do not invent target names. The current open-source CLI does not provide an
alias-listing subcommand. For `curl_cffi` 0.15, inspect aliases and exact enum
targets from the installed package with:

```bash
python -c "from curl_cffi.requests.impersonate import BrowserType, REAL_TARGET_MAP; print('aliases:', ', '.join(sorted(REAL_TARGET_MAP))); print('targets:', ', '.join(t.value for t in BrowserType))"
```

`REAL_TARGET_MAP` is a current package symbol rather than a stable CLI surface.
If this import fails in a future release, check the installed package version
and use its documented impersonation target list instead of guessing.

## Default browser headers

When `impersonate=...` is set, `curl_cffi` also sets corresponding browser
headers by default. This helps match browser behavior, but can surprise code
that tries to manage every header manually.

Use one of these approaches:

```python
# Override selected headers.
r = requests.get(url, impersonate="chrome", headers={"Accept-Language": "en-US,en;q=0.9"})

# Disable browser default headers entirely.
r = requests.get(url, impersonate="chrome", default_headers=False, headers={"User-Agent": "..."})
```

If exact header content or order matters, do not rely on non-existent
fingerprint-object helpers such as `curl_cffi.get_fingerprint`. In current
open-source releases, disable browser default headers and pass the headers you
want explicitly:

```python
headers = {
    "User-Agent": "...",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
r = requests.get(url, impersonate="chrome", default_headers=False, headers=headers)
```

## Custom fingerprints

For non-browser clients or when reproducing a captured client, pass
JA3/Akamai/extra fingerprint data explicitly:

```python
requests.get(
    url,
    ja3="771,4865-4866-4867,...",
    akamai="4:16777216|...",
    extra_fp={"tls_signature_algorithms": [...]},
)
```

Use this only when the user provides known-good values or the task is an
authorized reproduction/debugging exercise. Do not fabricate exact fingerprints.

## Fingerprint updates

The open-source package receives new fingerprints in package releases. To get
newer bundled targets, upgrade `curl_cffi` and then re-check the installed
aliases/targets. Do not suggest package-local fingerprint update/list commands
or a `curl_cffi.fingerprints.FingerprintManager` API for current open-source
releases; those interfaces are not available in `curl_cffi` 0.15.

## Limits of impersonation

Browser TLS/HTTP impersonation is not a full browser. It does not execute
JavaScript, render pages, solve CAPTCHAs, emulate DOM/browser APIs, or guarantee
access through bot protections. If a target requires JavaScript-rendered content
and the user is authorized to access it, use a browser automation tool instead
of trying to force `curl_cffi` to do browser work.

## CLI setup

The CLI is installed with `curl_cffi`; optional extras improve syntax
highlighting and progress bars:

```bash
pip install curl_cffi
pip install 'curl_cffi[cli]'
```

If the shell command is unavailable, try:

```bash
python -m curl_cffi get https://example.com
uvx --from 'curl_cffi[cli]>=0.15,<0.16' curl-cffi get https://example.com
```

## CLI request syntax

General form:

```bash
curl-cffi METHOD URL [REQUEST_ITEMS...] [FLAGS]
```

Methods include `get`, `post`, `put`, `delete`, `patch`, `head`, `options`,
`trace`, and `query`.

Examples:

```bash
# GET; Chrome impersonation is the usual default.
curl-cffi get https://httpbin.org/get

# Custom header.
curl-cffi get https://httpbin.org/get X-My-Header:value

# POST JSON. The := operator interprets values as JSON/non-string data.
curl-cffi post https://httpbin.org/post name=Alice age:=30 active:=true

# POST form fields.
curl-cffi post --form https://httpbin.org/post name=Alice

# Different browser target.
curl-cffi get --impersonate safari https://tls.browserleaks.com/json

# HTTP/3 diagnostic.
curl-cffi get --http3 https://example.com

# Localhost shortcut.
curl-cffi get :8000/api/health
```

Request item separators:

| Syntax         | Meaning                | Example                         |
| -------------- | ---------------------- | ------------------------------- |
| `Header:Value` | HTTP header            | `Content-Type:application/json` |
| `Header:`      | Remove header          | `Accept:`                       |
| `param==value` | Query parameter        | `page==2`                       |
| `field=value`  | JSON/form string field | `name=Alice`                    |
| `field:=json`  | JSON interpreted field | `age:=30`                       |
| `@filepath`    | File upload            | `@photo.jpg`                    |
| `+key=value`   | Cookie                 | `+session=abc123`               |

If CLI file upload raises a `files is not supported` error in the installed
version, switch to Python code with `CurlMime` and `multipart=`.

## CLI output control

Use body-only output for parsing and headers/verbose output for diagnostics:

```bash
curl-cffi get --body https://example.com
curl-cffi get --headers https://example.com
curl-cffi get --verbose https://example.com
curl-cffi get --print Hh https://example.com   # request headers + response headers
```

Useful flags:

| Flag                       | Purpose                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `--body`, `-b`             | Print response body only                                                                            |
| `--headers`                | Print response headers only                                                                         |
| `--verbose`, `-v`          | Print full request and response details                                                             |
| `--print`, `-p`            | Fine-grained output: `H` request headers, `B` request body, `h` response headers, `b` response body |
| `--impersonate`, `-i`      | Browser target                                                                                      |
| `--json`, `-j`             | Serialize data as JSON                                                                              |
| `--form`, `-f`             | Serialize data as form fields                                                                       |
| `--auth`, `-a`             | HTTP basic auth                                                                                     |
| `--verify` / `--no-verify` | Enable/disable TLS verification                                                                     |
| `--proxy`                  | Proxy URL                                                                                           |
| `--timeout`                | Timeout seconds                                                                                     |
| `--follow` / `--no-follow` | Follow redirects                                                                                    |
| `--download`, `-d`         | Download response body                                                                              |
| `--output`, `-o`           | Output file path                                                                                    |
| `--http3`                  | Use HTTP/3                                                                                          |

## Batch execution

Use the `run` subcommand for `.http`, `.rest`, or `.har` files:

```bash
curl-cffi run requests.http
curl-cffi run session.har
curl-cffi run --no-session requests.http
```

Use `--no-session` when requests must not share cookies or connections.

## Diagnostics

Run:

```bash
curl-cffi doctor
```

Include its output when debugging install, platform, libcurl, or version
problems.
