#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HOOK_DIR="$HERMES_HOME/hooks/zimmer_gateway_bridge"
UI_DIST="$ROOT_DIR/ui/dist/index.html"

ok=0
warn=0
err=0

pass() { echo "PASS: $*"; ((ok+=1)); }
note() { echo "WARN: $*"; ((warn+=1)); }
fail() { echo "FAIL: $*"; ((err+=1)); }

echo "Zimmer doctor"
echo "  root: $ROOT_DIR"
echo "  hermes_home: $HERMES_HOME"
echo

if [[ -f "$ROOT_DIR/plugin.yaml" ]]; then
  pass "plugin manifest present"
else
  fail "plugin.yaml missing"
fi

if [[ -f "$UI_DIST" ]]; then
  pass "UI dist built ($UI_DIST)"
else
  fail "UI dist missing; run ./install.sh"
fi

if [[ -f "$HOOK_DIR/HOOK.yaml" && -f "$HOOK_DIR/handler.py" ]]; then
  pass "gateway hook files installed ($HOOK_DIR)"
else
  fail "gateway hook files missing; run ./install.sh"
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet hermes-gateway.service; then
    pass "hermes-gateway.service is active"
    if journalctl --user -u hermes-gateway.service -n 200 --no-pager \
      | grep -q "Loaded hook 'zimmer_gateway_bridge'"; then
      pass "gateway loaded zimmer_gateway_bridge hook"
    else
      note "gateway active but hook-load log line not found; restart gateway and check logs"
    fi
  else
    note "hermes-gateway.service is not active (fine for CLI-only usage)"
  fi
else
  note "systemctl not available; cannot check gateway status"
fi

echo
echo "Summary: PASS=$ok WARN=$warn FAIL=$err"
if (( err > 0 )); then
  exit 1
fi
