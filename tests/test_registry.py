"""Tool registry: schema generation and safe dispatch."""

from __future__ import annotations

from bandit_cli.config import RuntimeConfig
from bandit_cli.tools.base import Tool
from bandit_cli.tools.registry import ToolRegistry, build_default_registry


def _echo_registry():
    echo = Tool(
        name="echo",
        description="echo",
        parameters={"type": "object", "properties": {"text": {"type": "string"}}},
        func=lambda text: f"echoed:{text}",
    )
    return ToolRegistry([echo])


def test_default_registry_has_web_tools():
    reg = build_default_registry(RuntimeConfig())
    assert set(reg.names()) == {"web_search", "web_fetch"}
    schemas = reg.schemas()
    assert all(s["type"] == "function" for s in schemas)
    names = {s["function"]["name"] for s in schemas}
    assert names == {"web_search", "web_fetch"}


def test_dispatch_runs_tool():
    reg = _echo_registry()
    assert reg.dispatch("echo", {"text": "hi"}) == "echoed:hi"


def test_dispatch_unknown_tool():
    reg = _echo_registry()
    assert "unknown tool" in reg.dispatch("nope", {})


def test_dispatch_bad_arguments():
    reg = _echo_registry()
    # Missing required kwarg -> TypeError -> friendly text error.
    out = reg.dispatch("echo", {"wrong": "x"})
    assert out.startswith("error: bad arguments")


def test_dispatch_non_dict_args():
    reg = _echo_registry()
    assert "arguments object" in reg.dispatch("echo", ["not", "a", "dict"])


def test_dispatch_tool_exception_is_caught():
    boom = Tool(name="boom", description="", func=lambda: (_ for _ in ()).throw(RuntimeError("kaboom")))
    reg = ToolRegistry([boom])
    out = reg.dispatch("boom", {})
    assert "error running 'boom'" in out and "kaboom" in out
