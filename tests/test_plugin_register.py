"""Tests for zimmer plugin registration and hook wiring."""

import time
from unittest.mock import MagicMock, patch

import pytest

import zimmer
from zimmer import register, _find_call_id
from zimmer.event_bus import EventBus


def _host_valid_hooks():
    """Return host-supported plugin hooks (best effort)."""
    try:
        from hermes_cli.plugins import VALID_HOOKS
        return set(VALID_HOOKS)
    except Exception:
        return {
            "pre_tool_call",
            "post_tool_call",
            "on_session_start",
            "on_session_end",
            "pre_llm_call",
            "post_llm_call",
            "on_permission_request",
            "on_permission_resolved",
            "on_task_queued",
            "on_queue_change",
        }


def _register_and_get_bus(mock_ctx, monkeypatch):
    """Register plugin, extract the EventBus from hook closures."""
    monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
    with patch("zimmer._start_server_thread"):
        register(mock_ctx)
    # The bus is captured in the closure of on_pre_tool.
    # We can get it by calling a hook and checking what happened.
    # Easier: inspect the closure variables.
    on_pre = mock_ctx._hooks["pre_tool_call"][0]
    bus = on_pre.__code__.co_freevars  # Check if bus is accessible
    # Actually, just call a hook and find the bus via the event_bus module
    # Simpler: patch at import time. Let's use a different approach.
    # Create our own bus and monkey-patch the register function.
    return mock_ctx._hooks


def _setup_with_known_bus(mock_ctx, monkeypatch):
    """Register the plugin with a known singleton EventBus instance."""
    monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
    bus = EventBus()
    monkeypatch.setattr(zimmer, "_bus", bus)

    with patch("zimmer._start_server_thread"):
        register(mock_ctx)

    return mock_ctx._hooks, bus


class TestPluginRegistration:
    def test_registers_all_hooks(self, mock_plugin_ctx, monkeypatch):
        monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
        with patch("zimmer._start_server_thread"):
            register(mock_plugin_ctx)

        expected_all = {
            "pre_tool_call",
            "post_tool_call",
            "on_session_start",
            "on_session_end",
            "pre_llm_call",
            "post_llm_call",
            "on_permission_request",
            "on_permission_resolved",
            "on_task_queued",
            "on_queue_change",
        }
        expected_hooks = expected_all & _host_valid_hooks()
        assert set(mock_plugin_ctx._hooks.keys()) == expected_hooks

    def test_each_hook_has_one_callback(self, mock_plugin_ctx, monkeypatch):
        monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
        with patch("zimmer._start_server_thread"):
            register(mock_plugin_ctx)

        for hook_name, callbacks in mock_plugin_ctx._hooks.items():
            assert len(callbacks) == 1, f"{hook_name} should have exactly 1 callback"

    def test_starts_server_thread(self, mock_plugin_ctx, monkeypatch):
        monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
        with patch("zimmer._start_server_thread") as mock_start:
            register(mock_plugin_ctx)
            mock_start.assert_called_once()


