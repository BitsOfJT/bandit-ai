# AGENTS.md — Bandit AI

## Architecture

Two separate codebases in one repo:

| Component | Language | Entrypoint | Directory |
|-----------|----------|------------|-----------|
| Web UI | TypeScript + React + Vite | `src/main.tsx` | `src/` |
| CLI | Go | `cli-go/main.go` | `cli-go/` |
| WASM markdown parser | Go → WASM | `cli-go/wasm/main.go` | `cli-go/wasm/` |

The CLI is a **compiled Go binary** (`bin/bandit`), not a Node.js script. The `npm run cli` script just executes the pre-built binary.

## Commands

```bash
npm run dev          # Vite dev server (web UI at http://localhost:5173)
npm run build        # tsc -b && vite build  (typecheck FIRST, then bundle)
npm run lint         # eslint . (ignores dist/, does NOT lint Go code)
npm run cli          # ./bin/bandit (runs pre-built Go CLI binary)
npm run build:cli    # go build -C cli-go -o ../bin/bandit .
npm run build:wasm   # GOOS=js GOARCH=wasm go build -C cli-go/wasm -o ../../public/markdown.wasm .
```

**Build order matters**: `npm run build` runs `tsc -b` first. If TypeScript typechecking fails, Vite build is skipped.

## Ollama dependency

Both CLI and web UI require Ollama running on `http://127.0.0.1:11434`.

- **Web UI**: Calls go through Vite's dev server proxy (`/api` → `http://127.0.0.1:11434`). Configured in `vite.config.ts:8-13`.
- **CLI**: Connects directly to Ollama (`cli-go/ollama.go:13`).

## TypeScript strictness

`tsconfig.app.json` enforces:
- `noUnusedLocals: true` — unused variables fail the build
- `noUnusedParameters: true` — unused function params fail the build
- `verbatimModuleSyntax: true` — must use `import type` for type-only imports
- `erasableSyntaxOnly: true` — no enums, no namespaces

## Session storage

- **CLI**: JSON files at `~/.bandit_ai/sessions/` (one `.json` file per session)
- **Web UI**: `localStorage` key `bandit_chat_sessions`

The two storage systems are independent and do not share data.

## WASM markdown parser

The web UI loads a Go-compiled WASM module (`public/markdown.wasm`) for markdown block parsing. It requires `public/wasm_exec.js` (Go's JS support glue). If the WASM fails to load, `Markdown.tsx` falls back to a pure-JS parser.

Rebuild WASM after changing `cli-go/wasm/main.go`:
```bash
npm run build:wasm
```

## Pre-built binaries

`bin/bandit`, `bin/bandit-linux`, and `bin/bandit.exe` are committed to the repo. After changing Go CLI code, rebuild with `npm run build:cli` (or `build:cli:all` for all platforms).

## Tests

```bash
npm test            # Vitest — TypeScript/React unit tests (jsdom environment)
npm run test:watch  # Vitest in watch mode
cd cli-go && go test ./... -v  # Go standard tests (use -vet=off if go vet fails on main.go)
```

Test files:
- `src/__tests__/Markdown.test.tsx` — Markdown renderer (18 tests)
- `src/__tests__/ollama.test.ts` — Ollama API client with MSW mocking (14 tests)
- `src/__tests__/App.session.test.tsx` — Session lifecycle handlers (12 tests)
- `cli-go/formatter_test.go` — ANSI formatter (14 tests)
- `cli-go/session_test.go` — Session persistence (5 tests)
- `cli-go/ollama_test.go` — Ollama HTTP client with httptest (11 tests)
- `cli-go/main_test.go` — CLI command dispatch (26 tests)

## Security

- CSP meta tag in `index.html` — do not remove or weaken without review
- Session files use `0600` permissions (owner-only) — `cli-go/session.go:59`
- Model names validated against `^[a-zA-Z0-9_:./-]+$` in both CLI and web UI
- No hardcoded secrets, no shell command execution, no raw HTML injection

## Production proxy requirement

The Vite dev server proxies `/api` → Ollama. In production, you must configure a reverse proxy to forward `/api/*` to `http://127.0.0.1:11434`. Without this, the web UI cannot reach Ollama outside `npm run dev`.
