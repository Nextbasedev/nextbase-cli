#!/usr/bin/env bash
set -euo pipefail

REPO_TARBALL="https://github.com/dix105/wisper-cli/archive/refs/heads/master.tar.gz"
INSTALL_DIR="${WISPER_INSTALL_DIR:-$HOME/.wisper-cli/app}"
BIN_DIR="${WISPER_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/wisper"
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

echo "Downloading Wisper CLI..."
curl -fsSL "$REPO_TARBALL" -o "$TMP_DIR/wisper-cli.tar.gz"
tar -xzf "$TMP_DIR/wisper-cli.tar.gz" -C "$TMP_DIR"

rm -rf "$INSTALL_DIR"
mv "$TMP_DIR/wisper-cli-master" "$INSTALL_DIR"

cd "$INSTALL_DIR"
echo "Installing dependencies..."
export NODE_ENV=development
export npm_config_production=false
npm install --include=dev --production=false --silent
if [ ! -d "$INSTALL_DIR/node_modules/clipboardy" ]; then
  echo "Dependency install failed: node_modules/clipboardy not found" >&2
  exit 1
fi
if [ ! -d "$INSTALL_DIR/node_modules/@types/node" ]; then
  npm install --save-dev @types/node typescript --silent
fi

echo "Building CLI..."
npm run build --silent
if [ ! -f "$INSTALL_DIR/dist/cli.js" ]; then
  echo "Local TypeScript build did not produce dist; trying npx fallback..."
  npx --yes -p typescript -p @types/node tsc -p tsconfig.json
fi
chmod +x "$INSTALL_DIR/dist/cli.js"

ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_PATH"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    PATH_OK=1
    ;;
  *)
    PATH_OK=0
    ;;
esac

echo ""
echo "Wisper CLI installed."
echo "Binary: $BIN_PATH"

if [ "$PATH_OK" = "0" ]; then
  echo ""
  echo "Add this to your shell profile so 'wisper' works everywhere:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
  echo ""
  echo "For this terminal only, run:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "Run: wisper setup"
fi
