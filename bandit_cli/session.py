"""Chat session persistence.

Learning note
-------------
A `@dataclass` is a Python feature that auto-builds `__init__` and friends
from typed fields. We convert them to/from JSON so chats survive restarts.

Sessions live at:  ~/.bandit_ai/sessions/<id>.json
Files are written with mode 0o600 (owner read/write only) — good practice
for anything that might contain private conversation text.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Message:
    """One turn in a conversation."""

    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    tool_call_id: str = ""  # set on role="tool" messages
    tool_calls: list[dict] = field(default_factory=list)  # set on assistant messages that requested tools


@dataclass
class Session:
    """A saved chat, including model settings and message history."""

    id: str
    title: str
    messages: list[Message] = field(default_factory=list)
    system_prompt: str = ""
    model: str = ""
    provider: str = "openai"
    temperature: float = 0.7
    top_p: float = 0.9
    num_ctx: int = 2048
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        """Turn this Session into a plain dict suitable for json.dump."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> Session:
        """Rebuild a Session from JSON data."""
        msgs = [Message(**m) for m in data.get("messages", [])]
        return cls(
            id=data["id"],
            title=data.get("title", "New Scavenge Session"),
            messages=msgs,
            system_prompt=data.get("system_prompt", ""),
            model=data.get("model", ""),
            provider=data.get("provider", "openai"),
            temperature=float(data.get("temperature", 0.7)),
            top_p=float(data.get("top_p", 0.9)),
            num_ctx=int(data.get("num_ctx", 2048)),
            created_at=float(data.get("created_at", time.time())),
        )


def sessions_dir() -> Path:
    """Return ~/.bandit_ai/sessions, creating it if needed."""
    path = Path.home() / ".bandit_ai" / "sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def new_session_id() -> str:
    """Create a unique-ish session id like chat-1710000000000-a1b2c3d4."""
    ms = int(time.time() * 1000)
    return f"chat-{ms}-{uuid.uuid4().hex[:8]}"


def save_session(session: Session) -> Path:
    """Write a session to disk. Returns the file path."""
    path = sessions_dir() / f"{session.id}.json"
    payload = json.dumps(session.to_dict(), indent=2)
    # Write then chmod — atomic-enough for a local CLI tool.
    path.write_text(payload, encoding="utf-8")
    os.chmod(path, 0o600)
    return path


def load_session(session_id: str) -> Session:
    """Load one session by id. Raises FileNotFoundError if missing."""
    path = sessions_dir() / f"{session_id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return Session.from_dict(data)


def list_sessions() -> list[Session]:
    """Return all sessions, newest first. Skips corrupt files."""
    found: list[Session] = []
    for path in sessions_dir().glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            found.append(Session.from_dict(data))
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError):
            # Corrupt/unreadable files are skipped so one bad file
            # never breaks the whole /sessions list.
            continue
    found.sort(key=lambda s: s.created_at, reverse=True)
    return found


def title_from_messages(messages: list[Message]) -> str:
    """Use the first user message as the session title (trimmed)."""
    for msg in messages:
        if msg.role == "user" and msg.content.strip():
            text = msg.content.strip()
            return text[:30] + "..." if len(text) > 30 else text
    return "New Scavenge Session"
