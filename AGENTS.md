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

## Security

- Model names validated against `^[a-zA-Z0-9_:./-]+$`
- No hardcoded secrets — API keys come from the environment
- Session files use `0600` permissions
- No shell command execution, no raw HTML injection in the CLI path

## Tests

```bash
uv run pytest
```

- `tests/test_session.py` — save/load + permissions
- `tests/test_personas.py` — preset loading
- `tests/test_cloud.py` — HTML catalog parsers
- `tests/test_router.py` — Ollama-first / OpenAI-fallback selection

## Cursor Cloud specific instructions

On Linux the macOS `.venv`/`UF_HIDDEN` workaround does not apply — a plain
`uv sync --extra dev` is enough, and `uv run bandit` / `uv run pytest` work
directly. `uv` lives at `~/.local/bin` (already on PATH).

There is no lint tooling configured (no ruff/flake8 in deps or config); "lint"
is a no-op for this repo. Automated checks are `uv run pytest`.

To actually chat (the CLI's core function) you need a reachable provider. The
default is a local Ollama at `127.0.0.1:11434`; the OpenAI path needs
`OPENAI_API_KEY`. Start Ollama with `ollama serve` (systemd is not running in
this environment, so run it yourself, e.g. in a background/tmux session) and
pull a small model such as `qwen2.5:0.5b`. Point Bandit at it with
`BANDIT_MODEL=qwen2.5:0.5b` (default `gemma4:e2b` is not pulled).

Non-obvious gotcha: Ollama auto-selects an AVX512 CPU runner that hits a
general-protection fault (segfault, HTTP 500 "llama-server process has
terminated") on this virtualized CPU. Fix once by removing the AVX512 ggml CPU
variants so it falls back to the AVX2 (`haswell`) runner:
`sudo mv /usr/local/lib/ollama/libggml-cpu-{cannonlake,cascadelake,cooperlake,icelake,sapphirerapids,skylakex,zen4}.so /usr/local/lib/ollama/_disabled_avx512/`
then restart `ollama serve`. Without this, every chat turn crashes the model.

The CLI is a `prompt_toolkit` REPL; when stdin is not a TTY it skips the
interactive model picker and just uses `BANDIT_MODEL` / the default. Piping
`printf '...\n/exit\n' | uv run bandit` is a handy way to script a chat turn.
