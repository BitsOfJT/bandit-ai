# Handoff — Bandit AI v0.3.0 (full-soul persona + model preload + release)

> For the next AI/engineer picking this up. Written 2026-06-16. Approved plan lives at
> `/Users/jordanthompson/.claude/plans/ok-what-do-i-dapper-blanket.md`.

## Goal
Ship Bandit AI as a finished **v0.3.0** with three changes:
1. Make `bandit-soul.md` (the rich 6KB persona doc) the **default persona**, injected **verbatim**.
2. Fix the known **model-switch delay** (Ollama cold-load on first chat).
3. **Reconcile** the redundant `soul.md` and **cut the v0.3.0 release**.

Bandit AI = local-first Ollama chatbot, two front-ends: Go CLI in `cli-go/`, Vite/React web in `src/`.

## Key decisions (already made with the user — do not relitigate)
- Persona wiring: **inject the FULL `bandit-soul.md` verbatim** as the system prompt for the
  **default `hacker` persona only**. `philosopher`/`standard` keep their short prompts.
- `hacker` is already the launch default in both apps, so this = full-soul Bandit out of the box.
- **Single source of truth:** repo-root `bandit-soul.md`.
  - Web imports it directly: `src/persona.ts` does `import banditSoul from '../bandit-soul.md?raw'`.
  - Go can't `//go:embed` across `..`, so `cli-go/bandit-soul.md` is a **mirror**, guarded by a
    drift test (`cli-go/persona_test.go`) and regenerated via `go generate ./...`.
- **Accepted side effect:** sessions saved before v0.3.0 carrying the OLD short hacker prompt now
  reverse-match to `custom` (not `hacker`). Call this out in release notes. Do NOT add a migration
  unless asked.

## DONE (code complete, see `git status`)
Persona — web:
- `src/persona.ts` (new): exports `BANDIT_SOUL` from `../bandit-soul.md?raw`.
- `src/App.tsx`: imports `BANDIT_SOUL`; `PERSONALITY_PRESETS.hacker.prompt = BANDIT_SOUL`.

Persona — Go:
- `cli-go/bandit-soul.md` (new): mirror of root file.
- `cli-go/persona.go` (new): `//go:embed bandit-soul.md` + `//go:generate cp ../bandit-soul.md ./bandit-soul.md`
  + `init()` that sets `PersonalityPresets["hacker"].Prompt = strings.TrimSpace(banditSoul)`.
- `cli-go/preset.go`: hacker entry `Prompt: ""` (now populated at init).
- `cli-go/persona_test.go` (new): `TestBanditSoulMirrorInSync` (drift guard) + `TestHackerPersonaIsSoul`.

Model-switch preload — web:
- `src/ollama.ts`: new `preloadModel(model)` → POST `/api/generate` `{model, prompt:'', keep_alive:'10m'}`, errors swallowed.
- `src/App.tsx`: `modelWarming` state; `handleModelChange` fires `preloadModel` (only if `model && isConnected`)
  and clears warming in `.finally`; renders a "Warming up <model>…" indicator near the model `<select>`.

Model-switch preload — Go:
- `cli-go/ollama.go`: new `preloadModel(model string) error` (POST `/api/generate`, empty prompt, 60s timeout).
- `cli-go/main.go`: `/model` switch `found` branch prints "Warming up …" and calls `preloadModel`.

Reconcile:
- `soul.md` deleted (`git rm`). `bandit-soul.md` is canonical.

Test fix:
- `src/__tests__/App.session.test.tsx`: imports `BANDIT_SOUL`; its local `PERSONALITY_PRESETS.hacker.prompt`
  now = `BANDIT_SOUL`. (Without this, `makeSession`'s default short hacker prompt reverse-matched to
  `custom`, which renders the settings custom-prompt textarea and shadows `document.querySelector('textarea')`,
  disabling the send button — that was the only failing test.)

