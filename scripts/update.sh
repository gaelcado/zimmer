#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -d .git ]]; then
  echo "Updating Zimmer source..."
  git pull --ff-only
else
  echo "No .git directory found; skipping git pull."
fi

echo "Running install..."
"$ROOT_DIR/scripts/install.sh"

if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet hermes-gateway.service; then
    echo "Restarting hermes-gateway.service..."
    systemctl --user restart hermes-gateway.service
  else
    echo "Gateway service is not active; skip restart."
  fi
else
  echo "systemctl not found; restart gateway/CLI manually if running."
fi

echo "Zimmer update complete."
