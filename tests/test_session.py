"""Tests for session save/load."""

from __future__ import annotations

from bandit_cli.__main__ import BanditApp
from bandit_cli.session import Message, Session, list_sessions, load_session, save_session, sessions_dir


def test_save_and_load_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    # On macOS Path.home() uses HOME; also cover USERPROFILE for safety.
    monkeypatch.setattr(
        "bandit_cli.session.Path.home", lambda: tmp_path
    )

    session = Session(
        id="chat-test-1",
        title="Hello dumpster",
        messages=[
            Message(role="system", content="You are Bandit."),
            Message(role="user", content="hi"),
            Message(role="assistant", content="*chitters* hey"),
        ],
        system_prompt="You are Bandit.",
        model="gpt-4o-mini",
        provider="openai",
        temperature=0.5,
        top_p=0.8,
        num_ctx=4096,
        created_at=1234567890.0,
    )
    path = save_session(session)
    assert path.exists()
    assert oct(path.stat().st_mode)[-3:] == "600"

    loaded = load_session("chat-test-1")
    assert loaded.id == session.id
    assert loaded.title == "Hello dumpster"
    assert len(loaded.messages) == 3
    assert loaded.messages[1].content == "hi"
    assert loaded.provider == "openai"
    assert loaded.temperature == 0.5


def test_list_sessions_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr("bandit_cli.session.Path.home", lambda: tmp_path)

    older = Session(id="old", title="old", created_at=100.0)
    newer = Session(id="new", title="new", created_at=200.0)
    save_session(older)
    save_session(newer)

    listed = list_sessions()
    assert [s.id for s in listed] == ["new", "old"]


def test_save_current_persists_to_disk(tmp_path, monkeypatch):
    """Regression: save_current() must actually write the session, not just mutate it in memory."""
    monkeypatch.setattr("bandit_cli.session.Path.home", lambda: tmp_path)

    app = BanditApp()
    app.session = Session(id="chat-save-current", title="", messages=[Message(role="user", content="hi")])
    app.save_current()

    path = sessions_dir() / "chat-save-current.json"
    assert path.exists()
    assert load_session("chat-save-current").title == app.session.title
