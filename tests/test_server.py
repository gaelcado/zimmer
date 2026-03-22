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


class TestRESTWorkflows:
    def test_workflow_crud(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))

        listed = client.get("/api/workflows")
        assert listed.status_code == 200
        assert listed.json() == []

        created = client.post(
            "/api/workflows",
            json={"name": "Release Flow", "description": "Ship plugin updates safely"},
        )
        assert created.status_code == 200
        body = created.json()
        assert body["ok"] is True
        wf = body["workflow"]
        wf_id = wf["id"]
        assert wf["name"] == "Release Flow"
        assert wf_id.startswith("wf_")

        fetched = client.get(f"/api/workflows/{wf_id}")
        assert fetched.status_code == 200
        fetched_body = fetched.json()
        assert fetched_body["ok"] is True
        assert fetched_body["workflow"]["id"] == wf_id

        updated = client.put(
            f"/api/workflows/{wf_id}",
            json={
                "name": "Release Flow v2",
                "graph": {
                    "nodes": [{"id": "n1", "type": "skill", "skill": "code-review"}],
                    "edges": [],
                },
            },
        )
        assert updated.status_code == 200
        updated_body = updated.json()
        assert updated_body["ok"] is True
        assert updated_body["workflow"]["name"] == "Release Flow v2"
        assert len(updated_body["workflow"]["graph"]["nodes"]) == 1

        listed2 = client.get("/api/workflows")
        assert listed2.status_code == 200
        rows = listed2.json()
        assert len(rows) == 1
        assert rows[0]["id"] == wf_id
        assert rows[0]["node_count"] == 1

    def test_workflow_configured_skills_filters_disabled(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        from zimmer import workflow_store
        monkeypatch.setattr(workflow_store, "_list_skills_from_hermes_cli", lambda: [])

        skills_root = tmp_path / "skills" / "tools"
        enabled_dir = skills_root / "alpha-skill"
        disabled_dir = skills_root / "beta-skill"
        enabled_dir.mkdir(parents=True, exist_ok=True)
        disabled_dir.mkdir(parents=True, exist_ok=True)

        (enabled_dir / "SKILL.md").write_text(
            "---\n"
            "name: alpha\n"
            "description: Alpha skill\n"
            "---\n"
            "# Alpha\n",
            encoding="utf-8",
        )
        (disabled_dir / "SKILL.md").write_text(
            "---\n"
            "name: beta\n"
            "description: Beta skill\n"
            "---\n"
            "# Beta\n",
            encoding="utf-8",
        )

        (tmp_path / "config.yaml").write_text(
            "skills:\n"
            "  disabled:\n"
            "    - beta\n",
            encoding="utf-8",
        )

        resp = client.get("/api/workflows/skills?platform=cli")
        assert resp.status_code == 200
        data = resp.json()
        names = [row["name"] for row in data["skills"]]
        assert "alpha" in names
        assert "beta" not in names

    def test_context_skills_uses_configured_skill_listing(self, client, monkeypatch):
        from zimmer import workflow_store

        monkeypatch.setattr(
            workflow_store,
            "list_configured_skills",
            lambda platform="cli": [
                {
                    "name": "alpha",
                    "category": "tools",
                    "path": "cli://builtin/tools/alpha",
                    "platform": platform,
                }
            ],
        )

        resp = client.get("/api/context/skills")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert body[0]["name"] == "alpha"
        assert body[0]["platform"] == "cli"

    def test_workflow_run_dry(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))

        created = client.post(
            "/api/workflows",
            json={"name": "Dry Run Flow"},
        ).json()
        wf_id = created["workflow"]["id"]

        client.put(
            f"/api/workflows/{wf_id}",
            json={
                "graph": {
                    "nodes": [
                        {"id": "n1", "type": "prompt", "prompt": "Summarize input"},
                        {"id": "n2", "type": "skill", "skill": "code-review"},
                    ],
                    "edges": [],
                }
            },
        )

        run_resp = client.post(
            f"/api/workflows/{wf_id}/run",
            json={"input": "hello", "dry_run": True},
        )
        assert run_resp.status_code == 200
        run_body = run_resp.json()
        assert run_body["ok"] is True
        run_id = run_body["run_id"]

        # Poll for completion (dry runs should finish quickly).
        last = None
        for _ in range(20):
            last = client.get(f"/api/workflows/runs/{run_id}").json()
            if last.get("ok") and last["run"].get("status") != "running":
                break
            time.sleep(0.05)

        assert last is not None
        assert last["ok"] is True
        assert last["run"]["status"] == "ok"
        assert len(last["run"]["steps"]) == 2

    def test_workflow_update_rejects_cycle(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "Cycle Flow"}).json()["workflow"]["id"]

        resp = client.put(
            f"/api/workflows/{wf_id}",
            json={
                "graph": {
                    "nodes": [
                        {"id": "a", "type": "prompt", "prompt": "A {input}"},
                        {"id": "b", "type": "prompt", "prompt": "B {input}"},
                    ],
                    "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}],
                }
            },
        )
        body = resp.json()
        assert body["ok"] is False
        assert body["error"] == "invalid_workflow"
        assert any("cycle" in msg for msg in body["issues"])

    def test_workflow_runs_list(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "List Runs"}).json()["workflow"]["id"]
        client.put(
            f"/api/workflows/{wf_id}",
            json={"graph": {"nodes": [{"id": "n1", "type": "prompt", "prompt": "echo {input}"}], "edges": []}},
        )
        run = client.post(f"/api/workflows/{wf_id}/run", json={"input": "hi", "dry_run": True}).json()
        run_id = run["run_id"]
        for _ in range(20):
            r = client.get(f"/api/workflows/runs/{run_id}").json()
            if r.get("ok") and r["run"]["status"] != "running":
                break
            time.sleep(0.05)
        listed = client.get(f"/api/workflows/runs?workflow_id={wf_id}&limit=5").json()
        assert listed["ok"] is True
        assert any(row["run_id"] == run_id for row in listed["runs"])

    def test_workflow_export_import(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "Exportable"}).json()["workflow"]["id"]
        client.put(
            f"/api/workflows/{wf_id}",
            json={
                "graph": {
                    "nodes": [{"id": "n1", "type": "prompt", "prompt": "echo {input}"}],
                    "edges": [],
                }
            },
        )
        exported = client.get(f"/api/workflows/{wf_id}/export").json()
        assert exported["ok"] is True
        assert "workflow_id" in exported
        assert "content" in exported
        assert "Exportable" in exported["content"]

        imported = client.post("/api/workflows/import", json={"content": exported["content"], "overwrite": False}).json()
        assert imported["ok"] is True
        assert imported["workflow"]["id"] != wf_id

    def test_workflow_validate_empty_graph(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "Empty"}).json()["workflow"]["id"]
        valid = client.get(f"/api/workflows/{wf_id}/validate").json()
        assert valid["ok"] is False
        assert valid["error"] == "invalid_workflow"
        assert any("no nodes" in issue for issue in valid["issues"])

    def test_workflow_import_too_large(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        huge = "a" * 600_000
        resp = client.post("/api/workflows/import", json={"content": huge})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert "too large" in body["error"]

    def test_workflow_auth_guard(self, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        monkeypatch.setenv("ZIMMER_WORKFLOW_API_TOKEN", "abc123")

        # Recreate app after setting env so module constant is refreshed.
        from importlib import reload
        import zimmer.server as server_mod
        reload(server_mod)

        c = TestClient(server_mod.create_app(EventBus()))
        auth = c.get("/api/workflows/auth").json()
        assert auth["required"] is True

        denied = c.post("/api/workflows", json={"name": "Denied"})
        assert denied.status_code == 200
        assert denied.json()["ok"] is False
        assert denied.json()["error"] == "unauthorized"

        allowed = c.post("/api/workflows", json={"name": "Allowed"}, headers={"x-zimmer-token": "abc123"})
        assert allowed.status_code == 200
        assert allowed.json()["ok"] is True

    def test_reconcile_stale_running_runs(self, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        from zimmer import workflow_store

        run = workflow_store.create_run_record("wf_x", "name")
        assert run["status"] == "running"
        changed = workflow_store.reconcile_running_runs("restart")
        assert changed == 1
        got = workflow_store.get_run_record(run["run_id"])
        assert got is not None
        assert got["status"] == "error"
        assert got["error"] == "restart"

    def test_workflow_run_metrics_endpoint(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "Metrics"}).json()["workflow"]["id"]
        client.put(
            f"/api/workflows/{wf_id}",
            json={"graph": {"nodes": [{"id": "n1", "type": "prompt", "prompt": "echo {input}"}], "edges": []}},
        )
        run_id = client.post(f"/api/workflows/{wf_id}/run", json={"input": "x", "dry_run": True}).json()["run_id"]
        for _ in range(20):
            r = client.get(f"/api/workflows/runs/{run_id}").json()
            if r.get("ok") and r["run"]["status"] != "running":
                break
            time.sleep(0.05)
        metrics = client.get(f"/api/workflows/runs/metrics?workflow_id={wf_id}&window_sec=3600").json()
        assert metrics["ok"] is True
        assert metrics["metrics"]["count"] >= 1

    def test_workflow_run_cleanup_dry_run(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        wf_id = client.post("/api/workflows", json={"name": "Cleanup"}).json()["workflow"]["id"]
        client.put(
            f"/api/workflows/{wf_id}",
            json={"graph": {"nodes": [{"id": "n1", "type": "prompt", "prompt": "echo {input}"}], "edges": []}},
        )
        run_id = client.post(f"/api/workflows/{wf_id}/run", json={"input": "x", "dry_run": True}).json()["run_id"]
        for _ in range(20):
            r = client.get(f"/api/workflows/runs/{run_id}").json()
            if r.get("ok") and r["run"]["status"] != "running":
                break
            time.sleep(0.05)
        cleanup = client.post("/api/workflows/runs/cleanup", json={"dry_run": True, "max_age_days": 0, "keep_per_workflow": 1}).json()
        assert cleanup["ok"] is True
        assert cleanup["dry_run"] is True
        assert "candidates" in cleanup


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
        import zimmer.server as server_mod
        proc_file = tmp_path / "processes.json"
        proc_file.write_text(json.dumps([{"pid": 1234, "cmd": "npm run dev"}]))
        monkeypatch.setattr(server_mod, "_PROCESSES_PATH", proc_file)

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
