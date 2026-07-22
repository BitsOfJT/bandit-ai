"""Agentic tool-calling loop.

Learning note
-------------
Unlike a plain chat turn (one request, stream the answer), a tool-calling turn
is a *loop*: ask the model, and if it requests tools, run them, feed the
results back, and ask again — until the model produces a final text answer or
we hit a safety cap on iterations.

This path is non-streaming (we need the whole turn to see tool calls). The
tool-free path in `__main__.py` keeps token streaming.
"""

from __future__ import annotations

from bandit_cli.config import TOOL_MAX_ITERS
from bandit_cli.providers.base import ChatOptions, Provider
from bandit_cli.render import print_tool_call, print_tool_result, render_reply
from bandit_cli.session import Message
from bandit_cli.tools.registry import ToolRegistry


def run_agent_turn(
    provider: Provider,
    model: str,
    messages: list[Message],
    options: ChatOptions,
    registry: ToolRegistry,
    *,
    max_iters: int = TOOL_MAX_ITERS,
    render: bool = True,
) -> str:
    """Drive the model↔tool loop, mutating `messages`, return final text.

    Intermediate assistant (tool-call) and tool-result messages are appended
    to `messages`. The final assistant text is rendered and returned; the
    caller is responsible for appending it as an assistant Message (mirrors the
    streaming path).
    """
    schemas = registry.schemas()
    for _ in range(max_iters):
        turn = provider.chat_once(model, messages, options, schemas)

        if not turn.tool_calls:
            if render:
                render_reply(turn.content)
            return turn.content

        # Record the assistant's tool request so the follow-up call has context.
        messages.append(
            Message(
                role="assistant",
                content=turn.content,
                tool_calls=[
                    {"id": c.id, "name": c.name, "arguments": c.arguments}
                    for c in turn.tool_calls
                ],
            )
        )
        for call in turn.tool_calls:
            if render:
                print_tool_call(call.name, call.arguments)
            result = registry.dispatch(call.name, call.arguments)
            if render:
                print_tool_result(call.name, result)
            messages.append(
                Message(
                    role="tool",
                    content=result,
                    tool_call_id=call.id,
                    tool_name=call.name,
                )
            )

    # Iteration cap reached — make one last plain request for a summary answer.
    turn = provider.chat_once(model, messages, options, [])
    text = turn.content or "(stopped after too many tool calls)"
    if render:
        render_reply(text)
    return text