## VERIFICATION STATUS — ⚠️ NOT YET FULLY GREEN
- `npm test`: was 47/48 (the send-button test above). Test FIX applied but **NOT re-run** — re-run to confirm 48/48.
- `npm run build` (`tsc -b && vite build`): **NOT run yet**. Watch for: does `tsc -b` accept the `?raw`
  import (should — tsconfig.app.json has `"types": ["vite/client"]`). Does vitest resolve `?raw` (should — same vite pipeline).
- Go `gofmt -l .` / `go vet ./...` / `go test ./...`: **NOT run** (classifier was down at the time). Run them.
- Binaries (`bin/`) and `dist/`: **NOT rebuilt**.

## TODO (remaining work)
1. **Re-run web suite:** `npm test` → expect 48/48. Fix if not.
2. **Run Go checks:** `cd cli-go && gofmt -l . && go vet ./... && go test ./...` → all green.
   Verify drift guard works: edit `bandit-soul.md`, `go test ./cli-go` should FAIL until `go generate ./cli-go`.
3. **(Preferred) Add preload unit tests** — optional but in plan:
   - Web: `src/__tests__/ollama.test.ts` — assert `preloadModel` POSTs `/api/generate` with empty prompt (MSW, follow existing pattern).
   - Go: `cli-go/ollama_test.go` — httptest server asserts `/api/generate` hit with empty prompt (follow existing pattern; tests point `OllamaHost` at the test server).
4. **Build-script single-source guard (Task 4 leftover):** add a mirror-sync step to the `build:cli*` scripts
   in `package.json` so `cli-go/bandit-soul.md` can't go stale on build. Suggested: prepend
   `go generate -C cli-go ./... &&` (or `cp bandit-soul.md cli-go/bandit-soul.md &&`) to `build:cli`.
5. **Version bump 0.2.1 → 0.3.0:** `package.json` (`"version"`), `packaging/homebrew/bandit.rb`.
6. **Rebuild artifacts:** `npm run build` (refreshes `dist/`), `npm run build:cli:all` (refreshes
   `bin/bandit`, `bin/bandit-linux`, `bin/bandit.exe`).
7. **git hygiene:** `bandit-soul.md`, `cli-go/bandit-soul.md`, `cli-go/persona.go`, `cli-go/persona_test.go`,
   `src/persona.ts` are untracked — `git add` them. NOTE `.opencode/` is also untracked — confirm with user
   whether to commit/ignore it (likely add to `.gitignore`; not part of this feature).
8. **Cut the release (OUTWARD-FACING — confirm with user before pushing):**
   - New branch (not `main`), commit, open PR.
   - `gh release create v0.3.0` with the three binaries + release notes (call out: full-soul default
     persona, instant model switching, and the "old hacker sessions show as Custom" note).
   - Bump SHAs/version in `packaging/homebrew/bandit.rb` via `packaging/homebrew/update-formula.sh`,
     then sync to the `BitsOfJT/homebrew-bandit` tap repo.

## How to manually verify end-to-end (needs Ollama running + a model pulled)
- Web: `npm run dev` → default chat is in-character full-soul Bandit (raccoon metaphors, snark).
- CLI: `bin/bandit` → `/persona` shows `hacker`; first reply in-character. `/persona standard` → clean assistant.
- Model switch (both UIs): switch model, immediately send — first token should be near-instant; a
  "Warming up…" indicator shows during preload.

## Gotchas / notes
- 6KB verbatim system prompt (incl. markdown tables + meta-text) is the user's explicit choice. If a
  local model behaves oddly, the fallback is a distilled prompt — NOT in scope now; ask first.
- `cli-go/bandit-soul.md` had `0600` perms when copied from the root file (which was `0600`). Harmless
  (git tracks only the exec bit) but `chmod 644` if you want it tidy.
- Two subagents were spawned to verify web/Go in parallel but both hit transient **500 server errors**
  (Go agent did 0 tool calls). All code above was written directly, not by those agents — don't trust any
  partial agent output; trust `git diff`.

## Task tracker (harness tasks, for reference)
1 web persona — code done, test re-run pending · 2 Go persona — code done, tests unrun ·
3 preload — code done, tests unrun · 4 reconcile+build scripts — soul.md deleted, build-script edit pending ·
5 build/test/release — pending.
