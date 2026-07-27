"""Tests for the web_fetch tool's SSRF guards."""

from __future__ import annotations

import socket

import httpx
import pytest

from bandit_cli import tools
from bandit_cli.tools import FetchError, fetch_url


def _fake_getaddrinfo(host_to_ip: dict[str, str]):
    """Build a socket.getaddrinfo replacement that resolves fixed hosts."""
    real = socket.getaddrinfo

    def fake(host, port, family=0, type=0, proto=0, flags=0):
        if host in host_to_ip:
            return real(host_to_ip[host], port, family, type, proto, flags)
        return real(host, port, family, type, proto, flags)

    return fake


def test_rejects_file_scheme():
    with pytest.raises(FetchError, match="scheme"):
        fetch_url("file:///etc/passwd")


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",  # loopback
        "10.1.2.3",  # private
        "169.254.169.254",  # link-local / cloud metadata
        "224.0.0.1",  # multicast
        "100.64.0.1",  # CGNAT / RFC 6598 (e.g. AWS PrivateLink ENIs)
    ],
)
def test_blocks_internal_addresses(monkeypatch, ip):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"internal.test": ip}))
    with pytest.raises(FetchError, match="blocked"):
        fetch_url("http://internal.test/")


def test_blocks_redirect_to_private(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        _fake_getaddrinfo({"public.test": "93.184.216.34", "internal.test": "10.0.0.5"}),
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "public.test":
            return httpx.Response(302, headers={"location": "http://internal.test/secret"})
        raise AssertionError("should not reach the redirect target")

    with pytest.raises(FetchError, match="blocked"):
        fetch_url("http://public.test/", transport=httpx.MockTransport(handler))


def test_enforces_size_cap(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"public.test": "93.184.216.34"}))
    monkeypatch.setattr(tools, "MAX_BYTES", 50)
    monkeypatch.setattr(tools, "MAX_TEXT_CHARS", 1000)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"x" * 500)

    text = fetch_url("http://public.test/", transport=httpx.MockTransport(handler))
    assert len(text) == 50


def test_allows_normal_fetch(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo({"public.test": "93.184.216.34"}))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            content=b"<html><body><p>Hello world</p></body></html>",
        )

    text = fetch_url("http://public.test/", transport=httpx.MockTransport(handler))
    assert text == "Hello world"
