"""Read-only SQLite queries against ~/.hermes/state.db."""

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any


def _db_path() -> str:
    home = Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))
    return str(home / "state.db")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _connect_rw() -> sqlite3.Connection:
    """Writable connection for mutations (kill, etc.)."""
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_sessions(limit: int = 50, offset: int = 0) -> list[dict]:
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id, source, model, started_at, ended_at, end_reason,
                          parent_session_id, title, message_count, tool_call_count,
                          input_tokens, output_tokens,
                          cache_read_tokens, cache_write_tokens, reasoning_tokens,
                          billing_provider, billing_mode,
                          estimated_cost_usd, actual_cost_usd, cost_status
                   FROM sessions
                   ORDER BY started_at DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def get_active_sessions() -> list[dict]:
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id, source, model, started_at, ended_at, end_reason,
                          parent_session_id, title, message_count, tool_call_count,
                          input_tokens, output_tokens,
                          cache_read_tokens, cache_write_tokens, reasoning_tokens,
                          billing_provider, billing_mode,
                          estimated_cost_usd, actual_cost_usd, cost_status
                   FROM sessions
                   WHERE ended_at IS NULL
                   ORDER BY started_at DESC""",
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def get_session(session_id: str) -> dict[str, Any] | None:
    """Return one session row with full metadata."""
    try:
        with _connect() as conn:
            row = conn.execute(
                """SELECT id, source, model, started_at, ended_at, end_reason,
                          parent_session_id, title, message_count, tool_call_count,
                          input_tokens, output_tokens,
                          cache_read_tokens, cache_write_tokens, reasoning_tokens,
                          billing_provider, billing_mode,
                          estimated_cost_usd, actual_cost_usd, cost_status
                   FROM sessions
                   WHERE id = ?""",
                (session_id,),
            ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def _build_preview(tool_name: str, args: dict) -> str:
    """Best-effort preview using Hermes display helpers, with inline fallback."""
    try:
        import sys
        import os
        hermes_src = os.path.join(os.path.dirname(__file__), "..", "..", "hermes-agent")
        if hermes_src not in sys.path:
            sys.path.insert(0, hermes_src)
        from agent.display import build_tool_preview
        result = build_tool_preview(tool_name, args or {})
        if result:
            return result
    except Exception:
        pass
    # Inline fallback for the most common tools
    _PRIMARY = {
        "terminal": "command", "web_search": "query", "web_extract": "urls",
        "read_file": "path", "write_file": "path", "patch": "path",
        "search_files": "pattern", "browser_navigate": "url",
    }
    key = _PRIMARY.get(tool_name)
    if key and args and key in args:
        val = args[key]
        if isinstance(val, list):
            val = val[0] if val else ""
        val = str(val)
        return val[:80] + ("…" if len(val) > 80 else "")
    return ""


def get_tool_calls(session_id: str) -> list[dict]:
    """Return tool call pairs by joining assistant tool_calls with tool responses."""
    sql = """
        SELECT
            tc_msg.id               AS turn_id,
            tc_msg.timestamp        AS started_at,
            tr_msg.timestamp        AS ended_at,
            json_extract(tc.value, '$.id') AS call_id,
            COALESCE(
                tr_msg.tool_name,
                json_extract(tc.value, '$.function.name')
            )                       AS tool_name,
            json_extract(tc.value, '$.function.arguments') AS args_json,
            tr_msg.content          AS result_preview
        FROM messages tc_msg
        JOIN json_each(tc_msg.tool_calls) AS tc
            ON json_extract(tc.value, '$.type') = 'function'
        LEFT JOIN messages tr_msg
            ON tr_msg.session_id = tc_msg.session_id
            AND tr_msg.role = 'tool'
            AND tr_msg.tool_call_id = json_extract(tc.value, '$.id')
        WHERE tc_msg.session_id = ? AND tc_msg.role = 'assistant'
          AND tc_msg.tool_calls IS NOT NULL
        ORDER BY tc_msg.timestamp
    """
    try:
        with _connect() as conn:
            rows = conn.execute(sql, (session_id,)).fetchall()
        result = []
        for r in rows:
            row = dict(r)
            args = row.get("args_json")
            if isinstance(args, str):
                try:
                    row["args"] = json.loads(args)
                except (json.JSONDecodeError, TypeError):
                    row["args"] = args
            else:
                row["args"] = args
            row.pop("args_json", None)
            preview = row.get("result_preview") or ""
            row["result_preview"] = preview[:300]
            row["preview"] = _build_preview(row.get("tool_name") or "", row.get("args") or {})
            result.append(row)
        return result
    except Exception:
        return []


def get_inflight_tool_calls(limit: int = 300) -> list[dict]:
    """Return currently running tool calls inferred from DB (assistant call without tool response)."""
    sql = """
        SELECT
            tc_msg.session_id        AS session_id,
            tc_msg.timestamp         AS started_at,
            json_extract(tc.value, '$.id') AS call_id,
            COALESCE(
                json_extract(tc.value, '$.function.name'),
                ''
            )                        AS tool_name,
            json_extract(tc.value, '$.function.arguments') AS args_json
        FROM messages tc_msg
        JOIN json_each(tc_msg.tool_calls) AS tc
            ON json_extract(tc.value, '$.type') = 'function'
        LEFT JOIN messages tr_msg
            ON tr_msg.session_id = tc_msg.session_id
            AND tr_msg.role = 'tool'
            AND tr_msg.tool_call_id = json_extract(tc.value, '$.id')
        WHERE tc_msg.role = 'assistant'
          AND tc_msg.tool_calls IS NOT NULL
          AND tr_msg.id IS NULL
        ORDER BY tc_msg.timestamp DESC
        LIMIT ?
    """
    try:
        with _connect() as conn:
            rows = conn.execute(sql, (limit,)).fetchall()
        result = []
        for r in rows:
            row = dict(r)
            args = row.get("args_json")
            if isinstance(args, str):
                try:
                    row["args"] = json.loads(args)
                except (json.JSONDecodeError, TypeError):
                    row["args"] = args
            else:
                row["args"] = args
            result.append({
                "call_id": row.get("call_id") or "",
                "session_id": row.get("session_id") or "",
                "started_at": row.get("started_at"),
                "tool_name": row.get("tool_name") or "",
                "args": row.get("args"),
            })
        return [r for r in result if r["call_id"]]
    except Exception:
        return []


def get_likely_thinking_sessions(window_sec: int = 180, limit: int = 200) -> list[str]:
    """Infer sessions likely waiting on an LLM call without relying on runtime hooks."""
    sql = """
        SELECT
            s.id AS session_id,
            m.role AS last_role,
            m.timestamp AS last_ts
        FROM sessions s
        LEFT JOIN messages m
            ON m.id = (
                SELECT id
                FROM messages
                WHERE session_id = s.id
                ORDER BY timestamp DESC
                LIMIT 1
            )
        WHERE s.ended_at IS NULL
        ORDER BY s.started_at DESC
        LIMIT ?
    """
    try:
        now = time.time()
        threshold = now - max(20, min(1200, window_sec))
        inflight_by_session = {
            row.get("session_id")
            for row in get_inflight_tool_calls(limit=max(limit * 3, 300))
            if row.get("session_id")
        }
        with _connect() as conn:
            rows = conn.execute(sql, (limit,)).fetchall()

        result = []
        for r in rows:
            row = dict(r)
            sid = row.get("session_id")
            if not sid:
                continue
            if sid in inflight_by_session:
                # Session is waiting on a tool, not currently waiting on model output.
                continue
            last_role = row.get("last_role")
            last_ts = row.get("last_ts") or 0
            if last_ts < threshold:
                continue
            if last_role in {"user", "tool"}:
                result.append(sid)
        return result
    except Exception:
        return []


def get_messages(session_id: str, limit: int = 50) -> list[dict]:
    """Return recent messages for a session (for conversation preview)."""
    try:
        with _connect() as conn:
            rows = conn.execute(
                """SELECT id, role, content, timestamp, tool_name, tool_call_id, token_count
                   FROM messages
                   WHERE session_id = ?
                   ORDER BY timestamp DESC
                   LIMIT ?""",
                (session_id, limit),
            ).fetchall()
        msgs = [dict(r) for r in reversed(rows)]
        # Trim content for preview
        for m in msgs:
            if m.get("content") and len(m["content"]) > 2000:
                m["content"] = m["content"][:2000] + "…"
        return msgs
    except Exception:
        return []


def kill_session(session_id: str) -> bool:
    """Mark a session as ended (killed). Returns True if a row was updated."""
    import time
    try:
        with _connect_rw() as conn:
            cur = conn.execute(
                "UPDATE sessions SET ended_at=?, end_reason='killed' WHERE id=? AND ended_at IS NULL",
                (time.time(), session_id),
            )
            conn.commit()
            return cur.rowcount > 0
    except Exception:
        return False


def rename_session(session_id: str, title: str) -> dict[str, Any]:
    """Set or update a session's title. Returns {"ok": True} or {"ok": False, "error": ...}."""
    import re as _re
    # Sanitize: strip, collapse whitespace, remove control chars, enforce max length
    title = title.strip()
    title = _re.sub(r"[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]", "", title)
    title = _re.sub(r"\s+", " ", title)
    if not title:
        title = None
    elif len(title) > 100:
        title = title[:100].rstrip()
    try:
        with _connect_rw() as conn:
            # Check session exists
            row = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not row:
                return {"ok": False, "error": "session not found"}
            # Check uniqueness (NULL titles are allowed to be duplicated)
            if title is not None:
                conflict = conn.execute(
                    "SELECT id FROM sessions WHERE title = ? AND id != ?",
                    (title, session_id),
                ).fetchone()
                if conflict:
                    return {"ok": False, "error": "title already in use"}
            conn.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))
            conn.commit()
            return {"ok": True, "title": title}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_stats() -> dict[str, Any]:
    try:
        with _connect() as conn:
            try:
                row = conn.execute(
                    """SELECT
                           COUNT(*) AS total_sessions,
                           COALESCE(SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END), 0) AS active_sessions,
                           COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                           COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                           COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens,
                           COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write_tokens,
                           COALESCE(SUM(reasoning_tokens), 0) AS total_reasoning_tokens,
                           COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
                           COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost_usd
                       FROM sessions"""
                ).fetchone()
            except sqlite3.OperationalError:
                # Backward/partial schema fallback.
                row = conn.execute(
                    """SELECT
                           COUNT(*) AS total_sessions,
                           COALESCE(SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END), 0) AS active_sessions,
                           COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                           COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                           0 AS total_cache_read_tokens,
                           0 AS total_cache_write_tokens,
                           0 AS total_reasoning_tokens,
                           COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
                           COALESCE(SUM(estimated_cost_usd), 0.0) AS total_cost_usd
                       FROM sessions"""
                ).fetchone()
        return dict(row) if row else {}
    except Exception:
        return {}
