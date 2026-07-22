"""Agent tool-calling loop."""

from __future__ import annotations

from bandit_cli.agent import run_agent_turn
from bandit_cli.providers.base import ChatOptions, ChatTurn, ToolCall
from bandit_cli.session import Message
from bandit_cli.tools.base import Tool
from bandit_cli.tools.registry import ToolRegistry


class ScriptedProvider:
    """Returns a preset list of ChatTurns, one per chat_once call."""

    name = "scripted"

    def __init__(self, turns):
        self._turns = list(turns)
        self.calls = 0

    def chat_once(self, model, messages, options, tools):
        self.calls += 1
        if self._turns:
            return self._turns.pop(0)
        return ChatTurn(content="fallback")

    def supports_tools(self, model):
        return True


def _registry():
    echo = Tool(
        name="echo",
        description="echo",
        parameters={"type": "object", "properties": {"text": {"type": "string"}}},
        func=lambda text: f"echoed:{text}",
    )
    return ToolRegistry([echo])


def test_agent_runs_tool_then_answers():
    provider = ScriptedProvider(
        [
            ChatTurn(tool_calls=[ToolCall(id="1", name="echo", arguments={"text": "hi"})]),
            ChatTurn(content="Final answer."),
        ]
    )
    messages = [Message(role="user", content="please echo hi")]
    reply = run_agent_turn(
        provider, "m", messages, ChatOptions(), _registry(), render=False
    )
    assert reply == "Final answer."
    roles = [m.role for m in messages]
    # run_agent_turn appends the tool-call assistant + tool result, but leaves
    # the final assistant Message to the caller (mirrors chat_stream).
    assert roles == ["user", "assistant", "tool"]
    tool_msg = next(m for m in messages if m.role == "tool")
    assert tool_msg.content == "echoed:hi"
    assert tool_msg.tool_call_id == "1"
    assert tool_msg.tool_name == "echo"
    assert provider.calls == 2


def test_agent_direct_answer_no_tools():
    provider = ScriptedProvider([ChatTurn(content="Just an answer.")])
    messages = [Message(role="user", content="hi")]
    reply = run_agent_turn(
        provider, "m", messages, ChatOptions(), _registry(), render=False
    )
    assert reply == "Just an answer."
    assert [m.role for m in messages] == ["user"]
    assert provider.calls == 1


def test_agent_respects_iteration_cap():
    # Keeps asking for tools through the whole cap, then answers on the
    # forced post-cap summary call.
    looping = [
        ChatTurn(tool_calls=[ToolCall(id=str(i), name="echo", arguments={"text": "x"})])
        for i in range(3)
    ]
    provider = ScriptedProvider(looping + [ChatTurn(content="summary")])
    messages = [Message(role="user", content="loop")]
    reply = run_agent_turn(
        provider, "m", messages, ChatOptions(), _registry(), max_iters=3, render=False
    )
    # 3 loop iterations + 1 final summary call.
    assert provider.calls == 4
    assert reply == "summary"
