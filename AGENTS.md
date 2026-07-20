# AGENTS.md — Bandit AI

## Architecture

Python CLI only (web UI + Go CLI are shelved under `legacy-web/`).

| Component | Language | Entrypoint | Directory |
|-----------|----------|------------|-----------|
| CLI | Python 3.11+ | `bandit_cli/__main__.py` | `bandit_cli/` |
| Legacy web/Go | TS/React + Go | (archived) | `legacy-web/` |

## Commands

```bash
# End-user install
curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
# or: brew install BitsOfJT/bandit/bandit

# Prefer a non-dot venv on macOS Desktop/Documents so editable .pth files
# are not marked UF_HIDDEN (Python 3.12+ would skip them and break launch).
UV_PROJECT_ENVIRONMENT=venv uv sync --extra dev
ln -sfn venv .venv   # so plain `uv run` keeps finding the env

uv run bandit                # launch the CLI
./bandit                     # alternate: python -m wrapper (no .pth needed)
uv run pytest                # unit tests
uv run python -m bandit_cli  # alternate launch
```

On macOS Desktop/Documents, a real `.venv` directory often marks files
`UF_HIDDEN`. Python 3.12+ then skips editable `.pth` files →
`ModuleNotFoundError: No module named 'bandit_cli'`. Use the `venv` +
symlink setup above (one-time), or `./bandit`, or
`chflags -R nohidden .venv` as a temporary workaround.

Package name on PyPI-style installs is `bandit-ai-cli` (the `bandit` name is taken by a security linter). The console script is still `bandit`.

## Providers

- **Default:** Ollama at `http://127.0.0.1:11434` (`OLLAMA_HOST`, `BANDIT_MODEL`)
- **Optional:** OpenAI-compatible (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `OPENAI_MODEL`)

Startup probes Ollama first; if unavailable, tries OpenAI when a key is set.

## Session storage

JSON files at `~/.bandit_ai/sessions/` with `0600` permissions. Fresh schema (`snake_case` keys) — not compatible with the old Go CLI session files.

## Persona

`bandit_cli/data/bandit-soul.md` is packaged via `importlib.resources` and used as the default `hacker` system prompt. Keep the repo-root `bandit-soul.md` in sync when editing.

## Tools (web search + fetch)

Tool calling lives in `bandit_cli/tools/` (`base.py` = `Tool` + JSON schema,
`registry.py` = registry/safe dispatch, `web.py` = `web_search` + `web_fetch`)
and the loop is `bandit_cli/agent.py`. Providers gained `chat_once()` (non-
streamed, returns `ChatTurn`/`ToolCall`) and `supports_tools(model)` alongside
`chat_stream()`.

- **On by default** (`BANDIT_TOOLS`). Toggle at runtime with `/settings tools
  on|off`; `/tools` lists tool status.
- **Capability-gated:** the agent loop only runs when the active model reports
  the `tools` capability (Ollama `show`), else it falls back to plain streaming
  and prints a one-time note. Most `qwen2.5` tags support tools; base `gemma`
  tags often do not.
- **Search backends:** `duckduckgo` (key-free default) and `brave`
  (`BRAVE_API_KEY` from env). Switch with `/settings search <name>`.
- The tool path is **non-streaming** (needs the full turn to detect tool
  calls); the tool-free path keeps token streaming.
- Parsing (`parse_duckduckgo`, `parse_brave`, `html_to_text`) is pure and
  fixture-tested, mirroring `cloud.py`. Web-tool/agent tests are network-free
  via monkeypatching.

Design rationale and phasing live in `docs/tool-calling-plan.md`.

## Security

- Model names validated against `^[a-zA-Z0-9_:./-]+$`
- No hardcoded secrets — API keys come from the environment
- Session files use `0600` permissions
- No shell command execution, no raw HTML injection in the CLI path
- Tools are HTTP-only: `web_fetch` allows only public `http(s)` hosts (SSRF
  guard rejects loopback/private/link-local IPs) and downgrades HTML to text;
  API keys (Brave) come from the environment, never persisted to sessions

## Tests

```bash
uv run pytest
```

- `tests/test_session.py` — save/load + permissions
- `tests/test_personas.py` — preset loading
- `tests/test_cloud.py` — HTML catalog parsers
- `tests/test_router.py` — Ollama-first / OpenAI-fallback selection
