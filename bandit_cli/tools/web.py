"""Web tools: fetch a page and search the web.

Learning note
-------------
These are the model's window to live information. Following the CLI's
security posture (no shell, no raw HTML), everything here is HTTP-only, HTML
is downgraded to plain text, and `web_fetch` refuses to hit private/loopback
addresses (an SSRF guard). Parsing lives in small pure functions so it can be
unit-tested against saved fixtures — same approach as `cloud.py`.
"""

from __future__ import annotations

import html
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from bandit_cli.config import (
    BRAVE_API_KEY,
    FETCH_MAX_BYTES,
    FETCH_TIMEOUT,
)

_USER_AGENT = "bandit-cli"
_DDG_HTML = "https://html.duckduckgo.com/html/"
_BRAVE_API = "https://api.search.brave.com/res/v1/web/search"
_MAX_RESULTS = 5


class SafetyError(ValueError):
    """Raised when a URL fails the SSRF / scheme checks."""


# ---------------------------------------------------------------------------
# HTML → text
# ---------------------------------------------------------------------------
class _TextExtractor(HTMLParser):
    """Collect visible text, skipping script/style/head-noise."""

    _SKIP = {"script", "style", "noscript", "head", "template"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self.parts.append(data.strip())


def html_to_text(raw: str) -> str:
    """Strip tags/scripts and collapse whitespace into readable text."""
    parser = _TextExtractor()
    try:
        parser.feed(raw)
    except Exception:
        # Malformed HTML shouldn't crash a tool call.
        pass
    text = " ".join(parser.parts)
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# SSRF guard
# ---------------------------------------------------------------------------
def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SafetyError("only http/https URLs are allowed")
    host = parsed.hostname
    if not host:
        raise SafetyError("URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise SafetyError(f"could not resolve host: {exc}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise SafetyError(f"refusing to fetch non-public address ({ip})")


# ---------------------------------------------------------------------------
# web_fetch
# ---------------------------------------------------------------------------
_MAX_REDIRECTS = 5


def _safe_get(url: str) -> httpx.Response:
    """GET a URL, validating every redirect hop against the SSRF guard.

    `follow_redirects=False` so a public host can't bounce us onto
    loopback/private/metadata addresses after the initial check.
    """
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        _assert_safe_url(current)
        resp = httpx.get(
            current,
            headers={"User-Agent": _USER_AGENT},
            timeout=FETCH_TIMEOUT,
            follow_redirects=False,
        )
        if resp.is_redirect:
            location = resp.headers.get("location")
            if not location:
                raise SafetyError("redirect with no Location header")
            current = str(httpx.URL(current).join(location))
            continue
        resp.raise_for_status()
        return resp
    raise SafetyError(f"too many redirects (>{_MAX_REDIRECTS})")


def web_fetch(url: str) -> str:
    """Fetch a public web page and return its text (truncated)."""
    url = (url or "").strip()
    if not url:
        return "error: no url provided"
    try:
        resp = _safe_get(url)
    except SafetyError as exc:
        return f"error: {exc}"
    except Exception as exc:
        return f"error fetching {url}: {exc}"

    body = resp.text[: FETCH_MAX_BYTES * 4]  # rough char cap before stripping
    ctype = resp.headers.get("content-type", "")
    text = html_to_text(body) if "html" in ctype or "<" in body[:200] else body.strip()
    if len(text) > FETCH_MAX_BYTES:
        text = text[:FETCH_MAX_BYTES] + " …[truncated]"
    return text or "(no readable text found)"


# ---------------------------------------------------------------------------
# web_search
# ---------------------------------------------------------------------------
def _decode_ddg_href(href: str) -> str:
    """DuckDuckGo wraps results in /l/?uddg=<encoded target>."""
    if "uddg=" in href:
        qs = parse_qs(urlparse(href).query)
        target = qs.get("uddg", [""])[0]
        if target:
            return unquote(target)
    if href.startswith("//"):
        return "https:" + href
    return href


def parse_duckduckgo(raw: str) -> list[dict]:
    """Extract {title, url, snippet} entries from DDG HTML results."""
    results: list[dict] = []
    blocks = raw.split("result__body")
    for block in blocks[1:]:
        a = re.search(r'result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not a:
            continue
        url = _decode_ddg_href(html.unescape(a.group(1)))
        title = html_to_text(a.group(2))
        sm = re.search(r'result__snippet"[^>]*>(.*?)</a>', block, re.S)
        snippet = html_to_text(sm.group(1)) if sm else ""
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= _MAX_RESULTS:
            break
    return results


def parse_brave(data: dict) -> list[dict]:
    """Extract {title, url, snippet} entries from a Brave API JSON payload."""
    results: list[dict] = []
    for item in (data.get("web", {}) or {}).get("results", []) or []:
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        snippet = html_to_text(item.get("description") or "")
        if title and url:
            results.append({"title": title, "url": url, "snippet": snippet})
        if len(results) >= _MAX_RESULTS:
            break
    return results


def format_results(query: str, results: list[dict]) -> str:
    """Render search results as compact text for the model."""
    if not results:
        return f"No results found for: {query}"
    lines = [f"Search results for: {query}"]
    for i, r in enumerate(results, start=1):
        lines.append(f"{i}. {r['title']}\n   {r['url']}\n   {r['snippet']}".rstrip())
    return "\n".join(lines)


def _search_duckduckgo(query: str) -> list[dict]:
    resp = httpx.post(
        _DDG_HTML,
        data={"q": query},
        headers={"User-Agent": _USER_AGENT},
        timeout=FETCH_TIMEOUT,
        follow_redirects=True,
    )
    resp.raise_for_status()
    return parse_duckduckgo(resp.text)


def _search_brave(query: str, api_key: str) -> list[dict]:
    resp = httpx.get(
        _BRAVE_API,
        params={"q": query, "count": _MAX_RESULTS},
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
        },
        timeout=FETCH_TIMEOUT,
    )
    resp.raise_for_status()
    return parse_brave(resp.json())


def web_search(query: str, *, backend: str = "duckduckgo", brave_key: str | None = None) -> str:
    """Search the web and return a compact ranked list of results."""
    query = (query or "").strip()
    if not query:
        return "error: no query provided"
    key = BRAVE_API_KEY if brave_key is None else brave_key
    try:
        if backend == "brave":
            if not key:
                return "error: brave backend selected but BRAVE_API_KEY is not set"
            results = _search_brave(query, key)
        else:
            results = _search_duckduckgo(query)
    except Exception as exc:
        return f"error searching for {query!r}: {exc}"
    return format_results(query, results)
