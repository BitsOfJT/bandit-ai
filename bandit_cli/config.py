"""Defaults and configuration for Bandit.

Learning note
-------------
Configuration lives in one place so the rest of the app never hardcodes
magic strings. Environment variables let you change behavior without
editing code — a common Python pattern.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
# Ollama is the DEFAULT (local-first). OpenAI is an optional FALLBACK / opt-in.

DEFAULT_PROVIDER = "ollama"
FALLBACK_PROVIDER = "openai"

# OpenAI (or any OpenAI-compatible host: OpenRouter, Groq, etc.)
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get(
    "BANDIT_OPENAI_API_KEY", ""
)
DEFAULT_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Ollama (local) — default backend
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_OLLAMA_MODEL = os.environ.get("BANDIT_MODEL", "gemma4:e2b")

# Generation defaults (shared across providers)
DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_P = 0.9
DEFAULT_NUM_CTX = 2048  # mainly used by Ollama


# ---------------------------------------------------------------------------
# Tool calling
# ---------------------------------------------------------------------------
def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Tools are ON by default; toggle at runtime with /settings tools on|off.
DEFAULT_TOOLS_ENABLED = _env_bool("BANDIT_TOOLS", True)

# How many tool round-trips a single chat turn may make before giving up.
try:
    TOOL_MAX_ITERS = max(1, int(os.environ.get("BANDIT_TOOL_MAX_ITERS", "5")))
except ValueError:
    TOOL_MAX_ITERS = 5

# Web search backend: "duckduckgo" (key-free) or "brave" (needs BRAVE_API_KEY).
SEARCH_BACKENDS = ("duckduckgo", "brave")
DEFAULT_SEARCH_BACKEND = os.environ.get("BANDIT_SEARCH_BACKEND", "duckduckgo").lower()
if DEFAULT_SEARCH_BACKEND not in SEARCH_BACKENDS:
    DEFAULT_SEARCH_BACKEND = "duckduckgo"

BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "")

# web_fetch guards
try:
    FETCH_MAX_BYTES = max(1024, int(os.environ.get("BANDIT_FETCH_MAX_BYTES", "100000")))
except ValueError:
    FETCH_MAX_BYTES = 100_000
try:
    FETCH_TIMEOUT = float(os.environ.get("BANDIT_FETCH_TIMEOUT", "10"))
except ValueError:
    FETCH_TIMEOUT = 10.0

# Model names must look like real model IDs (security: no weird injection)
MODEL_NAME_RE = re.compile(r"^[a-zA-Z0-9_:./-]+$")

# Sessions directory under the user's home folder
SESSIONS_DIRNAME = ".bandit_ai/sessions"


@dataclass
class RuntimeConfig:
    """Mutable settings for the current CLI process."""

    provider: str = DEFAULT_PROVIDER
    openai_model: str = DEFAULT_OPENAI_MODEL
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    temperature: float = DEFAULT_TEMPERATURE
    top_p: float = DEFAULT_TOP_P
    num_ctx: int = DEFAULT_NUM_CTX
    persona: str = "hacker"
    tools_enabled: bool = DEFAULT_TOOLS_ENABLED
    search_backend: str = DEFAULT_SEARCH_BACKEND

    @property
    def model(self) -> str:
        """Active model name for the current provider."""
        if self.provider == "openai":
            return self.openai_model
        return self.ollama_model

    @model.setter
    def model(self, value: str) -> None:
        if self.provider == "openai":
            self.openai_model = value
        else:
            self.ollama_model = value
