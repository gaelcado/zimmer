"""Shared fixtures for zimmer plugin tests."""

import asyncio
import json
import os
import sqlite3
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def event_bus():
    """Fresh EventBus instance."""
    from zimmer.event_bus import EventBus
    return EventBus()


@pytest.fixture
def event_bus_with_loop(event_bus):
    """EventBus with a running asyncio loop in a background thread."""
    import threading

    loop = asyncio.new_event_loop()
    event_bus.set_server_loop(loop)

    def run_loop():
        asyncio.set_event_loop(loop)
        loop.run_forever()

    t = threading.Thread(target=run_loop, daemon=True)
    t.start()
    yield event_bus
    loop.call_soon_threadsafe(loop.stop)
    t.join(timeout=2)
    loop.close()


@pytest.fixture
def tmp_state_db(tmp_path):
    """Create a temporary state.db with the correct schema, return its path."""
    db_path = tmp_path / "state.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            user_id TEXT,
            model TEXT,
            model_config TEXT,
            system_prompt TEXT,
            parent_session_id TEXT,
            started_at REAL NOT NULL,
            ended_at REAL,
            end_reason TEXT,
            message_count INTEGER DEFAULT 0,
            tool_call_count INTEGER DEFAULT 0,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            title TEXT,
            cache_read_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,
            reasoning_tokens INTEGER DEFAULT 0,
            billing_provider TEXT,
            billing_base_url TEXT,
            billing_mode TEXT,
            estimated_cost_usd REAL,
            actual_cost_usd REAL,
            cost_status TEXT,
            cost_source TEXT,
            pricing_version TEXT,
            FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
        );
        CREATE INDEX idx_sessions_source ON sessions(source);
        CREATE INDEX idx_sessions_started ON sessions(started_at DESC);

        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            role TEXT NOT NULL,
            content TEXT,
            tool_call_id TEXT,
            tool_calls TEXT,
            tool_name TEXT,
            timestamp REAL NOT NULL,
            token_count INTEGER,
            finish_reason TEXT
        );
        CREATE INDEX idx_messages_session ON messages(session_id, timestamp);
    """)
    conn.close()
    return db_path


@pytest.fixture
def populated_db(tmp_state_db):
    """State DB with sample sessions and messages."""
    now = time.time()
    conn = sqlite3.connect(str(tmp_state_db))

    # Active session
    conn.execute(
        "INSERT INTO sessions (id, source, model, started_at, tool_call_count, message_count, input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, estimated_cost_usd, title) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("sess-active-001", "cli", "anthropic/claude-sonnet-4-20250514", now - 120, 5, 12, 1000, 500, 80, 25, 0.0045, "Debug zimmer"),
    )
    # Ended session
    conn.execute(
        "INSERT INTO sessions (id, source, model, parent_session_id, started_at, ended_at, end_reason, tool_call_count, message_count, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, cost_status, title) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("sess-ended-002", "telegram", "anthropic/claude-haiku-4-5-20251001", "sess-active-001", now - 3600, now - 3500, "cli_close", 3, 9, 200, 100, 0.001, 0.0012, "final", "Old task"),
    )

    # Messages for the active session (assistant with tool_calls + tool response)
    tc_json = json.dumps([{
        "id": "call_abc123",
        "type": "function",
        "function": {"name": "terminal", "arguments": '{"command": "ls -la"}'},
    }])
    conn.execute(
        "INSERT INTO messages (session_id, role, content, tool_calls, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?)",
        ("sess-active-001", "assistant", None, tc_json, now - 60, 123),
    )
    conn.execute(
        "INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("sess-active-001", "tool", "total 42\ndrwxr-xr-x ...", "call_abc123", "terminal", now - 59, 45),
    )

    conn.commit()
    conn.close()
    return tmp_state_db


@pytest.fixture
def mock_plugin_ctx():
    """Mock PluginContext for testing register()."""
    ctx = MagicMock()
    ctx._hooks = {}

    def register_hook(name, fn):
        ctx._hooks.setdefault(name, []).append(fn)

    ctx.register_hook = register_hook
    return ctx


@pytest.fixture
def patch_hermes_home(tmp_path, monkeypatch):
    """Redirect HERMES_HOME to tmp_path."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path
