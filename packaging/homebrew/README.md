# Homebrew tap for Bandit (Python CLI)

Users install with:

```bash
brew install BitsOfJT/bandit/bandit
```

> Do **not** advertise bare `brew install bandit` — that name is taken by
> Homebrew core’s unrelated security linter.

## One-time tap setup

The formula belongs in a separate public repo named `homebrew-bandit`:

```bash
# in a clone of github.com/BitsOfJT/homebrew-bandit
mkdir -p Formula
cp /path/to/bandit-ai/packaging/homebrew/bandit.rb Formula/bandit.rb
git add Formula/bandit.rb && git commit -m "bandit 0.4.0" && git push
```

## On every release

```bash
# from the bandit-ai repo, after the git tag exists on GitHub
./packaging/homebrew/update-formula.sh v0.4.0
# copy into homebrew-bandit and push
```
