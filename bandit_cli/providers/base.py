"""Shared provider interface.

Learning note
-------------
A Protocol (typing.Protocol) is Python's duck-typing interface: any class
with these methods "counts as" a Provider. That lets OpenAI and Ollama
swap freely without a shared base class hierarchy.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol

from bandit_cli.session import Message


@dataclass
class ModelInfo:
    """A model the provider can run."""

    name: str
    size_bytes: int = 0
    parameter_size: str = ""
    capabilities: list[str] = field(default_factory=list)
    # True if this looks usable for chat (not embedding-only).
    chat_capable: bool = True


@dataclass
class ChatOptions:
    temperature: float = 0.7
    top_p: float = 0.9
    num_ctx: int = 2048


@dataclass
class ToolCall:
    """A single tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict = field(default_factory=dict)


@dataclass
class ChatTurn:
    """One non-streamed model turn: either final text, or tool requests."""

    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


class Provider(Protocol):
    """Anything that can list models and stream a chat reply."""

    name: str  # "openai" or "ollama"

    def is_available(self) -> tuple[bool, str]:
        """Return (ok, reason). reason is empty when ok is True."""
        ...

    def list_models(self) -> list[ModelInfo]:
        ...

    def chat_stream(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
    ) -> Iterator[str]:
        """Yield reply tokens as they arrive."""
        ...

    def chat_once(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
        tools: list[dict],
    ) -> ChatTurn:
        """One non-streamed turn that may return tool calls (agent loop)."""
        ...

    def supports_tools(self, model: str) -> bool:
        """True if this model can be given tool schemas."""
        ...

    def supports_pull(self) -> bool:
        """True if /pull makes sense for this backend."""
        ...
