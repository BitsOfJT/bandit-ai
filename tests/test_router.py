"""Tests for provider router startup selection."""

from bandit_cli.config import RuntimeConfig
from bandit_cli.providers.router import ProviderRouter


class _FakeProvider:
    def __init__(self, name: str, ok: bool, reason: str = "") -> None:
        self.name = name
        self._ok = ok
        self._reason = reason

    def is_available(self):
        return self._ok, self._reason


def test_router_prefers_ollama_when_available():
    router = ProviderRouter()
    router.openai = _FakeProvider("openai", True)  # type: ignore[assignment]
    router.ollama = _FakeProvider("ollama", True)  # type: ignore[assignment]
    config = RuntimeConfig()
    provider = router.resolve_startup(config)
    assert provider.name == "ollama"
    assert config.provider == "ollama"
    assert any("default provider" in n for n in router.startup_notes)


def test_router_falls_back_to_openai():
    router = ProviderRouter()
    router.openai = _FakeProvider("openai", True)  # type: ignore[assignment]
    router.ollama = _FakeProvider("ollama", False, "not running")  # type: ignore[assignment]
    config = RuntimeConfig()
    provider = router.resolve_startup(config)
    assert provider.name == "openai"
    assert config.provider == "openai"
    assert any("Trying OpenAI" in n for n in router.startup_notes)
