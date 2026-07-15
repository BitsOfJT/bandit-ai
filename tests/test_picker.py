"""Tests for the Ollama startup model picker."""

import pytest

from bandit_cli.__main__ import (
    is_ollama_cloud_model,
    resolve_picker_choice,
    wants_cloud_picker,
)


NAMES = ["gemma4:e2b-mlx", "qwen3.5:0.8b-mlx", "deepseek-v4-flash:cloud"]


def test_empty_keeps_current_when_installed():
    assert resolve_picker_choice("", NAMES, "qwen3.5:0.8b-mlx") == "qwen3.5:0.8b-mlx"


def test_empty_falls_back_to_first_when_current_missing():
    assert resolve_picker_choice("  ", NAMES, "gemma4:e2b") == "gemma4:e2b-mlx"


def test_digit_selects_one_based_index():
    assert resolve_picker_choice("2", NAMES, NAMES[0]) == "qwen3.5:0.8b-mlx"


def test_digit_out_of_range_raises():
    with pytest.raises(ValueError, match="between 1 and"):
        resolve_picker_choice("9", NAMES, NAMES[0])


def test_name_selects_exact_match():
    assert (
        resolve_picker_choice("deepseek-v4-flash:cloud", NAMES, NAMES[0])
        == "deepseek-v4-flash:cloud"
    )


def test_unknown_name_raises():
    with pytest.raises(ValueError, match="unknown model"):
        resolve_picker_choice("nope", NAMES, NAMES[0])


def test_empty_models_raises():
    with pytest.raises(ValueError, match="no models"):
        resolve_picker_choice("1", [], "x")


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("gemma4:e2b-mlx", False),
        ("qwen3.5:0.8b-mlx", False),
        ("gemma4:31b-cloud", True),
        ("GLM-5.2:cloud", True),
        ("deepseek-v4-flash:cloud", True),
        ("minimax-m3:cloud", True),
        ("llama3:latest", False),
    ],
)
def test_is_ollama_cloud_model(name: str, expected: bool):
    assert is_ollama_cloud_model(name) is expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("c", True),
        ("C", True),
        ("cloud", True),
        ("Cloud", True),
        ("1", False),
        ("gemma4:e2b-mlx", False),
        ("", False),
    ],
)
def test_wants_cloud_picker(raw: str, expected: bool):
    assert wants_cloud_picker(raw) is expected
