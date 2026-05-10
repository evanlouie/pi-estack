# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "curl_cffi>=0.15,<0.16",
#   "markitdown[all]>=0.1.5,<0.2",
# ]
# ///
"""Fetch URLs with curl_cffi and convert responses to Markdown with MarkItDown.

This script is designed for agent use: non-interactive flags, JSONL metadata,
helpful errors, private-address safety checks, bounded output, and optional file
outputs for large Markdown results.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import ipaddress
import json
import mimetypes
import os
import re
import socket
import sys
import time
from dataclasses import dataclass, field
from email.message import Message
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

try:
    from curl_cffi import AsyncSession
except Exception as exc:  # pragma: no cover - dependency bootstrap error
    raise SystemExit(
        "Missing dependency curl_cffi. Run with: uv run scripts/fetch_markdown.py ..."
    ) from exc

try:
    from markitdown import MarkItDown, StreamInfo
except Exception as exc:  # pragma: no cover - dependency bootstrap error
    raise SystemExit(
        "Missing dependency markitdown. Run with: uv run scripts/fetch_markdown.py ..."
    ) from exc

DEFAULT_ACCEPT = "text/markdown, text/html;q=0.9, application/pdf;q=0.8, text/plain;q=0.8, */*;q=0.2"
TEXT_MIMETYPES = {
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
    "application/javascript",
    "application/x-javascript",
}
PRIVATE_ERROR = (
    "URL resolves to a private, loopback, link-local, reserved, multicast, or "
    "unspecified address. Re-run with --allow-private only for trusted local or "
    "intranet targets."
)


@dataclass
class Payload:
    record: dict[str, Any]
    body: bytes = b""
    markdown: str = ""
    headers: dict[str, str] = field(default_factory=dict)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch public HTTP(S) URLs with curl_cffi and convert responses to Markdown with MarkItDown.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run scripts/fetch_markdown.py https://example.com --format markdown
  uv run scripts/fetch_markdown.py --output-dir fetched https://example.com/report.pdf
  printf '%s\n' https://example.com https://example.org | uv run scripts/fetch_markdown.py --stdin --concurrency 6 --output-dir fetched
  uv run scripts/fetch_markdown.py https://example.com --impersonate chrome --http-version v2 --header 'Accept-Language: en-US,en;q=0.9'

Exit codes:
  0  all URLs fetched and converted successfully
  1  one or more URLs failed to fetch or convert
  2  invalid arguments or unsafe URL
""",
    )
    parser.add_argument("urls", nargs="*", help="HTTP(S) URLs to fetch. Bare hostnames are upgraded to https://.")
    parser.add_argument("--stdin", action="store_true", help="Read additional URLs from stdin, one per line.")
    parser.add_argument("--input-file", type=Path, help="Read additional URLs from a UTF-8 text file, one per line.")
    parser.add_argument("--output-dir", type=Path, help="Write per-URL Markdown files and a manifest.jsonl into this directory.")
    parser.add_argument("--combined", type=Path, help="Write all converted Markdown into one combined file.")
    parser.add_argument("--format", choices=["jsonl", "markdown", "summary"], default="jsonl", help="Stdout format. Default: jsonl.")
    parser.add_argument("--include-markdown", action="store_true", help="Include Markdown text in JSONL records, bounded by --stdout-char-limit.")
    parser.add_argument("--stdout-char-limit", type=int, default=20_000, help="Max Markdown chars included per stdout JSON record. Use 0 for no limit. Default: 20000.")
    parser.add_argument("--concurrency", type=int, default=4, help="Concurrent fetches. Default: 4.")
    parser.add_argument("--timeout", type=float, default=30.0, help="Per-request timeout in seconds. Default: 30.")
    parser.add_argument("--retries", type=int, default=2, help="Retries for transient failures and HTTP 429/5xx. Default: 2.")
    parser.add_argument("--retry-delay", type=float, default=0.5, help="Initial retry delay in seconds; doubles each retry. Default: 0.5.")
    parser.add_argument("--max-bytes", type=int, default=10_000_000, help="Maximum accepted response size after download. Default: 10000000.")
    parser.add_argument("--impersonate", default="chrome", help="curl_cffi browser fingerprint preset, e.g. chrome, safari, firefox, or none. Default: chrome.")
    parser.add_argument("--http-version", choices=["default", "v1", "v2", "v3", "v3only"], default="default", help="HTTP version hint for curl_cffi. Default: default.")
    parser.add_argument("--proxy", help="Proxy URL, e.g. http://user:pass@example.com:3128. Prefer one proxy URL over a dict.")
    parser.add_argument("--header", action="append", default=[], help="Extra request header as 'Name: Value'. May be repeated.")
    parser.add_argument("--accept", default=DEFAULT_ACCEPT, help="Accept header. Default favors Markdown, HTML, PDF, and text.")
    parser.add_argument("--user-agent", help="Override User-Agent. Usually unnecessary when --impersonate is enabled.")
    parser.add_argument("--allow-private", action="store_true", help="Allow localhost/private/intranet IP targets. Disabled by default for SSRF safety.")
    parser.add_argument("--cache-dir", type=Path, help="Cache raw responses and metadata in this directory.")
    parser.add_argument("--cache-ttl", type=float, default=86_400.0, help="Cache TTL in seconds. Default: 86400.")
    parser.add_argument("--no-cache", action="store_true", help="Disable cache reads and writes even if --cache-dir is set.")
    parser.add_argument("--include-raw", action="store_true", help="With --output-dir, also write raw response bodies.")
    parser.add_argument("--plugins", action="store_true", help="Enable installed MarkItDown plugins. Disabled by default.")
    parser.add_argument("--fail-on-http-error", action="store_true", help="Treat HTTP 4xx/5xx as errors instead of converting the response body.")
    args = parser.parse_args()

    if args.concurrency < 1 or args.concurrency > 32:
        parser.error("--concurrency must be between 1 and 32")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.retries < 0:
        parser.error("--retries must be non-negative")
    if args.max_bytes <= 0:
        parser.error("--max-bytes must be positive")
    if args.stdout_char_limit < 0:
        parser.error("--stdout-char-limit must be non-negative")
    return args


