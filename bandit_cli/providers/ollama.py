"""Ollama provider — Bandit's DEFAULT local backend.

Learning note
-------------
Ollama runs models on your machine at http://127.0.0.1:11434. The official
`ollama` Python package wraps /api/chat, /api/tags, and /api/pull for us.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator

import httpx
import ollama

from bandit_cli.config import OLLAMA_HOST
from bandit_cli.providers.base import ChatOptions, ChatTurn, ModelInfo, ToolCall
from bandit_cli.session import Message


def _to_ollama_messages(messages: list[Message]) -> list[dict]:
    """Serialize our Message list into Ollama's chat wire format."""
    out: list[dict] = []
    for m in messages:
        if m.role == "tool":
            entry: dict = {"role": "tool", "content": m.content}
            # Ollama labels tool results with tool_name (not tool_call_id).
            if m.tool_name:
                entry["tool_name"] = m.tool_name
            out.append(entry)
            continue
        entry = {"role": m.role, "content": m.content}
        if m.tool_calls:
            entry["tool_calls"] = [
                {
                    "function": {
                        "name": tc.get("name", ""),
                        "arguments": tc.get("arguments") or {},
                    }
                }
                for tc in m.tool_calls
            ]
        out.append(entry)
    return out


def _parse_tool_arguments(raw) -> dict:
    """Normalize tool arguments to a dict (Ollama may send a JSON string)."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


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
    ) -> Iterator[str]:
        stream = self._client.chat(
            model=model,
            messages=_to_ollama_messages(messages),
            stream=True,
            options={
                "temperature": options.temperature,
                "top_p": options.top_p,
                "num_ctx": options.num_ctx,
            },
        )
        for chunk in stream:
            # chunk.message.content holds the next token(s)
            message = getattr(chunk, "message", None)
            if message is None and isinstance(chunk, dict):
                message = chunk.get("message") or {}
                token = message.get("content") or ""
            else:
                token = getattr(message, "content", "") or ""
            if token:
                yield token

    def chat_once(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
        tools: list[dict],
    ) -> ChatTurn:
        response = self._client.chat(
            model=model,
            messages=_to_ollama_messages(messages),
            tools=tools or None,
            stream=False,
            options={
                "temperature": options.temperature,
                "top_p": options.top_p,
                "num_ctx": options.num_ctx,
            },
        )
        message = getattr(response, "message", None)
        if message is None and isinstance(response, dict):
            message = response.get("message") or {}

        content = _get(message, "content", "") or ""
        raw_calls = _get(message, "tool_calls", None) or []
        calls: list[ToolCall] = []
        for rc in raw_calls:
            fn = _get(rc, "function", {}) or {}
            name = _get(fn, "name", "") or ""
            args = _parse_tool_arguments(_get(fn, "arguments", {}) or {})
            if name:
                calls.append(
                    ToolCall(id=uuid.uuid4().hex[:8], name=name, arguments=args)
                )
        return ChatTurn(content=content, tool_calls=calls)

    def supports_tools(self, model: str) -> bool:
        try:
            info = self._client.show(model)
        except Exception:
            return False
        caps = _get(info, "capabilities", None) or []
        return "tools" in list(caps)

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


def _get(obj, key, default=None):
    """Read `key` from an object attribute or a dict, tolerating both shapes."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _is_chat_capable(capabilities: list[str]) -> bool:
    """Embedding-only models shouldn't be offered as chat targets."""
    if not capabilities:
        return True  # older Ollama omits the field — assume usable
    chat_ish = {"completion", "chat", "vision", "thinking", "tools"}
    return any(c in chat_ish for c in capabilities)
