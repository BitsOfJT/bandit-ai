#!/bin/sh
# Bandit AI CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/BitsOfJT/bandit-ai/main/install.sh | sh
#
# Downloads the correct pre-built `bandit` binary from the latest GitHub
# release and installs it onto your PATH. Because curl (unlike a browser)
# does NOT set the macOS quarantine flag, the binary runs without tripping
# Gatekeeper.
#
# Environment overrides:
#   BANDIT_INSTALL_DIR   install location (default: /usr/local/bin, falling
#                        back to $HOME/.local/bin if that is not writable)
#   BANDIT_VERSION       release tag to install (default: latest release)
set -eu

REPO="BitsOfJT/bandit-ai"
BIN_NAME="bandit"

# --- pretty output -----------------------------------------------------------
if [ -t 1 ]; then
	GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
else
	GREEN=''; YELLOW=''; RED=''; BOLD=''; RESET=''
fi
info()  { printf '%b\n' "${GREEN}==>${RESET} $*"; }
warn()  { printf '%b\n' "${YELLOW}warning:${RESET} $*" >&2; }
die()   { printf '%b\n' "${RED}error:${RESET} $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required but not installed."

# --- detect platform ---------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
	Darwin)
		case "$arch" in
			arm64|aarch64) asset="bandit" ;;
			*) die "no pre-built macOS binary for '$arch' (only Apple Silicon is published).\n        Build from source: https://github.com/$REPO#build-from-source" ;;
		esac ;;
	Linux)
		case "$arch" in
			x86_64|amd64) asset="bandit-linux" ;;
			*) die "no pre-built Linux binary for '$arch' (only amd64 is published).\n        Build from source: https://github.com/$REPO#build-from-source" ;;
		esac ;;
	*)
		die "unsupported OS '$os'. On Windows, download bandit.exe from the Releases page." ;;
esac

# --- resolve release tag -----------------------------------------------------
# Note: releases are currently marked pre-release, so the /releases/latest
# endpoint returns nothing. We read /releases and take the newest entry.
if [ "${BANDIT_VERSION:-}" != "" ]; then
	tag="$BANDIT_VERSION"
else
	info "Finding the latest Bandit release..."
	tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
		| grep -m1 '"tag_name"' \
		| sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
	[ -n "$tag" ] || die "could not determine the latest release tag."
fi

url="https://github.com/$REPO/releases/download/$tag/$asset"

# --- choose install dir ------------------------------------------------------
install_dir="${BANDIT_INSTALL_DIR:-/usr/local/bin}"
use_sudo=""
if [ ! -d "$install_dir" ] || [ ! -w "$install_dir" ]; then
	if [ -w "$(dirname "$install_dir")" ] 2>/dev/null; then
		mkdir -p "$install_dir"
	elif command -v sudo >/dev/null 2>&1 && [ "${BANDIT_INSTALL_DIR:-}" = "" ]; then
		use_sudo="sudo"
	else
		install_dir="$HOME/.local/bin"
		mkdir -p "$install_dir"
	fi
fi

# --- download & install ------------------------------------------------------
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT INT TERM
info "Downloading ${BOLD}$asset${RESET} from $tag..."
curl -fsSL -o "$tmp" "$url" || die "download failed: $url"
chmod 0755 "$tmp"

dest="$install_dir/$BIN_NAME"
info "Installing to ${BOLD}$dest${RESET}..."
$use_sudo mv "$tmp" "$dest" || die "could not move binary to $dest"
trap - EXIT INT TERM

# --- done --------------------------------------------------------------------
printf '%b\n' "${GREEN}${BOLD}Bandit installed!${RESET} ($tag)"
case ":$PATH:" in
	*":$install_dir:"*) printf '%b\n' "Run ${BOLD}bandit${RESET} to start." ;;
	*) warn "$install_dir is not on your PATH. Add it, e.g.:\n        export PATH=\"$install_dir:\$PATH\"\n        then run: bandit" ;;
esac
printf '%b\n' "${YELLOW}Note:${RESET} Bandit needs Ollama running locally (https://ollama.com)."
