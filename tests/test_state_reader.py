"""Tests for state_reader — SQLite queries against state.db."""

import json
import sqlite3
import time
from unittest.mock import patch

import pytest

from zimmer import state_reader


@pytest.fixture(autouse=True)
def _redirect_db(populated_db, monkeypatch):
    """Point state_reader at the temporary DB."""
    monkeypatch.setattr(state_reader, "_db_path", lambda: str(populated_db))


class TestGetSessions:
    def test_returns_all_sessions(self):
        sessions = state_reader.get_sessions()
        assert len(sessions) == 2

    def test_ordered_by_started_at_desc(self):
        sessions = state_reader.get_sessions()
        assert sessions[0]["id"] == "sess-active-001"  # more recent
        assert sessions[1]["id"] == "sess-ended-002"

    def test_limit(self):
        sessions = state_reader.get_sessions(limit=1)
        assert len(sessions) == 1

    def test_offset(self):
        sessions = state_reader.get_sessions(limit=1, offset=1)
        assert len(sessions) == 1
        assert sessions[0]["id"] == "sess-ended-002"

    def test_returns_expected_fields(self):
        sessions = state_reader.get_sessions()
        s = sessions[0]
        assert "id" in s
        assert "source" in s
        assert "model" in s
        assert "started_at" in s
        assert "title" in s
        assert "message_count" in s
        assert "parent_session_id" in s
        assert "end_reason" in s
        assert "cache_read_tokens" in s
        assert "reasoning_tokens" in s

    def test_missing_db_returns_empty(self, monkeypatch):
        monkeypatch.setattr(state_reader, "_db_path", lambda: "/nonexistent/state.db")
        assert state_reader.get_sessions() == []


class TestGetActiveSessions:
    def test_returns_only_active(self):
        active = state_reader.get_active_sessions()
        assert len(active) == 1
        assert active[0]["id"] == "sess-active-001"
        # get_active_sessions doesn't SELECT ended_at (it's always NULL by definition)

    def test_empty_when_all_ended(self, populated_db):
        conn = sqlite3.connect(str(populated_db))
        conn.execute("UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL", (time.time(),))
        conn.commit()
        conn.close()
        assert state_reader.get_active_sessions() == []


class TestGetToolCalls:
    def test_returns_tool_calls_for_session(self):
        tools = state_reader.get_tool_calls("sess-active-001")
        assert len(tools) == 1
        t = tools[0]
        assert t["tool_name"] == "terminal"
        assert t["args"] == {"command": "ls -la"}
        assert t["turn_id"] is not None
        assert "result_preview" in t
        assert "total 42" in t["result_preview"]

    def test_empty_for_unknown_session(self):
        assert state_reader.get_tool_calls("nonexistent") == []

    def test_args_json_is_parsed(self):
        tools = state_reader.get_tool_calls("sess-active-001")
        assert isinstance(tools[0]["args"], dict)
        assert "args_json" not in tools[0]

    def test_result_preview_truncated(self, populated_db):
        # Insert a tool result with very long content
        conn = sqlite3.connect(str(populated_db))
        now = time.time()
        tc_json = json.dumps([{
            "id": "call_long",
            "type": "function",
            "function": {"name": "read_file", "arguments": '{"path": "/tmp/big"}'},
        }])
        conn.execute(
            "INSERT INTO messages (session_id, role, tool_calls, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "assistant", tc_json, now),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            ("sess-active-001", "tool", "x" * 1000, "call_long", "read_file", now + 0.1),
        )
        conn.commit()
        conn.close()

        tools = state_reader.get_tool_calls("sess-active-001")
        long_tool = [t for t in tools if t["tool_name"] == "read_file"][0]
        assert len(long_tool["result_preview"]) <= 300


class TestGetSession:
    def test_returns_single_session(self):
        row = state_reader.get_session("sess-ended-002")
        assert row is not None
        assert row["id"] == "sess-ended-002"
        assert row["parent_session_id"] == "sess-active-001"
        assert row["end_reason"] == "cli_close"
        assert row["cost_status"] == "final"

    def test_missing_returns_none(self):
        assert state_reader.get_session("missing") is None


class TestThinkingInference:
    def test_marks_recent_tool_terminal_as_thinking(self, populated_db):
        now = time.time()
        conn = sqlite3.connect(str(populated_db))
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "tool", "done", now - 2),
        )
        conn.commit()
        conn.close()

        active = state_reader.get_likely_thinking_sessions(window_sec=180)
        assert "sess-active-001" in active

    def test_excludes_sessions_waiting_on_tool(self, populated_db):
        now = time.time()
        conn = sqlite3.connect(str(populated_db))
        tc_json = json.dumps([{
            "id": "call_waiting",
            "type": "function",
            "function": {"name": "web_search", "arguments": '{"q":"x"}'},
        }])
        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)",
            ("sess-active-001", "assistant", None, tc_json, now - 1),
        )
        conn.commit()
        conn.close()

        active = state_reader.get_likely_thinking_sessions(window_sec=180)
        assert "sess-active-001" not in active

    def test_excludes_stale_sessions(self, populated_db):
        conn = sqlite3.connect(str(populated_db))
        conn.execute("UPDATE messages SET timestamp = timestamp - 7200 WHERE session_id = ?", ("sess-active-001",))
        conn.commit()
        conn.close()

        active = state_reader.get_likely_thinking_sessions(window_sec=60)
        assert "sess-active-001" not in active


