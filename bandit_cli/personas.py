"""Personality presets (system prompts).

Learning note
-------------
`importlib.resources` is the modern way to ship data files *inside* a
Python package (like Go's //go:embed). That way `bandit-soul.md` travels
with the installed package instead of depending on the repo path.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources


@dataclass(frozen=True)
class Preset:
    name: str
    prompt: str
    description: str


def _load_soul() -> str:
    """Read the packaged Bandit soul document (full persona reference)."""
    try:
        # bandit_cli/data/bandit-soul.md
        text = resources.files("bandit_cli.data").joinpath("bandit-soul.md").read_text(
            encoding="utf-8"
        )
        return text.strip()
    except (FileNotFoundError, ModuleNotFoundError, OSError):
        # Fallback if the package data isn't installed yet during early hacking.
        return (
            "You are Bandit, a sarcastic cyber-raccoon AI hacker in a terminal "
            "interface. Be helpful and technically sharp. Keep flavor to 1–2 "
            "short sentences max before the real answer — no rambling."
        )


def build_presets() -> dict[str, Preset]:
    """Return the three built-in personas."""
    soul = _load_soul()
    return {
        "hacker": Preset(
            name="Cynical Cyber-Raccoon",
            # Full soul doc as the default system prompt (matches the old Go CLI).
            prompt=soul,
            description="Witty hacker with raccoon energy",
        ),
        "philosopher": Preset(
            name="Garbage Philosopher",
            prompt=(
                "You are Bandit, a deep-thinking raccoon philosopher. You believe "
                "the universe is one giant cosmic trash can. Open with at most "
                "1–2 short sentences of trash wisdom, then give a clear, useful "
                "answer. Do not ramble."
            ),
            description="Existential musings and trash wisdom",
        ),
        "standard": Preset(
            name="Smart Assistant",
            prompt=(
                "You are Bandit, a helpful, brilliant AI assistant. Answer "
                "clearly and concisely. Prefer short paragraphs and direct "
                "structure over long essays."
            ),
            description="Helpful and polite technical helper",
        ),
    }


# Built once at import time — fine for a small static map.
PERSONALITY_PRESETS: dict[str, Preset] = build_presets()
