"""Honcho integration reader for Zimmer UI.

Reads ~/.honcho/config.json, connects to Honcho SDK when available,
and exposes session/peer/representation data for the UI.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path.home() / ".honcho" / "config.json"
_HOST = "hermes"


def _read_config() -> dict[str, Any]:
    """Read raw ~/.honcho/config.json. Returns {} if missing or invalid."""
    try:
        if _CONFIG_PATH.exists():
            return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read %s: %s", _CONFIG_PATH, e)
    return {}


def _write_config(data: dict[str, Any]) -> dict[str, Any]:
    """Write ~/.honcho/config.json. Returns {"ok": True} or error dict."""
    try:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CONFIG_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return {"ok": True}
    except (OSError, TypeError) as e:
        return {"ok": False, "error": str(e)}


def _resolve_host_config(raw: dict) -> dict[str, Any]:
    """Resolve the effective config for the 'hermes' host block."""
    host_block = (raw.get("hosts") or {}).get(_HOST, {})
    return {
        "enabled": host_block.get("enabled", raw.get("enabled", False)),
        "workspace": host_block.get("workspace") or raw.get("workspace") or _HOST,
        "peer_name": host_block.get("peerName") or raw.get("peerName") or None,
        "ai_peer": host_block.get("aiPeer") or raw.get("aiPeer") or _HOST,
        "memory_mode": host_block.get("memoryMode") or raw.get("memoryMode", "hybrid"),
        "recall_mode": host_block.get("recallMode") or raw.get("recallMode", "hybrid"),
        "write_frequency": host_block.get("writeFrequency") or raw.get("writeFrequency", "async"),
        "session_strategy": host_block.get("sessionStrategy") or raw.get("sessionStrategy", "per-session"),
        "save_messages": host_block.get("saveMessages", raw.get("saveMessages", True)),
        "dialectic_reasoning_level": (
            host_block.get("dialecticReasoningLevel")
            or raw.get("dialecticReasoningLevel", "low")
        ),
        "dialectic_max_chars": int(
            host_block.get("dialecticMaxChars")
            or raw.get("dialecticMaxChars", 600)
        ),
    }


def get_honcho_status() -> dict[str, Any]:
    """Return Honcho config status for the UI."""
    raw = _read_config()
    if not raw:
        return {"configured": False, "enabled": False}

    resolved = _resolve_host_config(raw)
    has_key = bool(raw.get("apiKey") or os.environ.get("HONCHO_API_KEY"))

    return {
        "configured": has_key,
        "enabled": resolved["enabled"] and has_key,
        "peer_name": resolved["peer_name"],
        "ai_peer": resolved["ai_peer"],
        "workspace": resolved["workspace"],
        "memory_mode": resolved["memory_mode"],
        "recall_mode": resolved["recall_mode"],
        "session_strategy": resolved["session_strategy"],
    }


def get_honcho_config() -> dict[str, Any]:
    """Return the full config for editing."""
    raw = _read_config()
    return {
        "path": str(_CONFIG_PATH),
        "content": json.dumps(raw, indent=2, ensure_ascii=False) if raw else "",
        "exists": bool(raw),
        "resolved": _resolve_host_config(raw) if raw else {},
    }


def update_honcho_config(content: str) -> dict[str, Any]:
    """Validate and write updated config JSON."""
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Invalid JSON: {e}"}
    if not isinstance(data, dict):
        return {"ok": False, "error": "Config must be a JSON object"}
    return _write_config(data)


def _get_client():
    """Get a Honcho SDK client. Returns None if not available."""
    raw = _read_config()
    api_key = raw.get("apiKey") or os.environ.get("HONCHO_API_KEY")
    if not api_key:
        return None

    host_block = (raw.get("hosts") or {}).get(_HOST, {})
    workspace = host_block.get("workspace") or raw.get("workspace") or _HOST

    try:
        from honcho import Honcho
        return Honcho(
            api_key=api_key,
            workspace_id=workspace,
        )
    except Exception as e:
        logger.warning("Failed to create Honcho client: %s", e)
        return None


def list_honcho_sessions() -> list[dict[str, Any]]:
    """List Honcho sessions with their peers."""
    client = _get_client()
    if not client:
        return []
    try:
        page = client.sessions()
        result = []
        for s in page.items:
            try:
                peers = [p.id for p in s.peers()]
            except Exception:
                peers = []
            result.append({
                "id": s.id,
                "peers": peers,
            })
        return result
    except Exception as e:
        logger.warning("Failed to list Honcho sessions: %s", e)
        return []


def list_honcho_peers() -> list[dict[str, Any]]:
    """List workspace-level peers with their representations."""
    client = _get_client()
    if not client:
        return []
    try:
        page = client.peers()
        result = []
        for p in page.items:
            rep = ""
            try:
                rep = p.representation() or ""
            except Exception:
                pass
            result.append({
                "id": p.id,
                "representation": rep[:2000] if rep else "",
            })
        return result
    except Exception as e:
        logger.warning("Failed to list Honcho peers: %s", e)
        return []


def get_honcho_session_context(session_id: str) -> dict[str, Any]:
    """Get context for a specific Honcho session."""
    client = _get_client()
    if not client:
        return {"error": "Honcho not configured"}
    try:
        s = client.session(session_id)
        ctx = s.context()
        messages_count = len(ctx.messages) if ctx.messages else 0
        return {
            "session_id": ctx.session_id,
            "summary": ctx.summary,
            "peer_representation": ctx.peer_representation,
            "peer_card": ctx.peer_card,
            "messages_count": messages_count,
        }
    except Exception as e:
        return {"error": str(e)}


def get_peer_representation(peer_id: str) -> dict[str, Any]:
    """Get a workspace peer's full representation."""
    client = _get_client()
    if not client:
        return {"error": "Honcho not configured"}
    try:
        peer = client.peer(peer_id)
        rep = peer.representation() or ""
        return {"id": peer_id, "representation": rep}
    except Exception as e:
        return {"error": str(e)}
