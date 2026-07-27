"""Ollama provider — Bandit's DEFAULT local backend.

Learning note
-------------
Ollama runs models on your machine at http://127.0.0.1:11434. The official
`ollama` Python package wraps /api/chat, /api/tags, and /api/pull for us.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import ollama

from bandit_cli.config import OLLAMA_HOST
from bandit_cli.providers.base import ChatChunk, ChatOptions, ModelInfo, ToolCall
from bandit_cli.session import Message


class OllamaProvider:
    """Chat via a local Ollama instance."""

    name = "ollama"

    def __init__(self, host: str | None = None) -> None:
        self.host = (host or OLLAMA_HOST).rstrip("/")
        # The ollama package reads OLLAMA_HOST from the environment; we also
        # pass host explicitly on Client for clarity.
        self._client = ollama.Client(host=self.host)

    def is_available(self) -> tuple[bool, str]:
        try:
            # A quick tags call proves the daemon is up.
            self._client.list()
            return True, ""
        except Exception as exc:
            return False, f"can't reach Ollama on {self.host}: {exc}"

    def list_models(self) -> list[ModelInfo]:
        response = self._client.list()
        # ollama>=0.3 returns an object with .models; tolerate dict shapes too.
        raw_models = getattr(response, "models", None)
        if raw_models is None and isinstance(response, dict):
            raw_models = response.get("models", [])
        raw_models = raw_models or []

        models: list[ModelInfo] = []
        for m in raw_models:
            name = getattr(m, "model", None) or getattr(m, "name", None)
            if name is None and isinstance(m, dict):
                name = m.get("model") or m.get("name")
            if not name:
                continue
            size = getattr(m, "size", 0) or (m.get("size", 0) if isinstance(m, dict) else 0)
            details = getattr(m, "details", None)
            param = ""
            if details is not None:
                param = getattr(details, "parameter_size", "") or ""
            elif isinstance(m, dict):
                param = (m.get("details") or {}).get("parameter_size", "")
            caps = getattr(m, "capabilities", None) or []
            if isinstance(m, dict):
                caps = m.get("capabilities") or caps
            chat_capable = _is_chat_capable(list(caps) if caps else [])
            models.append(
                ModelInfo(
                    name=str(name),
                    size_bytes=int(size or 0),
                    parameter_size=str(param or ""),
                    capabilities=list(caps) if caps else [],
                    chat_capable=chat_capable,
                )
            )
        models.sort(key=lambda x: x.name)
        return models

    def chat_stream(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
        tools: list[dict] | None = None,
    ) -> Iterator[ChatChunk]:
        payload = [_to_ollama_message(m) for m in messages]
        kwargs = {
            "model": model,
            "messages": payload,
            "stream": True,
            "options": {
                "temperature": options.temperature,
                "top_p": options.top_p,
                "num_ctx": options.num_ctx,
            },
        }
        if tools:
            kwargs["tools"] = tools
        stream = self._client.chat(**kwargs)
        for chunk in stream:
            # chunk.message.content holds the next token(s); tool_calls (if
            # any) arrive fully formed on the same terminal chunk.
            message = getattr(chunk, "message", None)
            if message is None and isinstance(chunk, dict):
                message = chunk.get("message") or {}
                token = message.get("content") or ""
                raw_tool_calls = message.get("tool_calls") or []
            else:
                token = getattr(message, "content", "") or ""
                raw_tool_calls = getattr(message, "tool_calls", None) or []

            tool_calls = [
                ToolCall(id=f"call_{i}", name=_tc_name(tc), arguments=_tc_arguments(tc))
                for i, tc in enumerate(raw_tool_calls)
            ]
            if token or tool_calls:
                yield ChatChunk(content=token, tool_calls=tool_calls)

    def supports_pull(self) -> bool:
        return True

    def pull(self, model: str):
        """Yield progress dicts from ollama.pull(stream=True)."""
        return self._client.pull(model, stream=True)

    def preload(self, model: str) -> None:
        """Best-effort warm-up so the first chat isn't cold."""
        try:
            httpx.post(
                f"{self.host}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": "10m"},
                timeout=60.0,
            )
        except Exception:
            # Warm-up is optional — ignore failures.
            pass

    def model_capabilities(self, model: str) -> list[str]:
        """
        Per-model capabilities (e.g. "tools") via /api/show.

        list_models()'s /api/tags call doesn't include capabilities in this
        ollama package version — only /api/show does — so this is a separate
        lookup. Empty on any error (unknown model, cloud model 404, etc.), so
        callers fail closed and don't send `tools` to a model we're unsure about.
        """
        try:
            info = self._client.show(model)
        except Exception:
            return []
        caps = getattr(info, "capabilities", None) or []
        return list(caps)


def _is_chat_capable(capabilities: list[str]) -> bool:
    """Embedding-only models shouldn't be offered as chat targets."""
    if not capabilities:
        return True  # older Ollama omits the field — assume usable
    chat_ish = {"completion", "chat", "vision", "thinking", "tools"}
    return any(c in chat_ish for c in capabilities)


def _to_ollama_message(m: Message) -> dict:
    """Translate a session Message into the shape ollama.Client.chat() wants."""
    payload: dict = {"role": m.role, "content": m.content}
    if m.role == "assistant" and m.tool_calls:
        payload["tool_calls"] = [
            {"function": {"name": tc["name"], "arguments": tc["arguments"]}}
            for tc in m.tool_calls
        ]
    if m.role == "tool":
        # ponytail: only one tool exists (web_fetch), so hardcode its name
        # rather than threading a tool-name field through Message for it.
        payload["tool_name"] = "web_fetch"
    return payload


def _tc_name(tc) -> str:
    fn = getattr(tc, "function", None)
    if fn is None and isinstance(tc, dict):
        fn = tc.get("function") or {}
    if isinstance(fn, dict):
        return fn.get("name", "") or ""
    return getattr(fn, "name", "") or ""


def _tc_arguments(tc) -> dict:
    fn = getattr(tc, "function", None)
    if fn is None and isinstance(tc, dict):
        fn = tc.get("function") or {}
    if isinstance(fn, dict):
        return dict(fn.get("arguments") or {})
    return dict(getattr(fn, "arguments", None) or {})
