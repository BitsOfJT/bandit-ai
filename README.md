# Bandit AI (CLI)

A local-first, cyberpunk raccoon chatbot for your terminal.

**Default backend:** OpenAI-compatible API (ready for free access when your key works)  
**Fallback:** [Ollama](https://ollama.com) on your machine

> The old React web app + Go CLI live in [`legacy-web/`](./legacy-web/) (shelved, not deleted).

---

## Quick start

### 1. Install

Requires **Python 3.11+** and [uv](https://github.com/astral-sh/uv) (recommended):

```bash
# from the repo root
# macOS Desktop/Documents: use a non-dot venv so editable .pth files
# are not marked UF_HIDDEN (that breaks `uv run bandit`)
UV_PROJECT_ENVIRONMENT=venv uv sync --extra dev
ln -sfn venv .venv
```

Or with pip:

```bash
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"
```

### 2. Configure OpenAI (default provider)

```bash
export OPENAI_API_KEY="sk-..."
# optional overrides:
# export OPENAI_BASE_URL="https://api.openai.com/v1"
# export OPENAI_MODEL="gpt-4o-mini"
```

If OpenAI isn't ready (no key, billing, free tier not available), Bandit
**automatically falls back to Ollama**.

### 3. (Optional) Run Ollama for the fallback

1. Install from https://ollama.com and start it  
2. Pull a model: `ollama pull gemma4:e2b`

### 4. Launch

```bash
uv run bandit
# or: ./bandit
# or: uv run python -m bandit_cli
```

If `uv run bandit` raises `ModuleNotFoundError: No module named 'bandit_cli'`,
your `.venv` is a real hidden dir again — recreate with the `venv` + symlink
steps above, or run `./bandit`.

---

## Commands

| Command | What it does |
|---------|----------------|
| `/help` | Show all commands |
| `/provider` | Show OpenAI / Ollama status |
| `/provider openai` | Force OpenAI (default when available) |
| `/provider ollama` | Force local Ollama |
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
    openai_provider.py     # DEFAULT backend
    ollama.py              # FALLBACK backend
    router.py              # "try OpenAI, else Ollama"
  data/bandit-soul.md      # full persona reference
```

Every module has teaching-oriented comments at the top.

Sessions are stored at `~/.bandit_ai/sessions/*.json` (fresh format — not compatible with the old Go CLI files).

---

## Tests

```bash
uv run pytest
```

---

## Why OpenAI is default even without a free tier today

OpenAI's free chat API access is inconsistent. Bandit still **defaults to OpenAI** so that when free models/quota become available for your key, nothing else needs wiring. Until then, Ollama keeps you scavenging locally.

---

## Legacy

See [`legacy-web/`](./legacy-web/) for the previous TypeScript/React UI and Go CLI.
