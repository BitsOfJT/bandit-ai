"""OpenAI-compatible provider — optional cloud / compatible-API backend.

Learning note
-------------
The official `openai` package talks to api.openai.com, but also works with
any server that speaks the same HTTP shape if you change `base_url`
(OpenRouter, Groq, Azure, local vLLM, etc.).

Bandit's default is local Ollama; switch here with `/provider openai` when
you have a key (or point OPENAI_BASE_URL at another compatible host).
"""

from __future__ import annotations

import json
from collections.abc import Iterator

from openai import APIError, AuthenticationError, OpenAI, RateLimitError

from bandit_cli.config import OPENAI_API_KEY, OPENAI_BASE_URL
from bandit_cli.providers.base import ChatOptions, ChatTurn, ModelInfo, ToolCall
from bandit_cli.session import Message


def _to_openai_messages(messages: list[Message]) -> list[dict]:
    """Serialize our Message list into OpenAI's chat wire format."""
    out: list[dict] = []
    for m in messages:
        if m.role == "tool":
            out.append(
                {
                    "role": "tool",
                    "tool_call_id": m.tool_call_id,
                    "content": m.content,
                }
            )
            continue
        entry: dict = {"role": m.role, "content": m.content}
        if m.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": tc.get("name", ""),
                        "arguments": json.dumps(tc.get("arguments") or {}),
                    },
                }
                for tc in m.tool_calls
            ]
        out.append(entry)
    return out


class OpenAIProvider:
    """Chat via the OpenAI Python SDK (OpenAI-compatible)."""

    name = "openai"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else OPENAI_API_KEY).strip()
        self.base_url = (base_url or OPENAI_BASE_URL).rstrip("/")
        self._client: OpenAI | None = None

    def _get_client(self) -> OpenAI:
        if self._client is None:
            if not self.api_key:
                raise RuntimeError(
                    "No OPENAI_API_KEY set. Export it, or switch with /provider ollama."
                )
            self._client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        return self._client

    def is_available(self) -> tuple[bool, str]:
        """Probe the API with a lightweight models.list call."""
        if not self.api_key:
            return False, "OPENAI_API_KEY not set"
        try:
            client = self._get_client()
            # models.list is cheap and confirms the key + endpoint work.
            client.models.list()
            return True, ""
        except AuthenticationError as exc:
            return False, f"auth failed: {exc}"
        except RateLimitError as exc:
            # Rate limit still means the endpoint is "live" — treat as available.
            return True, f"rate-limited (still usable): {exc}"
        except APIError as exc:
            # Billing / free-tier "not supported" often shows up here.
            return False, str(exc)
        except Exception as exc:  # network, etc.
            return False, str(exc)

    def list_models(self) -> list[ModelInfo]:
        client = self._get_client()
        models: list[ModelInfo] = []
        for m in client.models.list():
            mid = getattr(m, "id", None) or ""
            if not mid:
                continue
            # Prefer chat-ish ids; still list everything so /models is useful.
            models.append(ModelInfo(name=mid, chat_capable=True))
        models.sort(key=lambda m: m.name)
        return models

    def chat_stream(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
    ) -> Iterator[str]:
        client = self._get_client()
        stream = client.chat.completions.create(
            model=model,
            messages=_to_openai_messages(messages),  # type: ignore[arg-type]
            temperature=options.temperature,
            top_p=options.top_p,
            stream=True,
        )
        for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if choice is None:
                continue
            delta = choice.delta
            token = delta.content or ""
            if token:
                yield token

    def chat_once(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
        tools: list[dict],
    ) -> ChatTurn:
        client = self._get_client()
        response = client.chat.completions.create(
            model=model,
            messages=_to_openai_messages(messages),  # type: ignore[arg-type]
            temperature=options.temperature,
            top_p=options.top_p,
            tools=tools or None,  # type: ignore[arg-type]
            stream=False,
        )
        choice = response.choices[0] if response.choices else None
        if choice is None:
            return ChatTurn()
        message = choice.message
        content = message.content or ""
        calls: list[ToolCall] = []
        for tc in message.tool_calls or []:
            fn = tc.function
            try:
                args = json.loads(fn.arguments) if fn.arguments else {}
            except (ValueError, TypeError):
                args = {}
            if not isinstance(args, dict):
                args = {}
            calls.append(ToolCall(id=tc.id or "", name=fn.name or "", arguments=args))
        return ChatTurn(content=content, tool_calls=calls)

    def supports_tools(self, model: str) -> bool:
        # OpenAI-compatible chat models generally support function calling.
        return True

    def supports_pull(self) -> bool:
        return False
