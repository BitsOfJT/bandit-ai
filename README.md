# Bandit AI (CLI) · v0.4.0

A local-first, cyberpunk raccoon chatbot for your terminal — chat with a model running on your own machine, no API key required.

**Default backend:** [Ollama](https://ollama.com) on your machine  
**Optional:** OpenAI-compatible API (`/provider openai` when you have a key)

Pick a personality (`/persona`), keep chatting across restarts (sessions autosave), and let the model pull in a live web page when it needs one (see [Tools](#tools)).

> The old React web app + Go CLI live in [`legacy-web/`](./legacy-web/) — shelved, not deleted. See [Legacy](#legacy).

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

## Tools

Bandit can call one tool: **`web_fetch(url)`**. Given an exact `http(s)://` URL, it fetches the page and hands the model back the text.

What it's *not*: a search engine. There's no Google/Bing integration, so the model can't turn "what's the weather in Alabama" into a search — it can only fetch a URL it (or you) already knows. Give it a real URL (`https://wttr.in/Alabama`, a docs page, an API endpoint) and it'll read it; a request that needs a search first will fail or get a made-up answer.

Fetches are sandboxed against SSRF: `http`/`https` only, and every hop (including redirects) is blocked from reaching loopback, private, link-local, and cloud-metadata addresses.

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
  tools.py                 # web_fetch tool + SSRF guards
  providers/
    base.py                # shared Provider interface (ChatChunk, tool_calls)
    ollama.py              # DEFAULT — local Ollama
    openai_provider.py     # optional OpenAI-compatible API
    router.py              # "try Ollama, else OpenAI"
  data/bandit-soul.md      # full persona reference
```

Sessions autosave to `~/.bandit_ai/sessions/*.json` (`0600` permissions, one file per session). Fresh schema — not compatible with the old Go CLI's session files.

---

## Tests

Needs dev deps first if you haven't run the dev install above (`uv sync --extra dev`), then:

```bash
uv run pytest
```

---

## Legacy

Bandit started as a TypeScript/React web app with a companion Go CLI (v0.3.0 and earlier). Both were shelved — not deleted — when the project moved to this Python CLI. They live untouched in [`legacy-web/`](./legacy-web/) if you need to reference the old behavior.
