"""Web tools: HTML parsing, SSRF guard, fetch/search (network-free)."""

from __future__ import annotations

import pytest

from bandit_cli.tools import web


class FakeResponse:
    def __init__(self, text="", json_data=None, headers=None, *, is_redirect=False):
        self.text = text
        self._json = json_data or {}
        self.headers = headers or {}
        self.is_redirect = is_redirect

    def raise_for_status(self):
        return None

    def json(self):
        return self._json


# --- html_to_text ----------------------------------------------------------
def test_html_to_text_strips_tags_and_scripts():
    html = "<html><head><style>x{}</style></head><body><p>Hello</p><script>bad()</script> world</body></html>"
    assert web.html_to_text(html) == "Hello world"


# --- SSRF guard -------------------------------------------------------------
def test_assert_safe_url_rejects_non_http():
    with pytest.raises(web.SafetyError):
        web._assert_safe_url("file:///etc/passwd")


def test_assert_safe_url_rejects_loopback():
    with pytest.raises(web.SafetyError):
        web._assert_safe_url("http://localhost/secret")


def test_web_fetch_refuses_private_address():
    out = web.web_fetch("http://127.0.0.1:8080/admin")
    assert out.startswith("error:")
    assert "non-public" in out or "loopback" in out or "refusing" in out


def test_web_fetch_empty_url():
    assert web.web_fetch("") == "error: no url provided"


def test_web_fetch_rejects_redirect_to_private(monkeypatch):
    """Public URL that 302s to loopback must not bypass the SSRF guard."""
    checked: list[str] = []

    def fake_assert(url: str) -> None:
        checked.append(url)
        if "127.0.0.1" in url or "localhost" in url:
            raise web.SafetyError(f"refusing to fetch non-public address ({url})")

    calls = {"n": 0}

    def fake_get(url, **kwargs):
        assert kwargs.get("follow_redirects") is False
        calls["n"] += 1
        if calls["n"] == 1:
            return FakeResponse(
                is_redirect=True,
                headers={"location": "http://127.0.0.1/secret"},
            )
        raise AssertionError("should not fetch the private hop")

    monkeypatch.setattr(web, "_assert_safe_url", fake_assert)
    monkeypatch.setattr(web.httpx, "get", fake_get)
    out = web.web_fetch("https://evil.example/redirect")
    assert out.startswith("error:")
    assert any("127.0.0.1" in u for u in checked)


# --- web_fetch (mocked) -----------------------------------------------------
def test_web_fetch_returns_text(monkeypatch):
    monkeypatch.setattr(web, "_assert_safe_url", lambda url: None)
    monkeypatch.setattr(
        web.httpx,
        "get",
        lambda *a, **k: FakeResponse(
            text="<html><body><h1>Title</h1><p>Body text here.</p></body></html>",
            headers={"content-type": "text/html"},
        ),
    )
    out = web.web_fetch("https://example.com")
    assert "Title" in out and "Body text here." in out


def test_web_fetch_truncates(monkeypatch):
    monkeypatch.setattr(web, "_assert_safe_url", lambda url: None)
    monkeypatch.setattr(web, "FETCH_MAX_BYTES", 20)
    big = "word " * 100
    monkeypatch.setattr(
        web.httpx, "get", lambda *a, **k: FakeResponse(text=big, headers={"content-type": "text/plain"})
    )
    out = web.web_fetch("https://example.com")
    assert out.endswith("…[truncated]")


# --- DuckDuckGo parsing -----------------------------------------------------
DDG_HTML = """
<div class="result__body">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpython.org%2F&rut=x">Python.org</a>
  <a class="result__snippet" href="x">The official home of Python.</a>
</div>
<div class="result__body">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F">Docs</a>
  <a class="result__snippet" href="x">Python documentation.</a>
</div>
"""


def test_parse_duckduckgo():
    results = web.parse_duckduckgo(DDG_HTML)
    assert len(results) == 2
    assert results[0]["title"] == "Python.org"
    assert results[0]["url"] == "https://python.org/"
    assert "official home" in results[0]["snippet"]


def test_web_search_duckduckgo(monkeypatch):
    monkeypatch.setattr(web.httpx, "post", lambda *a, **k: FakeResponse(text=DDG_HTML))
    out = web.web_search("python", backend="duckduckgo")
    assert "Search results for: python" in out
    assert "python.org" in out


# --- Brave parsing ----------------------------------------------------------
BRAVE_JSON = {
    "web": {
        "results": [
            {"title": "Rust", "url": "https://rust-lang.org", "description": "A <b>language</b>"},
        ]
    }
}


def test_parse_brave():
    results = web.parse_brave(BRAVE_JSON)
    assert results == [
        {"title": "Rust", "url": "https://rust-lang.org", "snippet": "A language"}
    ]


def test_web_search_brave_requires_key():
    out = web.web_search("rust", backend="brave", brave_key="")
    assert "BRAVE_API_KEY" in out


def test_web_search_brave_with_key(monkeypatch):
    monkeypatch.setattr(web.httpx, "get", lambda *a, **k: FakeResponse(json_data=BRAVE_JSON))
    out = web.web_search("rust", backend="brave", brave_key="secret")
    assert "rust-lang.org" in out


def test_web_search_empty_query():
    assert web.web_search("") == "error: no query provided"
