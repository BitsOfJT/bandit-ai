# Homebrew tap for Bandit

`brew install BitsOfJT/bandit/bandit` requires a **separate** GitHub repo named
`homebrew-bandit` (the `homebrew-` prefix is mandatory — Homebrew strips it, so
the tap is referenced as `BitsOfJT/bandit`).

## One-time tap setup

1. Create a new public repo: `github.com/BitsOfJT/homebrew-bandit`.
2. Add the formula at `Formula/bandit.rb` (copy it from this directory):
   ```bash
   # from a clone of homebrew-bandit
   mkdir -p Formula
   cp /path/to/bandit-ai/packaging/homebrew/bandit.rb Formula/bandit.rb
   git add Formula/bandit.rb && git commit -m "bandit 0.2.0" && git push
   ```
3. Users can now install with the **fully-qualified** name:
   ```bash
   brew install BitsOfJT/bandit/bandit
   ```
   > Do not advertise the bare `brew install bandit` — that name belongs to an
   > unrelated formula in Homebrew core (a Python security scanner). Always use
   > `BitsOfJT/bandit/bandit`.

## On every new release

The formula pins a `version` and a `sha256` per platform, so it must be bumped
whenever you publish a release. Regenerate it from this repo:

```bash
./packaging/homebrew/update-formula.sh            # newest release
./packaging/homebrew/update-formula.sh v0.3.0     # a specific tag
```

Then copy the regenerated `bandit.rb` into the tap repo's `Formula/bandit.rb`,
commit, and push.

## Notes

- The formula installs the pre-built release binaries (Apple Silicon macOS and
  amd64 Linux). Intel macOS / arm64 Linux are not published — the formula
  `odie`s with a build-from-source pointer on those.
- Validate locally before pushing:
  ```bash
  brew install --build-from-source --verbose ./packaging/homebrew/bandit.rb
  brew audit --strict bandit
  brew test bandit
  ```
