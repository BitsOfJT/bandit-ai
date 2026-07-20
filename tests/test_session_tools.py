"""Session round-trip with tool-calling message fields."""

from __future__ import annotations

from bandit_cli.session import Message, Session


def test_message_with_tool_calls_round_trips():
    msg = Message(
        role="assistant",
        content="",
        tool_calls=[{"id": "abc", "name": "web_search", "arguments": {"query": "hi"}}],
    )
    restored = Message.from_dict(
        {
            "role": msg.role,
            "content": msg.content,
            "tool_calls": msg.tool_calls,
            "tool_call_id": msg.tool_call_id,
        }
    )
    assert restored == msg


def test_tool_role_message_round_trips():
    msg = Message(role="tool", content="result text", tool_call_id="abc")
    restored = Message.from_dict(
        {"role": "tool", "content": "result text", "tool_call_id": "abc"}
    )
    assert restored == msg


def test_legacy_message_without_tool_fields_loads():
    # Pre-tool session files only had role + content.
    restored = Message.from_dict({"role": "user", "content": "hello"})
    assert restored.role == "user"
    assert restored.content == "hello"
    assert restored.tool_calls is None
    assert restored.tool_call_id == ""


def test_message_from_dict_ignores_unknown_keys():
    restored = Message.from_dict(
        {"role": "user", "content": "hi", "future_field": 123}
    )
    assert restored.role == "user"


def test_session_with_tool_messages_survives_save_load(tmp_path, monkeypatch):
    import bandit_cli.session as session_mod

    monkeypatch.setattr(session_mod, "sessions_dir", lambda: tmp_path)
    s = Session(
        id="chat-test-1",
        title="t",
        messages=[
            Message(role="user", content="search cats"),
            Message(
                role="assistant",
                tool_calls=[{"id": "1", "name": "web_search", "arguments": {"query": "cats"}}],
            ),
            Message(role="tool", content="1. Cats — ...", tool_call_id="1"),
            Message(role="assistant", content="Here you go."),
        ],
    )
    session_mod.save_session(s)
    loaded = session_mod.load_session("chat-test-1")
    assert [m.role for m in loaded.messages] == ["user", "assistant", "tool", "assistant"]
    assert loaded.messages[1].tool_calls[0]["name"] == "web_search"
    assert loaded.messages[2].tool_call_id == "1"
