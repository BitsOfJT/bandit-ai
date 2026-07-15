#!/bin/sh
# Bandit AI CLI installer (Python).
#
#   curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
#
# Installs the `bandit` console script via uv (preferred), pipx, or pip.
# Requires Python 3.11+.
#
# Environment overrides:
#   BANDIT_VERSION   git tag / ref to install (default: newest suitable release, else v0.4.0)
set -eu

REPO="BitsOfJT/bandit-ai"
DEFAULT_TAG="v0.4.0"

if [ -t 1 ]; then
	GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
else
	GREEN=''; YELLOW=''; RED=''; BOLD=''; RESET=''
fi
info()  { printf '%b\n' "${GREEN}==>${RESET} $*"; }
warn()  { printf '%b\n' "${YELLOW}warning:${RESET} $*" >&2; }
die()   { printf '%b\n' "${RED}error:${RESET} $*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

command -v curl >/dev/null 2>&1 || die "curl is required but not installed."

# --- resolve tag -------------------------------------------------------------
if [ "${BANDIT_VERSION:-}" != "" ]; then
	tag="$BANDIT_VERSION"
else
	info "Finding the latest Bandit release tag…"
	tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
		| grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"v[^"]+"' \
		| head -1 \
		| sed -E 's/.*"([^"]+)".*/\1/' || true)"
	case "$tag" in
		v0.[4-9]*|v[1-9]*) ;;
		*) tag="$DEFAULT_TAG" ;;
	esac
fi

spec="git+https://github.com/$REPO.git@${tag}"
info "Installing Bandit ${BOLD}${tag}${RESET}…"

# --- install helpers ---------------------------------------------------------
ensure_uv() {
	if have uv; then
		return 0
	fi
	info "Installing uv (https://astral.sh/uv)…"
	curl -LsSf https://astral.sh/uv/install.sh | sh
	# shellcheck disable=SC1091
	[ -f "$HOME/.local/bin/env" ] && . "$HOME/.local/bin/env"
	PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
	export PATH
	have uv || die "uv installed but not on PATH. Open a new shell and re-run this installer."
}

install_with_uv() {
	ensure_uv
	uv tool install --force "$spec"
	uv tool update-shell >/dev/null 2>&1 || true
}

install_with_pipx() {
	pipx install --force "$spec"
}

install_with_pip() {
	py=""
	for c in python3.13 python3.12 python3.11 python3; do
		if have "$c" && "$c" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
			py="$c"
			break
		fi
	done
	[ -n "$py" ] || die "Python 3.11+ is required. Install Python, then re-run."
	"$py" -m pip install --user --upgrade --force-reinstall "$spec"
	warn "Installed with pip --user. Ensure ~/.local/bin is on your PATH."
}

# --- pick an installer -------------------------------------------------------
if have uv; then
	install_with_uv
elif have pipx; then
	install_with_pipx
else
	install_with_uv
fi

PATH="$HOME/.local/bin:$PATH"
export PATH
have bandit || die "install finished but 'bandit' is not on PATH. Try: export PATH=\"\$HOME/.local/bin:\$PATH\""

printf '%b\n' "${GREEN}${BOLD}Bandit installed!${RESET} ($tag)"
printf '%b\n' "Run ${BOLD}bandit${RESET} to start."
printf '%b\n' "${YELLOW}Note:${RESET} Bandit defaults to local Ollama (https://ollama.com)."
printf '%b\n' "      Pull a model: ${BOLD}ollama pull gemma4:e2b${RESET}"
printf '%b\n' "${YELLOW}Note:${RESET} Homebrew core also has an unrelated formula named ${BOLD}bandit${RESET}"
printf '%b\n' "      (a security linter). Prefer ${BOLD}uv tool${RESET} or ${BOLD}brew install BitsOfJT/bandit/bandit${RESET}."
