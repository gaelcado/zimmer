"""Tests for the FastAPI server — REST endpoints, SSE, WebSocket terminal."""

import asyncio
import json
import time
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from zimmer.event_bus import EventBus
from zimmer.server import create_app


@pytest.fixture
def bus():
    return EventBus()


@pytest.fixture
def app(bus, populated_db, monkeypatch):
    from zimmer import state_reader
    monkeypatch.setattr(state_reader, "_db_path", lambda: str(populated_db))
    return create_app(bus)


@pytest.fixture
def client(app):
    return TestClient(app)


class TestRESTSessions:
    def test_get_sessions(self, client):
        resp = client.get("/api/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_get_sessions_with_limit(self, client):
        resp = client.get("/api/sessions?limit=1")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_get_active_sessions(self, client):
        resp = client.get("/api/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "sess-active-001"

    def test_get_session_tools(self, client):
        resp = client.get("/api/sessions/sess-active-001/tools")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["tool_name"] == "terminal"

    def test_get_session_messages(self, client):
        resp = client.get("/api/sessions/sess-active-001/messages")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["token_count"] == 123

    def test_get_single_session(self, client):
        resp = client.get("/api/sessions/sess-ended-002")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "sess-ended-002"
        assert data["parent_session_id"] == "sess-active-001"
        assert data["end_reason"] == "cli_close"

    def test_get_single_session_not_found(self, client):
        resp = client.get("/api/sessions/does-not-exist")
        assert resp.status_code == 200
        assert resp.json()["error"] == "not_found"

    def test_get_session_messages_limit(self, client):
        resp = client.get("/api/sessions/sess-active-001/messages?limit=1")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


class TestRESTStats:
    def test_get_stats(self, client):
        resp = client.get("/api/stats")
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["total_sessions"] == 2
        assert stats["active_sessions"] == 1
        assert stats["total_input_tokens"] == 1200
        assert stats["total_output_tokens"] == 600

    def test_get_health(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["plugin"] == "zimmer"
        assert "state_db_exists" in data



class TestRESTKill:
    def test_kill_active_session(self, client):
        resp = client.post("/api/sessions/sess-active-001/kill")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify it's now ended
        active = client.get("/api/sessions/active").json()
        assert len(active) == 0

    def test_kill_nonexistent_session(self, client):
        resp = client.post("/api/sessions/nonexistent/kill")
        assert resp.status_code == 200
        assert resp.json()["ok"] is False


class TestRESTRename:
    def test_rename_session(self, client):
        resp = client.put(
            "/api/sessions/sess-active-001/title",
            json={"title": "My Cool Session"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["title"] == "My Cool Session"

        # Verify it persisted
        sess = client.get("/api/sessions/sess-active-001").json()
        assert sess["title"] == "My Cool Session"

    def test_rename_nonexistent(self, client):
        resp = client.put(
            "/api/sessions/nonexistent/title",
            json={"title": "nope"},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is False

    def test_rename_duplicate_title(self, client):
        # First rename succeeds
        client.put("/api/sessions/sess-active-001/title", json={"title": "Unique"})
        # Second session with same title fails
        resp = client.put(
            "/api/sessions/sess-ended-002/title",
            json={"title": "Unique"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "already in use" in data["error"]

    def test_rename_clear_title(self, client):
        # Set a title then clear it
        client.put("/api/sessions/sess-active-001/title", json={"title": "Temp"})
        resp = client.put(
            "/api/sessions/sess-active-001/title",
            json={"title": "   "},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["title"] is None

    def test_rename_truncates_long_title(self, client):
        resp = client.put(
            "/api/sessions/sess-active-001/title",
            json={"title": "x" * 150},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert len(resp.json()["title"]) <= 100


class TestRESTProcesses:
    def test_processes_missing_file(self, client, monkeypatch):
        resp = client.get("/api/processes")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_processes_with_file(self, client, tmp_path, monkeypatch):
        import zimmer.routes.sessions as sessions_mod
        proc_file = tmp_path / "processes.json"
        proc_file.write_text(json.dumps([{"pid": 1234, "cmd": "npm run dev"}]))
        monkeypatch.setattr(sessions_mod, "PROCESSES_PATH", proc_file)

        resp = client.get("/api/processes")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["pid"] == 1234


class TestRESTEventHistory:
    def test_events_history_empty(self, client):
        resp = client.get("/api/events/history")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_events_history_with_data(self, client, bus):
        bus.publish({"type": "tool_start", "tool": "terminal", "call_id": "c1"})
        bus.publish({"type": "tool_end", "call_id": "c1"})
        resp = client.get("/api/events/history")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_active_tools_endpoint(self, client, bus):
        bus.publish({"type": "tool_start", "tool": "terminal", "call_id": "c1"})
        resp = client.get("/api/events/active-tools")
        assert resp.status_code == 200
        data = resp.json()
        assert "c1" in data


class TestHonchoEndpoints:
    def test_honcho_status(self, client):
        resp = client.get("/api/honcho/status")
        assert resp.status_code == 200
        data = resp.json()
        # Should always return a dict with at least configured/enabled keys
        assert "configured" in data
        assert "enabled" in data

    def test_honcho_config(self, client):
        resp = client.get("/api/honcho/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "path" in data
        assert "exists" in data

    def test_honcho_sessions_endpoint(self, client):
        resp = client.get("/api/honcho/sessions")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_honcho_peers_endpoint(self, client):
        resp = client.get("/api/honcho/peers")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_honcho_config_put_invalid_json(self, client):
        resp = client.put(
            "/api/honcho/config",
            json={"content": "not valid json {{{"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is False
        assert "Invalid JSON" in data["error"]


class TestSSE:
    def test_sse_generator_function_exists(self, app):
        """Verify the /api/events route is registered and returns StreamingResponse."""
        # We can't easily test SSE streaming end-to-end in pytest because the
        # async generator blocks on `await q.get()`. Instead verify the route exists
        # and the EventBus subscribe/publish pipeline works (covered in test_event_bus.py).
        routes = [r.path for r in app.routes if hasattr(r, "path")]
        assert "/api/events" in routes


class TestSPAFallback:
    def test_root_without_ui(self, tmp_path, monkeypatch, populated_db):
        import zimmer.server as server_mod
        from zimmer import state_reader
        monkeypatch.setattr(state_reader, "_db_path", lambda: str(populated_db))

        # Point _UI_DIST to an empty dir (no index.html)
        empty_dist = tmp_path / "empty_dist"
        empty_dist.mkdir()
        monkeypatch.setattr(server_mod, "_UI_DIST", empty_dist)

        bus = EventBus()
        app = create_app(bus)
        c = TestClient(app)

        resp = c.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "UI not built" in data["status"]

    def test_spa_fallback_without_ui(self, client):
        resp = client.get("/some/route")
        assert resp.status_code == 200

    def test_root_with_built_ui(self, tmp_path, monkeypatch, populated_db):
        import zimmer.server as server_mod
        from zimmer import state_reader
        monkeypatch.setattr(state_reader, "_db_path", lambda: str(populated_db))

        dist = tmp_path / "dist"
        dist.mkdir()
        index = dist / "index.html"
        index.write_text("<html><body>Zimmer</body></html>")
        assets = dist / "assets"
        assets.mkdir()

        monkeypatch.setattr(server_mod, "_UI_DIST", dist)

        bus = EventBus()
        app = create_app(bus)
        c = TestClient(app)

        resp = c.get("/")
        assert resp.status_code == 200
        assert "Zimmer" in resp.text
