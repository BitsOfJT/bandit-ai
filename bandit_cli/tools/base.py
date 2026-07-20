"""Tool primitive.

Learning note
-------------
A "tool" (a.k.a. function call) is just a named function the model may ask us
to run. We describe it with a JSON schema so the model knows the arguments,
run it locally, and feed the text result back into the conversation.

Both Ollama and OpenAI accept the same schema shape:
    {"type": "function", "function": {name, description, parameters}}
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class Tool:
    """One callable capability exposed to the model."""

    name: str
    description: str
    parameters: dict = field(default_factory=dict)
    func: Callable[..., str] = field(default=lambda **_: "")

    def to_schema(self) -> dict:
        """The provider-agnostic function schema for this tool."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def run(self, args: dict) -> str:
        """Execute the tool with keyword args, always returning text."""
        return self.func(**args)