class TestPreToolHook:
    def test_pre_tool_publishes_tool_start(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_tool_call"][0](tool_name="terminal", args={"command": "ls"}, task_id="sess-001")

        history = bus.get_history()
        assert len(history) == 1
        ev = history[0]
        assert ev["type"] == "tool_start"
        assert ev["tool"] == "terminal"
        assert ev["task_id"] == "sess-001"
        assert ev["session_id"] == ""
        assert "call_id" in ev

    def test_pre_tool_prefers_explicit_session_id(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_tool_call"][0](
            tool_name="terminal",
            args={"command": "ls"},
            task_id="task-001",
            session_id="sess-001",
        )

        ev = bus.get_history()[0]
        assert ev["task_id"] == "task-001"
        assert ev["session_id"] == "sess-001"

    def test_pre_tool_default_task_id(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_tool_call"][0](tool_name="terminal", args={})

        assert bus.get_history()[0]["task_id"] == ""


class TestPostToolHook:
    def test_post_tool_publishes_tool_end(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_tool_call"][0](tool_name="terminal", args={"command": "ls"}, task_id="sess-001")
        hooks["post_tool_call"][0](tool_name="terminal", args={"command": "ls"}, result="file1\nfile2", task_id="sess-001")

        history = bus.get_history()
        assert len(history) == 2
        end_ev = history[1]
        assert end_ev["type"] == "tool_end"
        assert end_ev["tool"] == "terminal"
        # call_id should match the start event
        assert end_ev["call_id"] == history[0]["call_id"]

    def test_post_tool_result_preview_truncated(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["post_tool_call"][0](tool_name="read_file", args={}, result="x" * 1000, task_id="sess-001")

        assert len(bus.get_history()[0]["result_preview"]) <= 300

    def test_post_tool_non_string_result(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["post_tool_call"][0](tool_name="terminal", args={}, result=12345, task_id="sess-001")

        assert bus.get_history()[0]["result_preview"] == ""


class TestSessionHooks:
    def test_session_start(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["on_session_start"][0](session_id="sess-001", platform="cli")

        history = bus.get_history()
        assert len(history) == 1
        assert history[0]["type"] == "session_start"
        assert history[0]["session_id"] == "sess-001"
        assert history[0]["platform"] == "cli"

    def test_session_end(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["on_session_end"][0](session_id="sess-001", platform="telegram")

        history = bus.get_history()
        assert len(history) == 1
        assert history[0]["type"] == "session_end"
        assert history[0]["session_id"] == "sess-001"


class TestLLMHooks:
    def test_llm_start(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_llm_call"][0](messages=[{"role": "user", "content": "hi"}], model="claude-sonnet-4-20250514", task_id="sess-001")

        history = bus.get_history()
        assert len(history) == 1
        assert history[0]["type"] == "llm_start"
        assert history[0]["model"] == "claude-sonnet-4-20250514"
        assert history[0]["message_count"] == 1

    def test_llm_end(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["post_llm_call"][0](messages=[], response=None, model="claude-sonnet-4-20250514", task_id="sess-001")

        history = bus.get_history()
        assert len(history) == 1
        assert history[0]["type"] == "llm_end"

    def test_llm_start_no_messages(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["pre_llm_call"][0](model="claude-sonnet-4-20250514")

        assert bus.get_history()[0]["message_count"] == 0


class TestFindCallId:
    def test_matches_most_recent_unmatched(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        # Start two tools of the same name
        hooks["pre_tool_call"][0](tool_name="terminal", args={"cmd": "a"}, task_id="s1")
        hooks["pre_tool_call"][0](tool_name="terminal", args={"cmd": "b"}, task_id="s1")

        history = bus.get_history()
        call_id_1 = history[0]["call_id"]
        call_id_2 = history[1]["call_id"]

        # End the second one first (LIFO)
        hooks["post_tool_call"][0](tool_name="terminal", args={}, result="done_b", task_id="s1")
        history = bus.get_history()
        assert history[2]["call_id"] == call_id_2

        # End the first one
        hooks["post_tool_call"][0](tool_name="terminal", args={}, result="done_a", task_id="s1")
        history = bus.get_history()
        assert history[3]["call_id"] == call_id_1

    def test_find_call_id_unmatched_returns_new_uuid(self):
        """When no matching start exists, _find_call_id returns a new UUID."""
        bus = EventBus()
        result = _find_call_id(bus, "nonexistent_tool", "no_session")
        assert len(result) == 12  # short UUID

    def test_find_call_id_different_sessions(self):
        """call_id matching should respect session boundaries."""
        bus = EventBus()
        bus.publish({"type": "tool_start", "tool": "terminal", "call_id": "c1", "task_id": "s1"})
        bus.publish({"type": "tool_start", "tool": "terminal", "call_id": "c2", "task_id": "s2"})

        # Ending terminal for s1 should match c1, not c2
        found = _find_call_id(bus, "terminal", "s1")
        assert found == "c1"

        found = _find_call_id(bus, "terminal", "s2")
        assert found == "c2"


class TestPermissionHooks:
    """v0.4.0: on_permission_request / on_permission_resolved hooks."""

    def test_permission_request_publishes_event(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)
        if "on_permission_request" not in hooks:
            pytest.skip("Host does not expose on_permission_request hook")

        hooks["on_permission_request"][0](
            tool_name="terminal", reason="needs shell access", session_id="sess-42"
        )

        history = bus.get_history()
        assert len(history) == 1
        ev = history[0]
        assert ev["type"] == "permission_request"
        assert ev["tool"] == "terminal"
        assert ev["reason"] == "needs shell access"
        assert ev["session_id"] == "sess-42"

    def test_permission_resolved_publishes_event(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)
        if "on_permission_resolved" not in hooks:
            pytest.skip("Host does not expose on_permission_resolved hook")

        hooks["on_permission_resolved"][0](
            tool_name="terminal", approved=True, session_id="sess-42"
        )

        history = bus.get_history()
        assert len(history) == 1
        ev = history[0]
        assert ev["type"] == "permission_resolved"
        assert ev["tool"] == "terminal"
        assert ev["approved"] is True
        assert ev["session_id"] == "sess-42"

    def test_permission_hooks_graceful_on_old_host(self, monkeypatch):
        """register() must not raise when the host raises ValueError for unknown hooks."""
        import zimmer as _z

        class _StrictCtx:
            def __init__(self):
                self._hooks = {}

            def register_hook(self, name, fn):
                if name in ("on_permission_request", "on_permission_resolved"):
                    raise ValueError(f"Unknown hook: {name}")
                self._hooks.setdefault(name, []).append(fn)

        ctx = _StrictCtx()
        monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
        bus = EventBus()
        monkeypatch.setattr(_z, "_bus", bus)

        with patch("zimmer._start_server_thread"):
            register(ctx)  # must not raise

        # Core hooks still registered
        assert "pre_tool_call" in ctx._hooks
        assert "on_permission_request" not in ctx._hooks

    def test_terminal_approval_required_fallback_publishes_permission_request(
        self, mock_plugin_ctx, monkeypatch
    ):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)

        hooks["post_tool_call"][0](
            tool_name="terminal",
            args={"command": "rm -rf /tmp/x"},
            result='{"status":"approval_required","description":"dangerous command","command":"rm -rf /tmp/x"}',
            task_id="sess-42",
            session_id="sess-42",
        )

        history = bus.get_history()
        assert len(history) == 2
        ev = history[1]
        assert ev["type"] == "permission_request"
        assert ev["tool"] == "terminal"
        assert ev["reason"] == "dangerous command"
        assert ev["session_id"] == "sess-42"
        assert ev["command"] == "rm -rf /tmp/x"


class TestQueueHooks:
    """v0.4.0: on_task_queued / on_queue_change hooks."""

    def test_task_queued_publishes_event(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)
        if "on_task_queued" not in hooks:
            pytest.skip("Host does not expose on_task_queued hook")

        hooks["on_task_queued"][0](
            task_id="t-001", prompt="summarize this doc", session_id="sess-01"
        )

        history = bus.get_history()
        assert len(history) == 1
        ev = history[0]
        assert ev["type"] == "task_queued"
        assert ev["task_id"] == "t-001"
        assert ev["session_id"] == "sess-01"
        assert ev["prompt_preview"] == "summarize this doc"

    def test_task_queued_prompt_truncated(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)
        if "on_task_queued" not in hooks:
            pytest.skip("Host does not expose on_task_queued hook")

        hooks["on_task_queued"][0](task_id="t-002", prompt="x" * 200, session_id="sess-01")

        ev = bus.get_history()[0]
        assert len(ev["prompt_preview"]) == 120

    def test_queue_change_publishes_event(self, mock_plugin_ctx, monkeypatch):
        hooks, bus = _setup_with_known_bus(mock_plugin_ctx, monkeypatch)
        if "on_queue_change" not in hooks:
            pytest.skip("Host does not expose on_queue_change hook")

        hooks["on_queue_change"][0](queue_depth=3, session_id="sess-01")

        history = bus.get_history()
        assert len(history) == 1
        ev = history[0]
        assert ev["type"] == "queue_change"
        assert ev["queue_depth"] == 3
        assert ev["session_id"] == "sess-01"

    def test_queue_hooks_graceful_on_old_host(self, monkeypatch):
        """register() must not raise when the host raises ValueError for queue hooks."""
        import zimmer as _z

        class _StrictCtx:
            def __init__(self):
                self._hooks = {}

            def register_hook(self, name, fn):
                if name in ("on_task_queued", "on_queue_change"):
                    raise ValueError(f"Unknown hook: {name}")
                self._hooks.setdefault(name, []).append(fn)

        ctx = _StrictCtx()
        monkeypatch.setenv("ZIMMER_NO_BROWSER", "1")
        bus = EventBus()
        monkeypatch.setattr(_z, "_bus", bus)

        with patch("zimmer._start_server_thread"):
            register(ctx)  # must not raise

        assert "pre_tool_call" in ctx._hooks
        assert "on_task_queued" not in ctx._hooks
