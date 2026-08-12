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
    # True if this looks usable for chat (not embedding-only).
    chat_capable: bool = True


@dataclass
class ChatOptions:
    temperature: float = 0.7
    top_p: float = 0.9
    num_ctx: int = 2048


@dataclass
class ToolCall:
    """One tool invocation the model asked for."""

    id: str
    name: str
    arguments: dict


@dataclass
class ChatChunk:
    """One piece of a streamed chat reply."""

    content: str = ""  # token text; "" if none this chunk
    tool_calls: list[ToolCall] = field(default_factory=list)  # only on the final chunk, if any


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
        tools: list[dict] | None = None,
    ) -> Iterator[ChatChunk]:
        """Yield reply chunks as they arrive; tool_calls populated on the last one."""
        ...

    def supports_pull(self) -> bool:
        """True if /pull makes sense for this backend."""
        ...