def stderr(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def collect_urls(args: argparse.Namespace) -> list[str]:
    urls: list[str] = list(args.urls)

    if args.input_file:
        if not args.input_file.exists():
            raise ValueError(f"input file not found: {args.input_file}")
        urls.extend(args.input_file.read_text(encoding="utf-8").splitlines())

    if args.stdin or (not urls and not sys.stdin.isatty()):
        urls.extend(sys.stdin.read().splitlines())

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in urls:
        url = raw.strip()
        if not url or url.startswith("#"):
            continue
        if "://" not in url:
            url = "https://" + url
        if url not in seen:
            normalized.append(url)
            seen.add(url)

    if not normalized:
        raise ValueError("provide at least one URL, --input-file, or --stdin")
    return normalized


def redact_url_credentials(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.username and not parsed.password:
        return url
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return urlunparse((parsed.scheme, host, parsed.path, parsed.params, parsed.query, parsed.fragment))


def validate_public_http_url(url: str, *, allow_private: bool) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"unsupported URL scheme for {url!r}; only http:// and https:// are allowed")
    if not parsed.hostname:
        raise ValueError(f"URL has no hostname: {url!r}")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not accepted; pass authenticated content another way")
    if allow_private:
        return

    host = parsed.hostname.strip("[]")
    hosts_to_check: set[str] = set()
    try:
        hosts_to_check.add(str(ipaddress.ip_address(host)))
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise ValueError(f"could not resolve hostname {host!r}: {exc}") from exc
        for info in infos:
            hosts_to_check.add(info[4][0])

    for ip_text in hosts_to_check:
        ip = ipaddress.ip_address(ip_text)
        if any(
            (
                ip.is_private,
                ip.is_loopback,
                ip.is_link_local,
                ip.is_multicast,
                ip.is_reserved,
                ip.is_unspecified,
            )
        ):
            raise ValueError(f"{PRIVATE_ERROR} Host {host!r} resolved to {ip}.")


def parse_headers(header_values: list[str], accept: str, user_agent: str | None) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": accept}
    if user_agent:
        headers["User-Agent"] = user_agent
    for item in header_values:
        if ":" not in item:
            raise ValueError(f"invalid --header {item!r}; expected 'Name: Value'")
        name, value = item.split(":", 1)
        name = name.strip()
        value = value.strip()
        if not name or not value:
            raise ValueError(f"invalid --header {item!r}; expected non-empty name and value")
        headers[name] = value
    return headers


def cache_key(url: str, args: argparse.Namespace, headers: dict[str, str]) -> str:
    material = {
        "url": url,
        "headers": headers,
        "impersonate": None if args.impersonate == "none" else args.impersonate,
        "http_version": None if args.http_version == "default" else args.http_version,
        "proxy": bool(args.proxy),
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode("utf-8")).hexdigest()


def load_cache(url: str, args: argparse.Namespace, key: str) -> Payload | None:
    if args.no_cache or not args.cache_dir:
        return None
    meta_path = args.cache_dir / f"{key}.json"
    body_path = args.cache_dir / f"{key}.body"
    if not meta_path.exists() or not body_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        stored_at = float(meta.get("stored_at", 0))
    except Exception:
        return None
    if time.time() - stored_at > args.cache_ttl:
        return None
    body = body_path.read_bytes()
    record = dict(meta.get("record", {}))
    record.update({"url": url, "cache_hit": True, "cache_key": key})
    return Payload(record=record, body=body, headers=record.get("headers", {}))


def save_cache(args: argparse.Namespace, key: str, payload: Payload) -> None:
    if args.no_cache or not args.cache_dir or payload.record.get("error"):
        return
    try:
        args.cache_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "stored_at": time.time(),
            "record": {k: v for k, v in payload.record.items() if k not in {"markdown", "markdown_file", "raw_file"}},
        }
        (args.cache_dir / f"{key}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (args.cache_dir / f"{key}.body").write_bytes(payload.body)
    except Exception as exc:
        stderr(f"warning: could not write cache entry {key[:12]}: {exc}")


async def fetch_one(
    session: AsyncSession,
    url: str,
    args: argparse.Namespace,
    headers: dict[str, str],
    semaphore: asyncio.Semaphore,
) -> Payload:
    key = cache_key(url, args, headers)
    cached = load_cache(url, args, key)
    if cached:
        return cached

    record: dict[str, Any] = {
        "url": redact_url_credentials(url),
        "final_url": None,
        "status_code": None,
        "content_type": None,
        "bytes": 0,
        "elapsed_ms": None,
        "cache_hit": False,
        "cache_key": key,
        "error": None,
    }
    request_kwargs: dict[str, Any] = {
        "headers": headers,
        "timeout": args.timeout,
        "allow_redirects": True,
    }
    if args.impersonate != "none":
        request_kwargs["impersonate"] = args.impersonate
    if args.http_version != "default":
        request_kwargs["http_version"] = args.http_version
    if args.proxy:
        request_kwargs["proxy"] = args.proxy

    last_error: str | None = None
    for attempt in range(args.retries + 1):
        async with semaphore:
            start = time.perf_counter()
            try:
                response = await session.get(url, **request_kwargs)
                elapsed_ms = int((time.perf_counter() - start) * 1000)
                body = response.content or b""
                status_code = int(response.status_code)
                response_headers = {str(k): str(v) for k, v in dict(response.headers).items()}
                record.update(
                    {
                        "final_url": redact_url_credentials(str(response.url)),
                        "status_code": status_code,
                        "content_type": response_headers.get("content-type") or response_headers.get("Content-Type"),
                        "bytes": len(body),
                        "elapsed_ms": elapsed_ms,
                        "headers": response_headers,
                    }
                )

                if len(body) > args.max_bytes:
                    record["error"] = f"response size {len(body)} exceeds --max-bytes {args.max_bytes}"
                    return Payload(record=record, body=b"", headers=response_headers)

                transient = status_code == 429 or 500 <= status_code <= 599
                if transient and attempt < args.retries:
                    await asyncio.sleep(args.retry_delay * (2**attempt))
                    continue

                if args.fail_on_http_error and status_code >= 400:
                    record["error"] = f"HTTP {status_code}"
                    return Payload(record=record, body=body, headers=response_headers)

                payload = Payload(record=record, body=body, headers=response_headers)
                if status_code < 500:
                    save_cache(args, key, payload)
                return payload
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < args.retries:
                    await asyncio.sleep(args.retry_delay * (2**attempt))
                    continue

    record["error"] = last_error or "request failed"
    return Payload(record=record)


async def fetch_all(urls: list[str], args: argparse.Namespace, headers: dict[str, str]) -> list[Payload]:
    semaphore = asyncio.Semaphore(args.concurrency)
    async with AsyncSession() as session:
        tasks = [fetch_one(session, url, args, headers, semaphore) for url in urls]
        return await asyncio.gather(*tasks)


def header_value(headers: dict[str, str], name: str) -> str | None:
    lower = name.lower()
    for key, value in headers.items():
        if key.lower() == lower:
            return value
    return None


def parse_content_type(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    message = Message()
    message["content-type"] = value
    mimetype = message.get_content_type()
    charset = message.get_content_charset()
    return mimetype, charset


def filename_from_content_disposition(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"filename\*?=(?:UTF-8''|\")?([^\";]+)", value, flags=re.IGNORECASE)
    if not match:
        return None
    filename = match.group(1).strip().strip("'\"")
    return os.path.basename(filename) or None


def stream_info_for(payload: Payload) -> StreamInfo:
    final_url = payload.record.get("final_url") or payload.record.get("url") or ""
    mimetype, charset = parse_content_type(payload.record.get("content_type"))
    filename = filename_from_content_disposition(header_value(payload.headers, "content-disposition"))
    extension: str | None = None
    if filename:
        extension = Path(filename).suffix or None
    if not extension:
        path_ext = Path(urlparse(final_url).path).suffix
        extension = path_ext or None
    if not extension and mimetype:
        extension = mimetypes.guess_extension(mimetype, strict=False)
    return StreamInfo(mimetype=mimetype, charset=charset, filename=filename, extension=extension, url=final_url)


def looks_textual(payload: Payload) -> bool:
    mimetype, _ = parse_content_type(payload.record.get("content_type"))
    if not mimetype:
        sample = payload.body[:2048]
        return b"\x00" not in sample
    return mimetype.startswith("text/") or mimetype in TEXT_MIMETYPES or mimetype.endswith("+json") or mimetype.endswith("+xml")


def decode_text(payload: Payload) -> str:
    _, charset = parse_content_type(payload.record.get("content_type"))
    for encoding in [charset, "utf-8", "latin-1"]:
        if not encoding:
            continue
        try:
            return payload.body.decode(encoding, errors="replace")
        except LookupError:
            continue
    return payload.body.decode("utf-8", errors="replace")


def convert_payloads(payloads: list[Payload], *, enable_plugins: bool) -> list[Payload]:
    converter = MarkItDown(enable_plugins=enable_plugins)
    for payload in payloads:
        if payload.record.get("error"):
            continue
        if not payload.body:
            payload.record["error"] = "empty response body"
            continue
        try:
            result = converter.convert_stream(io.BytesIO(payload.body), stream_info=stream_info_for(payload))
            payload.markdown = (result.text_content or "").strip()
            payload.record["markdown_chars"] = len(payload.markdown)
            payload.record["conversion_error"] = None
        except Exception as exc:
            if looks_textual(payload):
                payload.markdown = decode_text(payload).strip()
                payload.record["markdown_chars"] = len(payload.markdown)
                payload.record["conversion_error"] = f"MarkItDown fallback to decoded text after {type(exc).__name__}: {exc}"
            else:
                payload.record["error"] = f"MarkItDown conversion failed: {type(exc).__name__}: {exc}"
                payload.record["markdown_chars"] = 0
    return payloads


def slug_for(url: str, key: str) -> str:
    parsed = urlparse(url)
    raw = f"{parsed.netloc}{parsed.path}".strip("/") or "fetch"
    raw = raw.replace("/", "-")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._").lower() or "fetch"
    return f"{safe[:80]}-{key[:10]}"


def raw_extension(payload: Payload) -> str:
    info = stream_info_for(payload)
    if info.extension:
        return info.extension if info.extension.startswith(".") else "." + info.extension
    return ".bin"


def write_outputs(payloads: list[Payload], args: argparse.Namespace) -> None:
    if not args.output_dir:
        return
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / "manifest.jsonl"
    manifest_records: list[dict[str, Any]] = []

    for payload in payloads:
        key = str(payload.record.get("cache_key") or hashlib.sha256(str(payload.record.get("url")).encode()).hexdigest())
        stem = slug_for(str(payload.record.get("final_url") or payload.record.get("url") or "fetch"), key)
        if payload.markdown:
            md_path = args.output_dir / f"{stem}.md"
            md_path.write_text(payload.markdown + "\n", encoding="utf-8")
            payload.record["markdown_file"] = str(md_path)
        if args.include_raw and payload.body:
            raw_path = args.output_dir / f"{stem}{raw_extension(payload)}"
            raw_path.write_bytes(payload.body)
            payload.record["raw_file"] = str(raw_path)
        manifest_records.append(record_for_json(payload, include_markdown=False, limit=0))

    manifest_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in manifest_records) + "\n", encoding="utf-8")


