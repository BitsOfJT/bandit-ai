"""Provider message serialization for tool-calling loops."""

from __future__ import annotations

from bandit_cli.providers.ollama import _parse_tool_arguments, _to_ollama_messages
from bandit_cli.providers.openai_provider import _to_openai_messages
from bandit_cli.session import Message


def test_ollama_tool_message_includes_tool_name():
    msgs = [
        Message(role="user", content="search"),
        Message(
            role="assistant",
            tool_calls=[{"id": "1", "name": "web_search", "arguments": {"query": "x"}}],
        ),
        Message(
            role="tool",
            content="results",
            tool_call_id="1",
            tool_name="web_search",
        ),
    ]
    wire = _to_ollama_messages(msgs)
    assert wire[-1] == {
        "role": "tool",
        "content": "results",
        "tool_name": "web_search",
    }
    assert "tool_calls" in wire[1]


def test_openai_tool_message_includes_tool_call_id():
    msgs = [
        Message(
            role="assistant",
            tool_calls=[{"id": "call_1", "name": "web_search", "arguments": {"query": "x"}}],
        ),
        Message(role="tool", content="results", tool_call_id="call_1", tool_name="web_search"),
    ]
    wire = _to_openai_messages(msgs)
    assert wire[-1] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "results",
    }
    assert wire[0]["tool_calls"][0]["id"] == "call_1"
    assert wire[0]["tool_calls"][0]["type"] == "function"


def test_parse_tool_arguments_dict():
    assert _parse_tool_arguments({"query": "hi"}) == {"query": "hi"}


def test_parse_tool_arguments_json_string():
    assert _parse_tool_arguments('{"query": "hi"}') == {"query": "hi"}


def test_parse_tool_arguments_invalid_string():
    assert _parse_tool_arguments("not-json") == {}


def test_parse_tool_arguments_non_object_json():
    assert _parse_tool_arguments("[1,2]") == {}