class TestGetMessages:
    def test_returns_messages_for_session(self):
        msgs = state_reader.get_messages("sess-active-001")
        assert len(msgs) == 2

    def test_messages_ordered_chronologically(self):
        msgs = state_reader.get_messages("sess-active-001")
        # reversed from DESC query
        assert msgs[0]["role"] == "assistant"
        assert msgs[1]["role"] == "tool"

    def test_message_includes_token_count(self):
        msgs = state_reader.get_messages("sess-active-001")
        assert msgs[0]["token_count"] == 123
        assert msgs[1]["token_count"] == 45

    def test_content_truncated_at_2000(self, populated_db):
        conn = sqlite3.connect(str(populated_db))
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "user", "y" * 1000, time.time()),
        )
        conn.commit()
        conn.close()

        msgs = state_reader.get_messages("sess-active-001")
        long_msg = [m for m in msgs if m["role"] == "user"][0]
        assert len(long_msg["content"]) == 1000  # Below preview cap

    def test_content_truncated_at_2000_boundary(self, populated_db):
        conn = sqlite3.connect(str(populated_db))
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "user", "z" * 3000, time.time()),
        )
        conn.commit()
        conn.close()

        msgs = state_reader.get_messages("sess-active-001")
        long_msg = [m for m in msgs if m["role"] == "user"][-1]
        assert len(long_msg["content"]) == 2001  # 2000 + "…"

    def test_limit_parameter(self):
        msgs = state_reader.get_messages("sess-active-001", limit=1)
        assert len(msgs) == 1

    def test_empty_for_unknown_session(self):
        assert state_reader.get_messages("nonexistent") == []

    def test_returns_summary_and_compressed_roles(self, populated_db):
        """v0.4.0 context compression introduces summary/compressed message roles."""
        import time as _time
        conn = sqlite3.connect(str(populated_db))
        now = _time.time()
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "summary", "Summary of prior context.", now + 1),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            ("sess-active-001", "compressed", "", now + 2),
        )
        conn.commit()
        conn.close()

        msgs = state_reader.get_messages("sess-active-001", limit=10)
        roles = {m["role"] for m in msgs}
        assert "summary" in roles
        assert "compressed" in roles


class TestKillSession:
    def test_kill_active_session(self):
        assert state_reader.kill_session("sess-active-001") is True
        active = state_reader.get_active_sessions()
        assert len(active) == 0

    def test_kill_already_ended_session_returns_false(self):
        assert state_reader.kill_session("sess-ended-002") is False

    def test_kill_nonexistent_session_returns_false(self):
        assert state_reader.kill_session("nonexistent") is False

    def test_kill_sets_end_reason(self, populated_db):
        state_reader.kill_session("sess-active-001")
        conn = sqlite3.connect(str(populated_db))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT end_reason FROM sessions WHERE id = ?", ("sess-active-001",)).fetchone()
        assert row["end_reason"] == "killed"
        conn.close()


class TestGetStats:
    def test_returns_stats(self):
        stats = state_reader.get_stats()
        assert stats["total_sessions"] == 2
        assert stats["active_sessions"] == 1
        assert stats["total_input_tokens"] == 1200
        assert stats["total_output_tokens"] == 600
        assert stats["total_cache_read_tokens"] == 80
        assert stats["total_cache_write_tokens"] == 0
        assert stats["total_reasoning_tokens"] == 25
        assert stats["total_tokens"] == 1800  # (1000+500) + (200+100)
        assert stats["total_cost_usd"] == pytest.approx(0.0055, abs=0.0001)

    def test_stats_with_empty_db(self, tmp_path):
        """Stats on a fresh DB with no sessions.

        BUG: active_sessions returns None instead of 0 on empty DB because
        SUM(CASE ...) yields NULL when COUNT is 0. Should use COALESCE.
        """
        db_path = tmp_path / "empty_state.db"
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL,
                ended_at REAL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
                estimated_cost_usd REAL
            );
        """)
        conn.close()

        original = state_reader._db_path
        state_reader._db_path = lambda: str(db_path)
        try:
            stats = state_reader.get_stats()
            assert stats["total_sessions"] == 0
            assert stats["active_sessions"] == 0
        finally:
            state_reader._db_path = original
