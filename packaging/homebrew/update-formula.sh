#!/bin/sh
# Refresh packaging/homebrew/bandit.rb for a given release tag.
#
#   ./packaging/homebrew/update-formula.sh [TAG]
#
# Default TAG is v0.4.0. After running, copy bandit.rb into
# BitsOfJT/homebrew-bandit at Formula/bandit.rb and push.
set -eu

REPO="BitsOfJT/bandit-ai"
tag="${1:-v0.4.0}"
root="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"
formula="$root/packaging/homebrew/bandit.rb"
url="https://github.com/$REPO/archive/refs/tags/${tag}.tar.gz"

echo "Fetching $url …"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT INT TERM
curl -fsSL -o "$tmp" "$url"
sha="$(shasum -a 256 "$tmp" | awk '{print $1}')"
echo "sha256 $sha"

# Rewrite url + version + sha256 in the formula.
version="${tag#v}"
python3 - "$formula" "$tag" "$version" "$url" "$sha" <<'PY'
import pathlib, re, sys
path, tag, version, url, sha = sys.argv[1:]
text = pathlib.Path(path).read_text(encoding="utf-8")
text = re.sub(r'version "[^"]*"', f'version "{version}"', text, count=1)
text = re.sub(
    r'url "https://github.com/BitsOfJT/bandit-ai/archive/refs/tags/[^"]+"',
    f'url "{url}"',
    text,
    count=1,
)
text = re.sub(r'sha256 "[0-9a-f]{64}"', f'sha256 "{sha}"', text, count=1)
pathlib.Path(path).write_text(text, encoding="utf-8")
print(f"Updated {path} -> {tag}")
PY
