"""Tests for Zimmer gateway hook bridge integration."""

from __future__ import annotations

import sys
import types

import zimmer
from zimmer.event_bus import EventBus
from zimmer.gateway_hook_bridge import handle_gateway_event


def _install_hermes_plugins_alias():
    """Expose imported zimmer module as hermes_plugins.zimmer."""
    pkg = types.ModuleType("hermes_plugins")
    pkg.__path__ = []  # type: ignore[attr-defined]
    pkg.zimmer = zimmer  # type: ignore[attr-defined]
    sys.modules["hermes_plugins"] = pkg
    sys.modules["hermes_plugins.zimmer"] = zimmer


def test_queue_command_and_agent_start_emit_queue_events(monkeypatch):
    bus = EventBus()
    monkeypatch.setattr(zimmer, "_bus", bus)
    _install_hermes_plugins_alias()

    # Reset bridge globals for deterministic tests.
    import zimmer.gateway_hook_bridge as bridge
    bridge._queue_depth.clear()
    bridge._user_session.clear()

    # Establish session mapping.
    handle_gateway_event(
        "session:start",
        {"platform": "telegram", "user_id": "u1", "session_id": "s1", "session_key": "k1"},
    )
    # Queue one prompt.
    handle_gateway_event(
        "command:queue",
        {"platform": "telegram", "user_id": "u1", "args": "summarize this"},
    )
    # Simulate processing start (dequeue approximation).
    handle_gateway_event(
        "agent:start",
        {"platform": "telegram", "user_id": "u1", "session_id": "s1", "message": "run now"},
    )

    events = bus.get_history()
    event_types = [e["type"] for e in events]
    assert "task_queued" in event_types
    assert "queue_change" in event_types
    # Final queue_change after agent:start should reduce depth back to 0.
    queue_changes = [e for e in events if e["type"] == "queue_change"]
    assert queue_changes[-1]["queue_depth"] == 0


def test_approve_and_deny_emit_permission_resolved(monkeypatch):
    bus = EventBus()
    monkeypatch.setattr(zimmer, "_bus", bus)
    _install_hermes_plugins_alias()

    import zimmer.gateway_hook_bridge as bridge
    bridge._queue_depth.clear()
    bridge._user_session.clear()

    handle_gateway_event(
        "session:start",
        {"platform": "discord", "user_id": "u2", "session_id": "s2", "session_key": "k2"},
    )
    handle_gateway_event(
        "command:approve",
        {"platform": "discord", "user_id": "u2", "args": "session"},
    )
    handle_gateway_event(
        "command:deny",
        {"platform": "discord", "user_id": "u2"},
    )

    resolved = [e for e in bus.get_history() if e["type"] == "permission_resolved"]
    assert len(resolved) == 2
    assert resolved[0]["approved"] is True
    assert resolved[0]["scope"] == "session"
    assert resolved[1]["approved"] is False


def test_sync_gateway_hook_files_writes_expected_files(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("ZIMMER_DISABLE_GATEWAY_HOOK_SYNC", raising=False)

    zimmer._sync_gateway_hook_files()

    hook_dir = tmp_path / "hooks" / "zimmer_gateway_bridge"
    assert (hook_dir / "HOOK.yaml").exists()
    assert (hook_dir / "handler.py").exists()
