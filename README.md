# Bandit AI (CLI) · v0.4.0

A local-first, cyberpunk raccoon chatbot for your terminal.

**Default backend:** [Ollama](https://ollama.com) on your machine  
**Optional:** OpenAI-compatible API (`/provider openai` when you have a key)

> The old React web app + Go CLI live in [`legacy-web/`](./legacy-web/) (shelved, not deleted).
>
> _(buzz-pr smoke test — safe to ignore/remove)_

---

## Install

### curl (macOS & Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
bandit
```

Uses [uv](https://github.com/astral-sh/uv) when available (installs it if missing), otherwise pipx. Needs **Python 3.11+**.

Pin a version:

```bash
BANDIT_VERSION=v0.4.0 curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
```

### Homebrew (macOS & Linux)

```bash
brew install BitsOfJT/bandit/bandit
bandit
```

> Always use the fully-qualified name. Bare `brew install bandit` is a different Homebrew-core formula (security linter).

### From this repo (developers)

```bash
# macOS Desktop/Documents: non-dot venv avoids editable .pth + UF_HIDDEN launch bugs
UV_PROJECT_ENVIRONMENT=venv uv sync --extra dev
ln -sfn venv .venv
uv run bandit
```

---

## Quick start

### 1. Run Ollama (default provider)

1. Install from https://ollama.com and start it  
2. Pull a model: `ollama pull gemma4:e2b`

### 2. (Optional) Configure OpenAI

```bash
export OPENAI_API_KEY="sk-..."
# optional: OPENAI_BASE_URL, OPENAI_MODEL
```

Then `/provider openai` inside the CLI. If Ollama isn’t running and a key is set, Bandit falls back to OpenAI automatically.

### 3. Launch

```bash
bandit
# or from a clone: uv run bandit / ./bandit
```

---

## Commands

| Command | What it does |
|---------|----------------|
| `/help` | Show all commands |
| `/provider` | Show OpenAI / Ollama status |
| `/provider ollama` | Force local Ollama (default) |
| `/provider openai` | Force OpenAI-compatible API |
| `/models` / `/model` | List / switch models |
| `/persona` | hacker · philosopher · standard |
| `/sessions` `/load` `/new` `/clear` | Session management |
| `/pull <name>` | Download a model via Ollama |
| `/cloud` | Browse Ollama cloud catalog |
| `/temp` `/top_p` `/ctx` | Generation knobs |
| `/exit` | Quit |

---

## How the code is organized (learn here)

```
bandit_cli/
  __main__.py              # REPL + slash commands  ← start reading here
  config.py                # defaults + env vars
  session.py               # Message/Session + JSON files
  personas.py              # system prompts
  render.py                # Rich banner + streaming markdown
  cloud.py                 # ollama.com HTML catalog scrape
  providers/
    base.py                # shared Provider interface
    ollama.py              # DEFAULT — local Ollama
    openai_provider.py     # optional OpenAI-compatible API
    router.py              # "try Ollama, else OpenAI"
  data/bandit-soul.md      # full persona reference
```

Sessions are stored at `~/.bandit_ai/sessions/*.json` (not compatible with the old Go CLI files).

---

## Tests

```bash
uv run pytest
```

---

## Legacy

See [`legacy-web/`](./legacy-web/) for the previous TypeScript/React UI and Go CLI.
