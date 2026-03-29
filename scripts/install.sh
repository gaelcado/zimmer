#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT_DIR/ui"
DIST_DIR="$UI_DIR/dist"
HERMES_HOOKS_DIR="${HERMES_HOME:-$HOME/.hermes}/hooks/zimmer_gateway_bridge"

mkdir -p "$HERMES_HOOKS_DIR"
cp -f "$ROOT_DIR/gateway_hook/HOOK.yaml" "$HERMES_HOOKS_DIR/HOOK.yaml"
cp -f "$ROOT_DIR/gateway_hook/handler.py" "$HERMES_HOOKS_DIR/handler.py"

if command -v npm >/dev/null 2>&1; then
  cd "$UI_DIR"
  echo "Installing npm dependencies..."
  npm install --prefer-offline --no-audit
  echo "Building UI..."
  npm run build
elif [[ -f "$DIST_DIR/index.html" ]]; then
  echo "npm not found; using prebuilt UI in $DIST_DIR"
else
  echo "ERROR: npm is not installed and no prebuilt ui/dist found."
  echo "Install Node.js 18+ (with npm) or use a release that ships prebuilt dist/"
  exit 1
fi

echo "Done."
echo "Zimmer gateway hook installed at $HERMES_HOOKS_DIR"
echo "Restart gateway to load hook updates: systemctl --user restart hermes-gateway.service"
echo "Open Zimmer at http://127.0.0.1:7778"
