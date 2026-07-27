"""Bandit's tools — callable functions the model can ask to run.

Learning note
-------------
"Tool calling" means the model can emit a structured request (name +
JSON arguments) instead of plain text; we execute it and feed the result
back as a new message. `WEB_FETCH_TOOL` below is the JSON schema shown to
the model; `fetch_url` is what actually runs.

v1 ships exactly one tool. No registry — add a dict-of-tools only when a
second tool shows up.
"""

from __future__ import annotations

import contextlib
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx

MAX_REDIRECTS = 5
TIMEOUT_SECONDS = 10.0
MAX_BYTES = 1024 * 1024  # 1 MB
MAX_TEXT_CHARS = 8000

WEB_FETCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_fetch",
        "description": "Fetch a web page over http/https and return its text content.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The http(s) URL to fetch.",
                },
            },
            "required": ["url"],
        },
    },
}


class FetchError(Exception):
    """Raised when a fetch is rejected (SSRF guard, bad URL) or fails."""


_CGNAT = ipaddress.ip_network("100.64.0.0/10")  # RFC 6598 — not covered by is_private
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def _blocked_ip(ip_str: str) -> bool:
    """True if `ip_str` is loopback/private/link-local/multicast/reserved."""
    ip = ipaddress.ip_address(ip_str)
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or ip in _CGNAT
        or ip in _NAT64
    )


def _resolve_pinned(host: str) -> str:
    """Resolve `host` once and return a validated (non-internal) IP."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise FetchError(f"could not resolve host: {host}") from exc
    if not infos:
        raise FetchError(f"could not resolve host: {host}")
    ip = infos[0][4][0]
    if _blocked_ip(ip):
        raise FetchError(f"refusing to fetch internal/blocked address: {ip}")
    return ip


@contextlib.contextmanager
def _dns_pin(host: str, ip: str):
    """
    Force any DNS lookup for `host` to resolve to the already-validated `ip`
    for the rest of this block.

    Without this, `_resolve_pinned` checks one IP but the HTTP client would
    re-resolve `host` itself to connect — a DNS-rebinding TOCTOU where the
    second lookup can return a private/metadata address the first one didn't.
    Pinning closes that gap. Global monkeypatch of socket.getaddrinfo is fine
    here since Bandit fetches one URL at a time on one thread; a concurrent
    fetcher would need a real per-request resolver override instead.
    """
    real_getaddrinfo = socket.getaddrinfo

    def pinned(getaddr_host, port, family=0, type=0, proto=0, flags=0):
        if getaddr_host == host:
            return real_getaddrinfo(ip, port, family, type, proto, flags)
        return real_getaddrinfo(getaddr_host, port, family, type, proto, flags)

    socket.getaddrinfo = pinned
    try:
        yield
    finally:
        socket.getaddrinfo = real_getaddrinfo


class _TextExtractor(HTMLParser):
    """Crude tag-strip: collect text nodes, skip script/style content."""

    _SKIP_TAGS = {"script", "style"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if not self._skip_depth:
            stripped = data.strip()
            if stripped:
                self._chunks.append(stripped)

    def text(self) -> str:
        return " ".join(self._chunks)


def _html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return parser.text()


def fetch_url(url: str, transport: httpx.BaseTransport | None = None) -> str:
    """
    Fetch `url` and return plain text (HTML is tag-stripped), capped at
    MAX_TEXT_CHARS. Follows up to MAX_REDIRECTS redirects manually,
    re-validating and re-pinning the destination at every hop.

    `transport` is a test seam (e.g. httpx.MockTransport) — production
    callers leave it as None and get a real network connection.

    Raises FetchError if the URL/scheme/host is rejected or the fetch fails.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(current)
        if parts.scheme not in ("http", "https"):
            raise FetchError(f"unsupported scheme: {parts.scheme or '(none)'}")
        if not parts.hostname:
            raise FetchError("URL has no host")

        ip = _resolve_pinned(parts.hostname)

        with _dns_pin(parts.hostname, ip):
            with httpx.Client(
                timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=transport
            ) as client:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("redirect with no Location header")
                        current = str(response.url.join(location))
                        continue

                    content_type = response.headers.get("content-type", "")
                    body = b""
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) >= MAX_BYTES:
                            body = body[:MAX_BYTES]
                            break
                    encoding = response.encoding or "utf-8"

        text = body.decode(encoding, errors="replace")
        if "html" in content_type:
            text = _html_to_text(text)
        return text[:MAX_TEXT_CHARS]

    raise FetchError("too many redirects")
