# Tool Calling — Implementation Plan

> Reference plan for adding **tool calling** to the Bandit CLI, starting with
> **web search** and **web fetch** so replies can use live info, not just model
> knowledge. Source of the feature request: `todo.md`.

## Locked decisions

1. **Source spec:** `todo.md` ("add capabilities … starting with tool calling
   (web search / fetch)").
2. **Tools ON by default.** Users toggle them with a new `/settings` command.
3. **Search backends:** DuckDuckGo (key-free, default) and Brave (API key from
   env). Backend is selectable via `/settings` / env.
4. **Capability gating:** only offer tools to models that actually support them.
   Tool-incapable models fall back to the plain chat path with a one-time note.

Everything below is scoped to these decisions.

---

## 1. Why this needs real design work

Today a chat turn is a single, one-shot, streaming round-trip. In
`dispatch()` (`bandit_cli/__main__.py`) the CLI:

1. appends the user `Message`,
2. calls `provider.chat_stream(model, messages, options)`,
3. streams tokens through `stream_markdown_reply()` (`render.py`),
4. appends the assistant `Message`.

There is no loop and no concept of a tool. Tool calling requires an **agentic
loop**: model → (maybe) tool call → run tool locally → feed result back →
model → … → final answer.

Three things block that today:

- **Provider interface** — `Provider.chat_stream()` (`providers/base.py`) yields
  only `Iterator[str]`; it cannot surface a tool-call request.
- **Message model** — `Message` (`session.py`) has just `role` + `content`
  (roles `system|user|assistant`). No `tool` role, no `tool_calls`, no
  `tool_call_id`.
- **Orchestration** — there is no loop, no tool registry, and no tool
  definitions.

### What already helps us

- Both backends speak the **same tool schema**. `ollama`'s
  `client.chat(..., tools=[...])` and OpenAI's
  `chat.completions.create(..., tools=[...])` both use
  `{"type":"function","function":{name,description,parameters}}` and return
  `message.tool_calls`.
- `_is_chat_capable()` (`providers/ollama.py`) already recognizes the `tools`
  capability, and `ModelInfo.capabilities` (`providers/base.py`) carries it —
  the raw material for capability gating.
- `cloud.py` is a proven, **dependency-free** pattern for HTTP + parsing
  (`httpx` + `re`/stdlib, pure functions unit-tested against saved fixtures).
  The web tools mirror it, so **no new dependencies** are required (`httpx` is
  already a dependency).

---

## 2. Target architecture

### New package `bandit_cli/tools/`

- **`base.py`** — `Tool` protocol/dataclass:
  - `name: str`
  - `description: str`
  - `parameters: dict` (JSON schema for the arguments object)
  - `run(args: dict) -> str` (returns a compact text result for the model)
  - `to_schema() -> dict` (the shared function-schema shape used by both
    providers)
- **`registry.py`** — a `ToolRegistry`:
  - name → `Tool` map
  - `schemas()` → the schema list for the **currently enabled** tools
  - `dispatch(name, args) -> str` — safe execution: unknown-tool handling,
    argument validation against the schema, error-to-text conversion. Never
    `eval`, never shell.
- **`web.py`** — the two `todo.md` tools:
  - `web_fetch(url)` — `httpx` GET → HTML-to-text (reuse the `cloud.py` stdlib
    approach) → truncate to a byte/char cap. **SSRF-guarded** (see Security).
  - `web_search(query)` — pluggable backend:
    - **DuckDuckGo** (default, key-free): query the HTML endpoint and parse
      results with `cloud.py`-style pure functions.
    - **Brave**: `GET https://api.search.brave.com/res/v1/web/search` with the
      API key from env. Used only when selected/available.
    - Returns a compact ranked list (title, url, snippet) as text.

### New module `bandit_cli/agent.py`

`run_agent_turn(app, provider, model, messages, options, registry) -> str`
implements the loop:

1. `turn = provider.chat_once(model, messages, options, registry.schemas())`
2. if `turn.tool_calls`:
   - append an assistant `Message` carrying `tool_calls`,
   - for each call: `result = registry.dispatch(name, args)`; append a `tool`
     `Message` with the result and `tool_call_id`,
   - show tool activity in the UI (see `render.py`),
   - loop.
3. else: the `turn.content` is the final answer → render + return it.
4. Hard **max-iteration cap** (config, default 5) to prevent runaway loops; if
   hit, return the best available text plus a note.

### Provider interface changes (`providers/base.py`)

Add tool-aware, **non-streaming** primitives alongside the existing
`chat_stream` (which stays for the tool-free path so streaming UX is preserved):

```python
@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict

@dataclass
class ChatTurn:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)

class Provider(Protocol):
    ...
    def supports_tools(self, model: str) -> bool: ...
    def chat_once(
        self,
        model: str,
        messages: list[Message],
        options: ChatOptions,
        tools: list[dict],
    ) -> ChatTurn: ...
```

- **`providers/ollama.py`** — `chat_once`: pass `tools=`, read
  `message.tool_calls`, normalize into `ToolCall`. `supports_tools(model)`
  checks the model's `capabilities` for `tools`.
- **`providers/openai_provider.py`** — `chat_once`: pass `tools=`, read
  `choice.message.tool_calls`, normalize. `supports_tools` returns `True` for
  chat models (optionally a small deny-heuristic for known non-tool models).

### Message model changes (`session.py`)

Extend `Message` (all optional, JSON round-trippable):

```python
@dataclass
class Message:
    role: str  # system | user | assistant | tool
    content: str = ""
    tool_calls: list[dict] | None = None  # on assistant messages
    tool_call_id: str = ""                # on tool messages
```

- Make message loading **tolerant** of unknown/missing keys (today
  `Message(**m)` breaks on extra keys) so sessions stay forward/backward
  compatible.
- `_sync_system_message` and history rendering in `__main__.py` must ignore
  `tool` / tool-call messages when appropriate (e.g. session titles, the
  "last messages" preview on `/load`).

### Config + settings (`config.py`, new `/settings` + `/tools`)

`config.py` — env-driven knobs (keys via env only, per Security):

| Setting | Env | Default |
|---|---|---|
| Tools enabled | `BANDIT_TOOLS` | **on** |
| Max tool iterations | `BANDIT_TOOL_MAX_ITERS` | `5` |
| Search backend | `BANDIT_SEARCH_BACKEND` | `duckduckgo` |
| Brave key | `BRAVE_API_KEY` | _(unset)_ |
| Fetch byte cap | `BANDIT_FETCH_MAX_BYTES` | e.g. `100_000` |
| Fetch timeout | `BANDIT_FETCH_TIMEOUT` | e.g. `10.0` |

- **`/settings`** — the user-facing control surface. With no args, prints
  current settings (tools on/off, enabled tools, search backend, model
  tool-capability). Args toggle them, at minimum:
  - `/settings tools on|off`
  - `/settings search duckduckgo|brave`
  - (room to grow: per-tool enable/disable, temp/top_p/ctx could migrate here
    later — out of scope for v1).
- **`/tools`** — list available tools, their descriptions, and enabled state
  (a focused view; `/settings tools on|off` is the toggle).
- Wire both into `dispatch()` handlers, the banner command list
  (`render.print_banner`), and `/help` (`render.print_help`).

### Capability gating

- Each turn, if tools are enabled **and** `provider.supports_tools(model)` is
  true → use `run_agent_turn`. Otherwise → existing `chat_stream` path.
- When the user has tools on but the active model can't use them, print a
  one-time note (e.g. "`qwen2.5:0.5b` can't call tools — pick a tools-capable
  model with `/models`"). `/settings` surfaces the current model's
  tool-capability so the state is never a mystery.

### UI (`render.py`)

Add a helper to show tool activity in Bandit's voice, e.g.:

```
🔧 web_search("latest python release") → 5 results
🔧 web_fetch("https://…") → 3.2 KB of text
```

Keep fetched content downgraded to text before display (no raw HTML).

---

## 3. UX decision: streaming vs. tools (v1)

For v1, run the loop with the non-streaming `chat_once` for every round,
including the final answer (rendered through the existing Markdown renderer).
This is robust and simple; it only gives up token-by-token streaming **while
tools are active**. The tool-free path keeps full streaming.

A later phase can add incremental streaming of `tool_calls` (both SDKs support
it) for nicer UX. Deferred, not v1.

---

## 4. Security (must respect `AGENTS.md` "Security")

- **HTTP-only tools; no shell execution** — consistent with the existing
  no-exec stance.
- **`web_fetch` SSRF guard:** allow only `http`/`https`; resolve the host and
  reject loopback / private / link-local ranges; cap redirects, timeout, and
  response bytes.
- **No raw HTML injection:** convert fetched HTML to plain text before it
  re-enters the model or terminal (Rich Markdown escapes anyway, but we
  downgrade to text regardless).
- **Argument validation:** validate tool args against the schema; reject
  malformed input with a text error the model can recover from.
- **Secrets:** API keys (Brave) strictly from env — never persisted to session
  files or logged.

---

## 5. Testing plan (offline, network-free — matches current suite)

- **`tests/test_tools_web.py`** — `web_search` parsing (DDG + Brave) and
  `web_fetch` text extraction from saved fixtures; assert SSRF rejection of
  `localhost`/private IPs (monkeypatch `httpx`).
- **`tests/test_registry.py`** — schema generation for enabled tools,
  unknown-tool handling, bad-argument handling.
- **`tests/test_agent.py`** — a fake provider that returns a tool call then a
  final answer; assert the loop runs the tool, appends the `tool` message,
  terminates, and honors the max-iteration cap.
- **`tests/test_session.py`** (extend) — round-trip a `Message` with
  `tool_calls` and a `tool` role; confirm legacy files (no new fields) still
  load.
- **`tests/test_settings.py`** (or extend `test_router`) — `/settings` parsing:
  toggling tools on/off and switching search backend updates `RuntimeConfig`.

All tests stay network-free via monkeypatching, following the `test_cloud.py`
fixture pattern.

---

## 6. Phasing / milestones

1. **Loop skeleton** — `Message` model + `ChatTurn`/`ToolCall` + `chat_once` on
   both providers + `ToolRegistry` + `agent.run_agent_turn`, validated
   end-to-end offline with one trivial built-in tool (e.g. `get_time`).
2. **`web_fetch`** — with the SSRF guard + text extraction + tests.
3. **`web_search`** — DuckDuckGo default; Brave backend behind `BRAVE_API_KEY`.
4. **Controls + docs** — `/settings` (tools on by default) and `/tools`,
   capability gating + notes, banner/`/help` updates, config knobs, and docs
   (`README.md`, `AGENTS.md`, a persona mention in `bandit-soul.md`).
5. **(Optional) streaming tool_calls** — incremental streaming for nicer UX.

---

## 7. File-by-file change list

**New**
- `bandit_cli/tools/__init__.py`
- `bandit_cli/tools/base.py` — `Tool`, `to_schema()`
- `bandit_cli/tools/registry.py` — `ToolRegistry`
- `bandit_cli/tools/web.py` — `web_fetch`, `web_search` (DDG + Brave)
- `bandit_cli/agent.py` — `run_agent_turn`
- `tests/test_tools_web.py`, `tests/test_registry.py`, `tests/test_agent.py`,
  `tests/test_settings.py`
- test fixtures for DDG/Brave/HTML pages

**Modified**
- `providers/base.py` — `ToolCall`, `ChatTurn`, `supports_tools`, `chat_once`
- `providers/ollama.py`, `providers/openai_provider.py` — implement the above
- `session.py` — extend `Message`, tolerant loading
- `config.py` — tool/search settings + env vars
- `__main__.py` — turn routing, `/settings`, `/tools`, capability note
- `render.py` — tool-activity display + banner/help updates
- `README.md`, `AGENTS.md`, `bandit-soul.md` — document the feature

---

## 8. Open risks

- **Model quality:** small local Ollama models call tools unreliably; keep the
  max-iteration cap and clear fallbacks.
- **Search scraping drift:** the DuckDuckGo HTML layout can change (same risk
  `cloud.py` already carries); isolate parsing in pure, fixture-tested
  functions so breakage is easy to spot and fix.
- **Persona vs. tool output:** the 6KB "soul" prompt may fight terse tool
  usage; may need a short tool-usage addendum to the system prompt (small,
  behind the same persona).
