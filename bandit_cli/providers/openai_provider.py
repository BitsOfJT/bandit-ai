"""OpenAI-compatible provider — Bandit's DEFAULT backend.

Learning note
-------------
The official `openai` package talks to api.openai.com, but also works with
any server that speaks the same HTTP shape if you change `base_url`
(OpenRouter, Groq, Azure, local vLLM, etc.).

Free access reality (mid-2026): OpenAI does not guarantee a permanent free
chat tier. Bandit still defaults here so the day your key / free quota works,
you're already connected. Until then the router falls back to Ollama.
"""

from __future__ import annotations

from collections.abc import Iterator

from openai import APIError, AuthenticationError, OpenAI, RateLimitError

from bandit_cli.config import OPENAI_API_KEY, OPENAI_BASE_URL
from bandit_cli.providers.base import ChatOptions, ModelInfo
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
    ) -> Iterator[str]:
        client = self._get_client()
        payload = [{"role": m.role, "content": m.content} for m in messages]
        stream = client.chat.completions.create(
            model=model,
            messages=payload,  # type: ignore[arg-type]
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

    def supports_pull(self) -> bool:
        return False
