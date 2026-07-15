#!/bin/sh
# Regenerate packaging/homebrew/bandit.rb for a given release tag.
#
#   ./packaging/homebrew/update-formula.sh [TAG]
#
# With no argument it uses the newest release (including pre-releases).
# After running, copy the regenerated bandit.rb into your homebrew-bandit
# tap repo at Formula/bandit.rb and commit it.
set -eu

REPO="BitsOfJT/bandit-ai"
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OUT="$DIR/bandit.rb"

tag="${1:-}"
if [ -z "$tag" ]; then
	tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
		| grep -m1 '"tag_name"' \
		| sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi
[ -n "$tag" ] || { echo "could not resolve release tag" >&2; exit 1; }

base="https://github.com/$REPO/releases/download/$tag"
version="$(printf '%s' "$tag" | sed 's/^[vV]//')"

sha_for() {
	t="$(mktemp)"
	curl -fsSL -o "$t" "$base/$1" || { echo "download failed: $base/$1" >&2; exit 1; }
	shasum -a 256 "$t" | awk '{print $1}'
	rm -f "$t"
}

echo "Resolving SHAs for $tag..." >&2
mac_sha="$(sha_for bandit)"
linux_sha="$(sha_for bandit-linux)"

cat > "$OUT" <<EOF
# Homebrew formula for Bandit AI.
#
# This file belongs in a SEPARATE tap repo named \`homebrew-bandit\`
# (github.com/BitsOfJT/homebrew-bandit), at Formula/bandit.rb. Once it is
# published there, users install with:
#
#   brew install BitsOfJT/bandit/bandit
#
# Regenerate on each release with packaging/homebrew/update-formula.sh.
class Bandit < Formula
  desc "Local-first AI chatbot CLI with a retro cyberpunk aesthetic"
  homepage "https://github.com/$REPO"
  version "$version"

  on_macos do
    if Hardware::CPU.arm?
      url "$base/bandit"
      sha256 "$mac_sha"
    else
      odie "Bandit only ships an Apple Silicon binary. Build from source: #{homepage}#build-from-source"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "$base/bandit-linux"
      sha256 "$linux_sha"
    else
      odie "Bandit only ships an amd64 Linux binary. Build from source: #{homepage}#build-from-source"
    end
  end

  def install
    if OS.mac?
      bin.install "bandit"
    else
      bin.install "bandit-linux" => "bandit"
    end
  end

  def caveats
    <<~CAVEATS
      Bandit needs Ollama running locally before it can chat:
        https://ollama.com

      Then pull a model, e.g.:
        ollama pull gemma4:e2b
    CAVEATS
  end

  test do
    assert_match "Bandit", pipe_output("#{bin}/bandit", "/exit\\n")
  end
end
EOF

echo "Wrote $OUT for $tag (version $version)" >&2
echo "  macOS  sha256: $mac_sha" >&2
echo "  Linux  sha256: $linux_sha" >&2
