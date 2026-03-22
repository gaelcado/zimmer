#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/ui"
echo "Installing npm dependencies..."
npm install --prefer-offline --no-audit
echo "Building UI..."
npm run build
echo "Done. Launch hermes to open Zimmer at http://127.0.0.1:7778"
