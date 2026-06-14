# Bandit AI

A local-first AI chatbot with a retro cyberpunk aesthetic. Bandit runs entirely on your machine via [Ollama](https://ollama.com) — no cloud, no telemetry, no data leaving your hard drive.

## Features

- **Two interfaces**: Interactive terminal CLI and browser-based web UI
- **Three AI personas**: Cynical Cyber-Raccoon, Garbage Philosopher, and Smart Assistant
- **Local-first**: All models run locally through Ollama. Chat history stays on your machine.
- **Streaming responses**: Real-time token streaming with ANSI-colored markdown (CLI) and rendered markdown (web)
- **Session management**: Save, load, rename, and switch between chat sessions
- **Model management**: Pull models, switch models, and adjust temperature/top_p/context window from within the app

## Prerequisites

1. [Install Ollama](https://ollama.com) for your operating system
2. Start the Ollama service (it runs in your menu bar / system tray)
3. Pull at least one model:
   ```bash
   ollama pull gemma4:e2b
   ```

## Quick Start

> Bandit needs [Ollama](https://ollama.com) running first — see [Prerequisites](#prerequisites) above.

### Install the CLI (recommended)

**curl** (macOS & Linux):
```bash
curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
bandit
```

**Homebrew** (macOS & Linux):
```bash
brew install BitsOfJT/bandit/bandit
bandit
```

Both pull the matching binary from the latest [release](https://github.com/BitsOfJT/bandit-ai/releases) and put `bandit` on your `PATH`. Because they download over the command line, macOS does **not** quarantine the binary — it runs without a Gatekeeper prompt.

### Manual download

Grab a binary from the [Releases](https://github.com/BitsOfJT/bandit-ai/releases) page:

| Platform | Binary |
|----------|--------|
| macOS (Apple Silicon) | `bandit` |
| Linux (amd64) | `bandit-linux` |
| Windows (amd64) | `bandit.exe` |

The binaries are **unsigned**. A browser download gets quarantined by macOS Gatekeeper and refuses to run — it can look like nothing happens. Clear the quarantine flag, then run it:

```bash
chmod +x bandit
xattr -d com.apple.quarantine bandit   # macOS only: lift Gatekeeper quarantine
./bandit
```

> On Windows, SmartScreen may show "Windows protected your PC" — click **More info → Run anyway**.

### Build from source

```bash
git clone https://github.com/BitsOfJT/bandit-ai.git
cd bandit-ai
npm install

# CLI
npm run cli

# Web UI (dev server at http://localhost:5173)
npm run dev
```

> **Production web UI**: Run `npm run build` to produce static files in `dist/`. Serve them with a reverse proxy (nginx, Caddy, etc.) that forwards `/api/*` to `http://127.0.0.1:11434`. To enable cloud-model browsing in the web UI, also forward `/ollama-www/*` to `https://ollama.com/*` (the Vite dev server does this automatically).

> **Cloud models**: Both interfaces can run [Ollama cloud models](https://ollama.com/search?c=cloud) (e.g. `gpt-oss:120b-cloud`). Run `ollama signin` first, then pull/select the model. In the CLI use `/cloud` to browse; in the web UI click the **☁ CLOUD** button next to the model selector.

## CLI Commands

| Command | Description |
|---------|-------------|
| `/help` | Show command reference |
| `/persona <name>` | Switch persona: `hacker`, `philosopher`, or `standard` |
| `/models` | List installed models (numbered, active marked, with sizes) |
| `/model <n\|name>` | Switch the active model by list number or name (e.g. `/model 2`) |
| `/cloud [name]` | Browse Ollama cloud models; `/cloud <name>` shows its runnable tags |
| `/pull <name>` | Download a model from the Ollama registry |
| `/sessions` | List saved chat sessions |
| `/load <idx>` | Resume a session by index number |
| `/new` | Save current session and start a new one |
| `/clear` | Clear chat history in the current session |
| `/temp <val>` | Set temperature (0.0–2.0, default 0.7) |
| `/top_p <val>` | Set top_p sampling (0.0–1.0, default 0.9) |
| `/ctx <val>` | Set context window in tokens (default 2048) |
| `/exit` | Exit the CLI |

## Personas

| Persona | Alias | Behavior |
|---------|-------|----------|
| Cynical Cyber-Raccoon | `hacker` | Sarcastic, technically competent, uses raccoon metaphors |
| Garbage Philosopher | `philosopher` | Existential, frames wisdom around cosmic trash |
| Smart Assistant | `standard` | Polite, structured, and helpful |

## Architecture

| Component | Language | Directory |
|-----------|----------|-----------|
| CLI | Go | `cli-go/` |
| Web UI | TypeScript + React + Vite | `src/` |
| Markdown parser (WASM) | Go → WASM | `cli-go/wasm/` |

Session data is stored at `~/.bandit_ai/sessions/` (CLI) and in `localStorage` (web UI).

## Development

```bash
npm run dev          # Vite dev server
npm run build        # TypeScript typecheck + production build
npm run lint         # ESLint
npm test             # Vitest (TypeScript tests)
npm run test:watch   # Vitest in watch mode
npm run build:cli    # Rebuild the Go CLI binary
npm run build:wasm   # Rebuild the WASM markdown parser
cd cli-go && go test ./... -v   # Go tests
```

## Tech Stack

- **CLI**: Go, ANSI escape sequences, `crypto/rand`
- **Web UI**: React 19, TypeScript, Vite, Lucide icons
- **Engine**: Ollama HTTP API (`http://127.0.0.1:11434`)
