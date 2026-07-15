"""Provider router: prefer Ollama, optionally use OpenAI.

Learning note
-------------
This is the "strategy picker". The rest of the CLI asks the router for
*the* active provider instead of caring which backend is underneath.
"""

from __future__ import annotations

from bandit_cli.config import DEFAULT_PROVIDER, FALLBACK_PROVIDER, RuntimeConfig
from bandit_cli.providers.base import Provider
from bandit_cli.providers.ollama import OllamaProvider
from bandit_cli.providers.openai_provider import OpenAIProvider


class ProviderRouter:
    """Owns both backends and tracks which one is active."""

    def __init__(self) -> None:
        self.openai = OpenAIProvider()
        self.ollama = OllamaProvider()
        self.active_name = DEFAULT_PROVIDER
        self.startup_notes: list[str] = []

    def get(self, name: str | None = None) -> Provider:
        key = name or self.active_name
        if key == "openai":
            return self.openai
        if key == "ollama":
            return self.ollama
        raise ValueError(f"Unknown provider: {key}")

    def set_active(self, name: str) -> tuple[bool, str]:
        """Switch providers. Returns (ok, message)."""
        if name not in ("openai", "ollama"):
            return False, f"Unknown provider '{name}'. Use openai or ollama."
        provider = self.get(name)
        ok, reason = provider.is_available()
        if not ok:
            return False, f"Can't switch to {name}: {reason}"
        self.active_name = name
        return True, f"Provider set to {name}."

    def resolve_startup(self, config: RuntimeConfig) -> Provider:
        """
        Default = Ollama. If Ollama isn't usable, fall back to OpenAI.

        Always records human-readable notes for the banner.
        """
        self.startup_notes.clear()

        ollama_ok, ollama_reason = self.ollama.is_available()
        if ollama_ok:
            self.active_name = DEFAULT_PROVIDER
            config.provider = DEFAULT_PROVIDER
            host = getattr(self.ollama, "host", "local Ollama")
            self.startup_notes.append(f"Ollama is up on {host} — default provider.")
            openai_ok, _ = self.openai.is_available()
            if openai_ok:
                self.startup_notes.append(
                    "OpenAI is also ready — switch with /provider openai."
                )
            return self.ollama

        self.startup_notes.append(
            f"Ollama not ready ({ollama_reason}). Trying OpenAI…"
        )

        openai_ok, openai_reason = self.openai.is_available()
        if openai_ok:
            self.active_name = FALLBACK_PROVIDER
            config.provider = FALLBACK_PROVIDER
            self.startup_notes.append("OpenAI API reachable — using as fallback.")
            return self.openai

        self.active_name = DEFAULT_PROVIDER
        config.provider = DEFAULT_PROVIDER
        self.startup_notes.append(
            f"OpenAI also unavailable ({openai_reason}). "
            "Start Ollama or set OPENAI_API_KEY, then retry."
        )
        return self.ollama
