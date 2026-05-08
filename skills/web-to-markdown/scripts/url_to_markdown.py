#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "curl_cffi==0.15.0",
#   "markitdown[all]==0.1.5",
# ]
# ///
"""Fetch URL(s) with browser impersonation and convert them to Markdown.

This script is intentionally self-contained via PEP 723 metadata. Run it with:

    uv run scripts/url_to_markdown.py https://example.com -o example.md
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import NoReturn
from urllib.parse import urlparse

from curl_cffi import requests
from markitdown import MarkItDown, StreamInfo

CHALLENGE_RE = re.compile(
    r"just a moment|checking your browser|attention required|cloudflare|"
    r"enable javascript and cookies|verify you are human",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FetchSummary:
    url: str
    status_code: int
    final_url: str
    content_type: str | None
    bytes: int
    output: str | None
    fetched_output: str | None
    challenge_warning: bool


def fail(message: str, exit_code: int) -> NoReturn:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def parse_header_items(items: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for item in items:
        name, separator, value = item.partition(":")
        if separator != ":" or not name.strip():
            fail(f"invalid header {item!r}; expected 'Name:Value'", 2)
        headers[name.strip()] = value.lstrip()
    return headers


def parse_cookie_items(items: list[str]) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for item in items:
        name, separator, value = item.partition("=")
        if separator != "=" or not name.strip():
            fail(f"invalid cookie {item!r}; expected 'name=value'", 2)
        cookies[name.strip()] = value
    return cookies


def parse_content_type_header(value: str | None) -> tuple[str | None, str | None]:
    if value is None:
        return None, None

    parts = [part.strip() for part in value.split(";")]
    mimetype = parts[0].lower() or None
    charset = None
    for part in parts[1:]:
        key, separator, val = part.partition("=")
        if separator == "=" and key.strip().lower() == "charset":
            charset = val.strip().strip('"') or None
    return mimetype, charset


def normalize_extension(extension: str | None, url: str, mimetype: str | None) -> str | None:
    if extension:
        stripped = extension.strip()
        return stripped if stripped.startswith(".") else f".{stripped}"

    path_suffix = Path(urlparse(url).path).suffix
    if path_suffix:
        return path_suffix

    mimetype_map = {
        "text/html": ".html",
        "application/xhtml+xml": ".html",
        "application/json": ".json",
        "application/rss+xml": ".rss",
        "application/atom+xml": ".xml",
        "text/xml": ".xml",
        "application/xml": ".xml",
        "text/plain": ".txt",
        "text/csv": ".csv",
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    }
    return mimetype_map.get(mimetype)


def write_bytes(path: str, content: bytes, label: str) -> None:
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    except OSError as error:
        fail(f"failed to write {label} to {path}: {error}", 5)


def write_text(path: str, content: str, label: str) -> None:
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    except OSError as error:
        fail(f"failed to write {label} to {path}: {error}", 5)


def write_text_or_stdout(markdown: str, output: str | None) -> None:
    if output is None:
        print(markdown, end="" if markdown.endswith("\n") else "\n")
        return

    write_text(output, markdown, "Markdown")
    print(f"Wrote Markdown to {Path(output)}", file=sys.stderr)


def stable_name(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch URL(s) with curl_cffi browser impersonation and convert the "
            "response to Markdown with markitdown. Dependencies are declared "
            "inline with PEP 723 and installed/cached by uv."
        ),
        epilog=(
            "Examples:\n"
            "  uv run scripts/url_to_markdown.py https://example.com -o example.md\n"
            "  uv run scripts/url_to_markdown.py https://example.com --fetched-output page.html -o page.md\n"
            "  uv run scripts/url_to_markdown.py --url-list urls.txt --output-dir out\n"
            "  uv run scripts/url_to_markdown.py https://protected.example.com "
            "-H 'Accept-Language:en-US,en;q=0.9' -b \"cf_clearance=$CF_CLEARANCE\" -o page.md\n\n"
            "Exit codes: 0 success, 2 invalid arguments, 3 fetch failed, 4 conversion failed, "
            "5 output/write failed."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("url", nargs="?", help="URL to fetch")
    parser.add_argument("-o", "--output", help="write Markdown to this file instead of stdout")
    parser.add_argument(
        "--fetched-output",
        help="save fetched response bytes to this file for debugging or later conversion",
    )
    parser.add_argument("--url-list", help="read URLs from this file, one URL per line")
    parser.add_argument(
        "--output-dir",
        help="directory for batch mode outputs; writes <sha1>.md, <sha1>.body, and <sha1>.json",
    )
    parser.add_argument(
        "-i",
        "--impersonate",
        default="chrome146",
        help="curl_cffi impersonation target (default: chrome146)",
    )
    parser.add_argument(
        "-x",
        "--extension",
        help="markitdown file-extension hint, e.g. html, pdf, docx; defaults from URL/content-type",
    )
    parser.add_argument("-m", "--mime", help="MIME type hint for markitdown")
    parser.add_argument("-c", "--charset", help="charset hint for markitdown")
    parser.add_argument(
        "-H",
        "--header",
        action="append",
        default=[],
        help="request header in 'Name:Value' form; repeatable",
    )
    parser.add_argument(
        "-b",
        "--cookie",
        action="append",
        default=[],
        help="cookie in 'name=value' form; repeatable",
    )
    parser.add_argument("--bearer-token", help="add Authorization: Bearer <token>")
    parser.add_argument("--basic-auth", help="basic auth credentials as USER:PASS")
    parser.add_argument("--proxy", help="proxy URL for both HTTP and HTTPS")
    parser.add_argument("--timeout", type=float, default=30.0, help="request timeout in seconds (default: 30)")
    parser.add_argument("--no-verify", action="store_true", help="disable TLS certificate verification")
    parser.add_argument(
        "--allow-http-error",
        action="store_true",
        help="convert the response body even when HTTP status is 400 or higher",
    )
    parser.add_argument(
        "--no-sniff",
        action="store_true",
        help="do not warn when Markdown resembles a bot challenge page",
    )
    parser.add_argument(
        "--summary-json",
        help="write fetch/conversion metadata JSON to this file",
    )
    return parser


def request_options(args: argparse.Namespace) -> dict[str, object]:
    headers = parse_header_items(args.header)
    cookies = parse_cookie_items(args.cookie)

    if args.bearer_token:
        headers["Authorization"] = f"Bearer {args.bearer_token}"

    auth = None
    if args.basic_auth:
        username, separator, password = args.basic_auth.partition(":")
        if separator != ":" or not username:
            fail("--basic-auth must be USER:PASS", 2)
        auth = (username, password)

    proxies = {"http": args.proxy, "https": args.proxy} if args.proxy else None

    return {
        "impersonate": args.impersonate,
        "headers": headers or None,
        "cookies": cookies or None,
        "auth": auth,
        "proxies": proxies,
        "timeout": args.timeout,
        "verify": not args.no_verify,
        "allow_redirects": True,
    }


def convert_url(
    args: argparse.Namespace,
    url: str,
    output: str | None,
    fetched_output: str | None,
    summary_json: str | None,
) -> FetchSummary:
    print(f"Fetching {url} with {args.impersonate}...", file=sys.stderr)
    try:
        response = requests.get(url, **request_options(args))
    except Exception as error:  # noqa: BLE001 - concise CLI error for agents
        fail(f"fetch failed for {url}: {error}", 3)

    if response.status_code >= 400 and not args.allow_http_error:
        fail(
            f"HTTP {response.status_code} for {url}; use --allow-http-error to convert the body anyway",
            3,
        )

    content = response.content
    content_type = response.headers.get("content-type")
    header_mimetype, header_charset = parse_content_type_header(content_type)
    mimetype = args.mime or header_mimetype
    charset = args.charset or header_charset
    extension = normalize_extension(args.extension, str(response.url), mimetype)

    if fetched_output:
        write_bytes(fetched_output, content, "fetched response")
        print(f"Wrote fetched response to {Path(fetched_output)}", file=sys.stderr)

    stream_info = StreamInfo(
        mimetype=mimetype,
        extension=extension,
        charset=charset,
        filename=Path(urlparse(str(response.url)).path).name or None,
        url=str(response.url),
    )

    print(f"Converting fetched body as {extension or mimetype or 'auto-detected'}...", file=sys.stderr)
    try:
        result = MarkItDown().convert_stream(BytesIO(content), stream_info=stream_info)
    except Exception as error:  # noqa: BLE001 - concise CLI error for agents
        fail(f"markitdown conversion failed: {error}", 4)

    markdown = result.text_content
    challenge_warning = False
    if not args.no_sniff and CHALLENGE_RE.search(markdown):
        challenge_warning = True
        print(
            "WARN: output resembles a bot challenge or consent page; try cookies, "
            "headers, another impersonation target, or agent-browser.",
            file=sys.stderr,
        )

    write_text_or_stdout(markdown, output)

    summary = FetchSummary(
        url=url,
        status_code=response.status_code,
        final_url=str(response.url),
        content_type=content_type,
        bytes=len(content),
        output=output,
        fetched_output=fetched_output,
        challenge_warning=challenge_warning,
    )

    if summary_json:
        write_text(summary_json, json.dumps(asdict(summary), indent=2) + "\n", "summary JSON")

    return summary


def read_url_list(path: str) -> list[str]:
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as error:
        fail(f"failed to read URL list {path}: {error}", 2)
    return [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]


def main() -> int:
    args = build_parser().parse_args()

    if args.url_list:
        if args.url:
            fail("provide either URL or --url-list, not both", 2)
        if args.output or args.fetched_output or args.summary_json:
            fail("batch mode uses --output-dir instead of --output/--fetched-output/--summary-json", 2)
        if not args.output_dir:
            fail("--output-dir is required with --url-list", 2)

        output_dir = Path(args.output_dir)
        for url in read_url_list(args.url_list):
            name = stable_name(url)
            print(f"→ {url} ({name})", file=sys.stderr)
            convert_url(
                args,
                url,
                output=str(output_dir / f"{name}.md"),
                fetched_output=str(output_dir / f"{name}.body"),
                summary_json=str(output_dir / f"{name}.json"),
            )
        return 0

    if not args.url:
        fail("URL is required unless --url-list is used", 2)
    if args.output_dir:
        fail("--output-dir only applies with --url-list", 2)

    convert_url(args, args.url, args.output, args.fetched_output, args.summary_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
