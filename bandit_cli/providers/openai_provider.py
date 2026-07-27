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
from bandit_cli.providers.base import ChatChunk, ChatOptions, ModelInfo, ToolCall
from bandit_cli.session import Message


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
        tools: list[dict] | None = None,
    ) -> Iterator[ChatChunk]:
        client = self._get_client()
        payload = [_to_openai_message(m) for m in messages]
        kwargs = {
            "model": model,
            "messages": payload,
            "temperature": options.temperature,
            "top_p": options.top_p,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
        stream = client.chat.completions.create(**kwargs)  # type: ignore[arg-type]

        # OpenAI streams tool-call *fragments* keyed by index — arguments
        # arrive in pieces across chunks and must be concatenated, so we
        # only know the full tool_calls once the stream ends.
        accumulator: dict[int, dict] = {}
        for chunk in stream:
            choice = chunk.choices[0] if chunk.choices else None
            if choice is None:
                continue
            delta = choice.delta
            token = delta.content or ""
            for tc in delta.tool_calls or []:
                entry = accumulator.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    entry["id"] = tc.id
                if tc.function and tc.function.name:
                    entry["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    entry["arguments"] += tc.function.arguments
            if token:
                yield ChatChunk(content=token)

        if accumulator:
            tool_calls = []
            for entry in accumulator.values():
                try:
                    args = json.loads(entry["arguments"]) if entry["arguments"] else {}
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append(ToolCall(id=entry["id"], name=entry["name"], arguments=args))
            yield ChatChunk(tool_calls=tool_calls)

    def supports_pull(self) -> bool:
        return False


def _to_openai_message(m: Message) -> dict:
    """Translate a session Message into OpenAI's chat.completions shape."""
    payload: dict = {"role": m.role, "content": m.content}
    if m.role == "assistant" and m.tool_calls:
        payload["tool_calls"] = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])},
            }
            for tc in m.tool_calls
        ]
    if m.role == "tool":
        payload["tool_call_id"] = m.tool_call_id
    return payload
