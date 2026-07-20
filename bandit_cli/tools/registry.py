"""Tool registry: hold the tools, expose schemas, dispatch calls safely.

Learning note
-------------
The registry is the single place the agent loop talks to. It never trusts the
model blindly: unknown tools and bad arguments turn into text errors the model
can read and recover from, rather than crashing the turn.
"""

from __future__ import annotations

from bandit_cli.tools.base import Tool
from bandit_cli.tools.web import web_fetch, web_search


class ToolRegistry:
    """Owns the available tools and which are enabled."""

    def __init__(self, tools: list[Tool]) -> None:
        self._tools: dict[str, Tool] = {t.name: t for t in tools}
        # All tools start enabled; the whole feature is gated elsewhere.
        self._enabled: set[str] = set(self._tools)

    def names(self) -> list[str]:
        return list(self._tools)

    def all_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def is_enabled(self, name: str) -> bool:
        return name in self._enabled

    def enabled_tools(self) -> list[Tool]:
        return [t for n, t in self._tools.items() if n in self._enabled]

    def schemas(self) -> list[dict]:
        return [t.to_schema() for t in self.enabled_tools()]

    def dispatch(self, name: str, args: dict) -> str:
        tool = self._tools.get(name)
        if tool is None:
            return f"error: unknown tool '{name}'"
        if name not in self._enabled:
            return f"error: tool '{name}' is disabled"
        if not isinstance(args, dict):
            return f"error: tool '{name}' expects an arguments object"
        try:
            return tool.run(args)
        except TypeError as exc:
            return f"error: bad arguments for '{name}': {exc}"
        except Exception as exc:  # tools must never crash the turn
            return f"error running '{name}': {exc}"


def build_default_registry(config) -> ToolRegistry:
    """Create the built-in web tools, honoring live config for search backend."""
    search = Tool(
        name="web_search",
        description=(
            "Search the web for current information. Returns a ranked list of "
            "result titles, URLs, and snippets."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query.",
                }
            },
            "required": ["query"],
        },
        func=lambda query: web_search(query, backend=config.search_backend),
    )
    fetch = Tool(
        name="web_fetch",
        description=(
            "Fetch a single public web page (http/https) and return its text "
            "content. Use after web_search to read a specific result."
        ),
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute http(s) URL to fetch.",
                }
            },
            "required": ["url"],
        },
        func=lambda url: web_fetch(url),
    )
    return ToolRegistry([search, fetch])
