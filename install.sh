#!/usr/bin/env bash
set -euo pipefail

REPO_TARBALL="https://github.com/Nextbasedev/nextbase-cli/archive/refs/heads/master.tar.gz"
INSTALL_DIR="${WISPER_INSTALL_DIR:-$HOME/.wisper-cli/app}"
BIN_DIR="${WISPER_BIN_DIR:-$HOME/.local/bin}"
NEXTBASE_BIN_PATH="$BIN_DIR/nextbase"
BIN_PATH="$BIN_DIR/wisper"
NOTEBOT_BIN_PATH="$BIN_DIR/notebot"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    echo "Please install Node.js/npm first: https://nodejs.org" >&2
    exit 1
  fi
}

need node
need npm
need curl
need tar

if ! command -v sox >/dev/null 2>&1 && ! command -v rec >/dev/null 2>&1; then
  echo "Warning: SoX is recommended for microphone recording."
  echo "macOS: brew install sox"
  echo "Linux: sudo apt install sox"
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

stop_existing_processes() {
  echo "Stopping existing Wisper/NoteBot processes..."
  for pid_file in "$HOME/.wisper-cli/listener.pid" "$HOME/.notebot/dashboard.pid"; do
    if [ -f "$pid_file" ]; then
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      case "$pid" in
        ''|*[!0-9]*) ;;
        *) kill "$pid" 2>/dev/null || true ;;
      esac
      rm -f "$pid_file"
    fi
  done
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "$INSTALL_DIR/dist/(cli|notebot-cli|nextbase-cli)\.js" | while read -r pid; do
      [ "$pid" = "$$" ] || kill "$pid" 2>/dev/null || true
    done
  fi
  sleep 0.7
}

echo "Downloading Wisper CLI..."
curl -fsSL "$REPO_TARBALL" -o "$TMP_DIR/wisper-cli.tar.gz"
tar -xzf "$TMP_DIR/wisper-cli.tar.gz" -C "$TMP_DIR"

stop_existing_processes
rm -rf "$INSTALL_DIR"
mv "$TMP_DIR/nextbase-cli-master" "$INSTALL_DIR"

cd "$INSTALL_DIR"
echo "Installing dependencies..."
export NODE_ENV=development
export npm_config_production=false
export npm_config_cache="$TMP_DIR/npm-cache"
npm install --include=dev --production=false --cache "$TMP_DIR/npm-cache" --silent
if [ ! -d "$INSTALL_DIR/node_modules/clipboardy" ]; then
  echo "Dependency install failed: node_modules/clipboardy not found" >&2
  exit 1
fi
if [ ! -d "$INSTALL_DIR/node_modules/@types/node" ]; then
  npm install --save-dev @types/node typescript --cache "$TMP_DIR/npm-cache" --silent
fi

echo "Building CLI..."
npm run build --silent
if [ ! -f "$INSTALL_DIR/dist/cli.js" ]; then
  echo "Local TypeScript build did not produce dist; trying npx fallback..."
  npx --yes --cache "$TMP_DIR/npm-cache" -p typescript -p @types/node tsc -p tsconfig.json
fi
for required in "$INSTALL_DIR/dist/nextbase-cli.js" "$INSTALL_DIR/dist/cli.js" "$INSTALL_DIR/dist/notebot-cli.js"; do
  if [ ! -f "$required" ]; then
    echo "Build completed but $required was not found. Install aborted." >&2
    exit 1
  fi
done
chmod +x "$INSTALL_DIR/dist/nextbase-cli.js" "$INSTALL_DIR/dist/cli.js" "$INSTALL_DIR/dist/notebot-cli.js"

ln -sf "$INSTALL_DIR/dist/nextbase-cli.js" "$NEXTBASE_BIN_PATH"
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_PATH"
ln -sf "$INSTALL_DIR/dist/notebot-cli.js" "$NOTEBOT_BIN_PATH"

if command -v node >/dev/null 2>&1; then
  node -e "fetch('https://api.github.com/repos/Nextbasedev/nextbase-cli/commits/master?x=' + Date.now(), { headers: { 'user-agent': 'wisper-cli-installer' } }).then(r => r.json()).then(j => j.sha && require('fs').writeFileSync(require('path').join(require('os').homedir(), '.wisper-cli', 'installed-sha'), j.sha)).catch(() => {})" || true
fi

case ":$PATH:" in
  *":$BIN_DIR:"*)
    PATH_OK=1
    ;;
  *)
    PATH_OK=0
    ;;
esac

# Make the command available in future Terminal sessions too. macOS uses zsh by
# default; use bash profile files on Linux/bash shells. Keep this idempotent.
PATH_EXPORT="export PATH=\"$BIN_DIR:\$PATH\""
if [ "$PATH_OK" = "0" ]; then
  if [ "${SHELL##*/}" = "zsh" ]; then
    PROFILE="${ZDOTDIR:-$HOME}/.zshrc"
  else
    PROFILE="$HOME/.bashrc"
  fi
  touch "$PROFILE"
  if ! grep -Fqx "$PATH_EXPORT" "$PROFILE"; then
    printf '\n# Nextbase CLI / Wisper\n%s\n' "$PATH_EXPORT" >> "$PROFILE"
  fi
  export PATH="$BIN_DIR:$PATH"
fi

echo ""
echo "Nextbase CLI installed."
echo "Binaries: $NEXTBASE_BIN_PATH, $BIN_PATH, $NOTEBOT_BIN_PATH"

if [ "$PATH_OK" = "0" ]; then
  echo "Added $BIN_DIR to your shell profile. Open a new Terminal, or run:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "Run: nextbase"
fi
