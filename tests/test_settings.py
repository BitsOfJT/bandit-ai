"""/settings and /tools command behavior."""

from __future__ import annotations

from bandit_cli.__main__ import BanditApp


def _app():
    app = BanditApp()
    # Avoid network probes from provider.supports_tools during these tests.
    app._tools_cap_cache[(app.router.get().name, app.config.model)] = False
    return app


def test_settings_toggle_tools_off_and_on():
    app = _app()
    assert app.config.tools_enabled is True  # on by default
    app.cmd_settings("tools off")
    assert app.config.tools_enabled is False
    app.cmd_settings("tools on")
    assert app.config.tools_enabled is True


def test_settings_switch_search_backend():
    app = _app()
    app.cmd_settings("search brave")
    assert app.config.search_backend == "brave"
    app.cmd_settings("search duckduckgo")
    assert app.config.search_backend == "duckduckgo"


def test_settings_rejects_unknown_backend():
    app = _app()
    before = app.config.search_backend
    app.cmd_settings("search bing")
    assert app.config.search_backend == before


def test_settings_show_does_not_crash():
    app = _app()
    app.cmd_settings("")  # just prints current settings


def test_tools_command_lists_web_tools():
    app = _app()
    # Should not raise and registry should hold the web tools.
    app.cmd_tools("")
    assert set(app.tools.names()) == {"web_search", "web_fetch"}


def test_tools_inactive_when_disabled():
    app = _app()
    app.config.tools_enabled = False
    assert app._tools_active() is False