def write_combined(payloads: list[Payload], output_path: Path) -> None:
    parts: list[str] = []
    for idx, payload in enumerate(payloads, start=1):
        url = payload.record.get("final_url") or payload.record.get("url")
        status = payload.record.get("status_code")
        parts.append(f"# Source {idx}: {url}\n\nStatus: {status}\n\n")
        if payload.markdown:
            parts.append(payload.markdown.strip() + "\n")
        else:
            parts.append(f"Conversion failed: {payload.record.get('error')}\n")
        parts.append("\n---\n")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(parts), encoding="utf-8")


def record_for_json(payload: Payload, *, include_markdown: bool, limit: int) -> dict[str, Any]:
    record = {k: v for k, v in payload.record.items() if k != "headers"}
    if include_markdown:
        text = payload.markdown
        if limit and len(text) > limit:
            record["markdown"] = text[:limit]
            record["markdown_truncated"] = True
            record["markdown_original_chars"] = len(text)
        else:
            record["markdown"] = text
            record["markdown_truncated"] = False
    return record


def print_stdout(payloads: list[Payload], args: argparse.Namespace) -> None:
    if args.format == "summary":
        for payload in payloads:
            status = payload.record.get("status_code") or "-"
            chars = payload.record.get("markdown_chars") or 0
            cache = " cache" if payload.record.get("cache_hit") else ""
            err = payload.record.get("error")
            url = payload.record.get("final_url") or payload.record.get("url")
            if err:
                print(f"FAIL {status} {chars:>7} chars{cache} {url} :: {err}")
            else:
                print(f"OK   {status} {chars:>7} chars{cache} {url}")
        return

    if args.format == "markdown":
        for idx, payload in enumerate(payloads, start=1):
            url = payload.record.get("final_url") or payload.record.get("url")
            print(f"# Source {idx}: {url}\n")
            if payload.markdown:
                print(payload.markdown)
            else:
                print(f"Conversion failed: {payload.record.get('error')}")
            print("\n---\n")
        return

    include = args.include_markdown or not args.output_dir
    for payload in payloads:
        print(json.dumps(record_for_json(payload, include_markdown=include, limit=args.stdout_char_limit), ensure_ascii=False))


def main() -> int:
    args = parse_args()
    try:
        urls = collect_urls(args)
        headers = parse_headers(args.header, args.accept, args.user_agent)
        for url in urls:
            validate_public_http_url(url, allow_private=args.allow_private)
    except ValueError as exc:
        stderr(f"error: {exc}")
        return 2

    stderr(f"fetching {len(urls)} URL(s) with concurrency={args.concurrency}, impersonate={args.impersonate}")
    payloads = asyncio.run(fetch_all(urls, args, headers))
    payloads = convert_payloads(payloads, enable_plugins=args.plugins)
    write_outputs(payloads, args)
    if args.combined:
        write_combined(payloads, args.combined)
    print_stdout(payloads, args)

    failures = [p for p in payloads if p.record.get("error")]
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
