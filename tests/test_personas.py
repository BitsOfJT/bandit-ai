"""Tests for persona presets."""

from bandit_cli.personas import PERSONALITY_PRESETS


def test_three_presets_exist():
    assert set(PERSONALITY_PRESETS) == {"hacker", "philosopher", "standard"}


def test_hacker_prompt_mentions_bandit():
    prompt = PERSONALITY_PRESETS["hacker"].prompt.lower()
    assert "bandit" in prompt
    assert len(prompt) > 50
