#!/usr/bin/env python3
# pyright: reportAttributeAccessIssue=false
# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = [
#   "markitdown[all]>=0.1.5,<0.2",
#   "openai>=1.0,<3",
#   "requests>=2.32,<3",
# ]
# ///
"""Convert local files or trusted public URLs to Markdown with Microsoft MarkItDown.

The script is designed for agent use:
- local-only by default;
- explicit --allow-remote for HTTP(S) URLs;
- private-network URL blocking;
- deterministic output naming;
- JSON summaries for downstream checks.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import socket
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin, urlparse

import requests  # type: ignore[reportMissingModuleSource]
from markitdown import (  # type: ignore[reportAttributeAccessIssue]
    MarkItDown,
    StreamInfo,
)

REMOTE_BLOCKED_HOSTS = {"localhost", "localhost.localdomain"}
DEFAULT_MAX_REMOTE_MB = 50.0
MAX_REDIRECTS = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert files or trusted public URLs to Markdown using Microsoft MarkItDown.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Local file paths, or HTTP(S) URLs when --allow-remote is set.",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output Markdown file. Valid only with exactly one input.",
    )
    parser.add_argument(
        "--output-dir",
        default="markitdown-output",
        help="Directory for generated .md files when --output is not used.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Write Markdown for a single input to stdout instead of a file.",
    )
    parser.add_argument(
        "--overwrite", action="store_true", help="Overwrite existing output files."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a JSON conversion summary to stdout. Not compatible with --stdout.",
    )

    parser.add_argument(
        "--extension",
        help="File extension hint such as .pdf or docx. Applies to all inputs.",
    )
    parser.add_argument(
        "--mime-type",
        help="MIME type hint such as application/pdf. Applies to all inputs.",
    )
    parser.add_argument(
        "--charset", help="Charset hint such as UTF-8. Applies to all inputs."
    )
    parser.add_argument(
        "--keep-data-uris",
        action="store_true",
        help="Keep base64 data URIs instead of letting MarkItDown truncate them.",
    )

    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Allow HTTP(S) URL inputs after public-address validation.",
    )
    parser.add_argument(
        "--max-remote-mb",
        type=float,
        default=DEFAULT_MAX_REMOTE_MB,
        help="Maximum bytes to download per remote URL, in MB.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP connection/read timeout in seconds for each remote request.",
    )

    parser.add_argument(
        "--use-plugins",
        action="store_true",
        help="Enable installed third-party MarkItDown plugins.",
    )
    parser.add_argument(
        "--docintel-endpoint",
        help="Azure Document Intelligence endpoint for MarkItDown document intelligence conversion.",
    )
    parser.add_argument(
        "--llm-model",
        help="Model name for MarkItDown image descriptions. Requires an OpenAI-compatible client and credentials.",
    )
    parser.add_argument(
        "--llm-prompt", help="Optional prompt for MarkItDown LLM image descriptions."
    )

    args = parser.parse_args()

    if args.output and len(args.inputs) != 1:
        parser.error("--output is valid only with exactly one input")
    if args.stdout and len(args.inputs) != 1:
        parser.error("--stdout is valid only with exactly one input")
    if args.stdout and args.output:
        parser.error("--stdout and --output cannot be used together")
    if args.stdout and args.json:
        parser.error(
            "--stdout and --json cannot be used together because both write to stdout"
        )
    if args.max_remote_mb <= 0:
        parser.error("--max-remote-mb must be positive")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")

    return args


def normalize_extension(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    return value if value.startswith(".") else f".{value}"


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)


def validate_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("remote inputs must use http or https")
    if not parsed.hostname:
        raise ValueError("remote URL is missing a hostname")

    host = parsed.hostname.rstrip(".").lower()
    if host in REMOTE_BLOCKED_HOSTS or host.endswith(".localhost"):
        raise ValueError(f"blocked local hostname: {parsed.hostname}")

    try:
        addresses = socket.getaddrinfo(
            host,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ValueError(
            f"could not resolve hostname {parsed.hostname!r}: {exc}"
        ) from exc

    if not addresses:
        raise ValueError(f"hostname {parsed.hostname!r} did not resolve")

    for address in addresses:
        ip_raw = address[4][0]
        try:
            ip = ipaddress.ip_address(ip_raw)
        except ValueError as exc:
            raise ValueError(f"could not parse resolved IP address {ip_raw!r}") from exc

        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ValueError(
                f"blocked non-public remote address {ip} for hostname {parsed.hostname!r}"
            )


def fetch_public_url(
    url: str, *, max_bytes: int, timeout: float
) -> tuple[requests.Response, str, int]:
    session = requests.Session()
    headers = {"User-Agent": "agent-skill-markitdown/1.0"}
    current = url

    for redirect_count in range(MAX_REDIRECTS + 1):
        validate_public_http_url(current)
        response = session.get(
            current,
            headers=headers,
            stream=True,
            allow_redirects=False,
            timeout=(timeout, timeout),
        )

        if response.is_redirect or response.is_permanent_redirect:
            if redirect_count >= MAX_REDIRECTS:
                response.close()
                raise ValueError(f"too many redirects while fetching {url!r}")
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise ValueError("redirect response did not include a Location header")
            current = urljoin(current, location)
            continue

        response.raise_for_status()

        content_length = response.headers.get("Content-Length")
        if (
            content_length
            and content_length.isdigit()
            and int(content_length) > max_bytes
        ):
            response.close()
            raise ValueError(
                f"remote file is larger than the configured limit ({max_bytes} bytes)"
            )

        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                response.close()
                raise ValueError(
                    f"remote file exceeded the configured limit ({max_bytes} bytes)"
                )
            chunks.append(chunk)

        # MarkItDown reads the response through iter_content(); cache the bounded
        # body so requests can replay it from memory without re-opening the socket.
        setattr(response, "_content", b"".join(chunks))
        setattr(response, "_content_consumed", True)
        response.url = current
        return response, current, total

    raise ValueError(f"too many redirects while fetching {url!r}")


def safe_output_name(raw_name: str, *, fallback: str = "document") -> str:
    name = unquote(raw_name).strip()
    if not name:
        name = fallback
    stem = Path(name).stem or fallback
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_") or fallback
    return f"{stem}.md"


def output_name_for_input(input_value: str, *, final_url: str | None = None) -> str:
    if final_url or is_http_url(input_value):
        parsed = urlparse(final_url or input_value)
        raw = Path(parsed.path).name or parsed.hostname or "remote-document"
        return safe_output_name(raw, fallback="remote-document")
    return safe_output_name(Path(input_value).name, fallback="document")


def unique_output_path(
    base_dir: Path, filename: str, reserved: set[Path], overwrite: bool
) -> Path:
    base_dir.mkdir(parents=True, exist_ok=True)
    candidate = base_dir / filename
    if overwrite:
        reserved.add(candidate.resolve())
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix or ".md"
    counter = 2
    while candidate.exists() or candidate.resolve() in reserved:
        candidate = base_dir / f"{stem}-{counter}{suffix}"
        counter += 1
    reserved.add(candidate.resolve())
    return candidate


def make_markitdown(args: argparse.Namespace) -> MarkItDown:
    kwargs: dict[str, Any] = {"enable_plugins": bool(args.use_plugins)}

    if args.docintel_endpoint:
        kwargs["docintel_endpoint"] = args.docintel_endpoint

    if args.llm_model:
        try:
            from openai import OpenAI  # type: ignore[reportMissingImports]
        except (
            Exception
        ) as exc:  # pragma: no cover - dependency should be present from PEP 723.
            raise RuntimeError(
                "openai is required for --llm-model but could not be imported"
            ) from exc
        kwargs["llm_client"] = OpenAI()
        kwargs["llm_model"] = args.llm_model
        if args.llm_prompt:
            kwargs["llm_prompt"] = args.llm_prompt

    return MarkItDown(**kwargs)


def convert_one(
    md: MarkItDown, input_value: str, args: argparse.Namespace
) -> tuple[str, dict[str, Any]]:
    extension = normalize_extension(args.extension)
    stream_info = StreamInfo(
        mimetype=args.mime_type,
        extension=extension,
        charset=args.charset,
    )
    convert_kwargs: dict[str, Any] = {}
    if args.keep_data_uris:
        convert_kwargs["keep_data_uris"] = True

    if is_http_url(input_value):
        if not args.allow_remote:
            raise ValueError("remote URL input requires --allow-remote")
        max_bytes = int(args.max_remote_mb * 1024 * 1024)
        response, final_url, downloaded_bytes = fetch_public_url(
            input_value, max_bytes=max_bytes, timeout=args.timeout
        )
        try:
            remote_info = stream_info.copy_and_update(
                url=final_url,
                filename=Path(urlparse(final_url).path).name or None,
            )
            result = md.convert_response(
                response,
                stream_info=remote_info,
                file_extension=extension,
                **convert_kwargs,
            )
            markdown = result.text_content or ""
            meta = {
                "source_type": "remote",
                "final_url": final_url,
                "downloaded_bytes": downloaded_bytes,
                "title": result.title,
            }
            return markdown, meta
        finally:
            response.close()

    if urlparse(input_value).scheme and not Path(input_value).exists():
        raise ValueError("only local paths and HTTP(S) URLs are supported")

    path = Path(input_value).expanduser().resolve(strict=True)
    if not path.is_file():
        raise ValueError(f"input is not a regular file: {path}")

    local_info = stream_info.copy_and_update(filename=path.name, local_path=str(path))
    result = md.convert_local(
        path, stream_info=local_info, file_extension=extension, **convert_kwargs
    )
    markdown = result.text_content or ""
    meta = {
        "source_type": "local",
        "resolved_path": str(path),
        "title": result.title,
    }
    return markdown, meta


def write_markdown(path: Path, markdown: str, *, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(f"output exists; use --overwrite to replace it: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if markdown and not markdown.endswith("\n"):
        markdown += "\n"
    path.write_text(markdown, encoding="utf-8")


def main() -> int:
    args = parse_args()
    md = make_markitdown(args)
    summaries: list[dict[str, Any]] = []
    reserved_paths: set[Path] = set()
    any_error = False

    output_dir = Path(args.output_dir).expanduser().resolve()

    for input_value in args.inputs:
        summary: dict[str, Any] = {"input": input_value}
        try:
            markdown, meta = convert_one(md, input_value, args)
            summary.update(meta)
            summary["characters"] = len(markdown)

            if args.stdout:
                sys.stdout.write(markdown)
                if markdown and not markdown.endswith("\n"):
                    sys.stdout.write("\n")
                summary["output"] = "stdout"
            else:
                if args.output:
                    output_path = Path(args.output).expanduser().resolve()
                    reserved_paths.add(output_path)
                else:
                    output_name = output_name_for_input(
                        input_value, final_url=summary.get("final_url")
                    )
                    output_path = unique_output_path(
                        output_dir, output_name, reserved_paths, args.overwrite
                    )
                write_markdown(output_path, markdown, overwrite=args.overwrite)
                summary["output"] = str(output_path)
                print(
                    f"wrote {output_path} ({len(markdown)} characters)", file=sys.stderr
                )

            summary["status"] = "ok"
        except Exception as exc:
            any_error = True
            summary["status"] = "error"
            summary["error"] = str(exc)
            print(f"error converting {input_value!r}: {exc}", file=sys.stderr)
        summaries.append(summary)

    if args.json:
        print(json.dumps(summaries, indent=2, ensure_ascii=False))

    return 1 if any_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
