"""Provider router: prefer OpenAI, fall back to Ollama.

Learning note
-------------
This is the "strategy picker". The rest of the CLI asks the router for
*the* active provider instead of caring which backend is underneath.
"""

from __future__ import annotations

from bandit_cli.config import FALLBACK_PROVIDER, RuntimeConfig
from bandit_cli.providers.base import Provider
from bandit_cli.providers.ollama import OllamaProvider
from bandit_cli.providers.openai_provider import OpenAIProvider


class ProviderRouter:
    """Owns both backends and tracks which one is active."""

    def __init__(self) -> None:
        self.openai = OpenAIProvider()
        self.ollama = OllamaProvider()
        self.active_name = "openai"
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
        Default = OpenAI. If OpenAI isn't usable, fall back to Ollama.

        Always records human-readable notes for the banner.
        """
        self.startup_notes.clear()

        openai_ok, openai_reason = self.openai.is_available()
        if openai_ok:
            self.active_name = "openai"
            config.provider = "openai"
            self.startup_notes.append(
                "OpenAI API reachable — using it as the default provider."
            )
            return self.openai

        self.startup_notes.append(
            f"OpenAI not ready ({openai_reason}). Falling back to Ollama."
        )

        ollama_ok, ollama_reason = self.ollama.is_available()
        if ollama_ok:
            self.active_name = FALLBACK_PROVIDER
            config.provider = FALLBACK_PROVIDER
            host = getattr(self.ollama, "host", "local Ollama")
            self.startup_notes.append(f"Ollama is up on {host}.")
            return self.ollama

        # Neither works — still default the *label* to openai so /provider
        # and error hints point at the intended primary, but mark ollama
        # as the attempted fallback for local tips.
        self.active_name = "openai"
        config.provider = "openai"
        self.startup_notes.append(
            f"Ollama also unavailable ({ollama_reason}). "
            "Set OPENAI_API_KEY or start Ollama, then retry."
        )
        return self.openai
