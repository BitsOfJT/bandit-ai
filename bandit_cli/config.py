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
# OpenAI-compatible is the DEFAULT. Ollama is the local FALLBACK when
# OpenAI isn't reachable / free access isn't available yet.

DEFAULT_PROVIDER = "openai"
FALLBACK_PROVIDER = "ollama"

# OpenAI (or any OpenAI-compatible host: OpenRouter, Groq, etc.)
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or os.environ.get(
    "BANDIT_OPENAI_API_KEY", ""
)
# Cheap default model — swap via /model once free models appear.
DEFAULT_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Ollama (local)
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
DEFAULT_OLLAMA_MODEL = os.environ.get("BANDIT_MODEL", "gemma4:e2b")

# Generation defaults (shared across providers)
DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_P = 0.9
DEFAULT_NUM_CTX = 2048  # mainly used by Ollama

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
