"""Session, stats, processes, and tool-meta endpoints."""

import json
import sys
import os

from fastapi import APIRouter
from pydantic import BaseModel

from .. import state_reader
from .._config import (
    PROCESSES_PATH,
    MAX_BATCH_RENAME_SESSIONS,
    safe_text,
    safe_title,
    run_hermes_rename,
)

router = APIRouter()


@router.get("/api/sessions")
async def api_sessions(limit: int = 50, offset: int = 0):
    return state_reader.get_sessions(limit, offset)


@router.get("/api/sessions/active")
async def api_sessions_active():
    return state_reader.get_active_sessions()


class BatchRenameSuggestBody(BaseModel):
    session_ids: list[str] = []
    instructions: str = "Create concise, descriptive session titles."
    max_title_len: int = 54
    model: str | None = None
    provider: str | None = None
    timeout_sec: int = 90


@router.post("/api/sessions/batch-rename/suggest")
async def api_sessions_batch_rename_suggest(body: BatchRenameSuggestBody):
    requested = [sid for sid in body.session_ids if isinstance(sid, str) and sid.strip()]
    requested = requested[:MAX_BATCH_RENAME_SESSIONS]
    max_title_len = max(20, min(80, body.max_title_len))
    timeout_sec = max(20, min(180, body.timeout_sec))

    all_sessions = state_reader.get_sessions(limit=400, offset=0)
    by_id = {s["id"]: s for s in all_sessions if s.get("id")}
    targets = [by_id[sid] for sid in requested if sid in by_id]
    if not targets:
        return {"ok": False, "error": "no valid sessions selected"}

    payload = []
    for s in targets:
        sid = s.get("id", "")
        messages = state_reader.get_messages(sid, limit=14)
        snippets = []
        for m in messages:
            role = m.get("role")
            content = safe_text(m.get("content", ""), 180)
            if not content or role not in {"user", "assistant"}:
                continue
            snippets.append(f"{role}: {content}")
            if len(snippets) >= 3:
                break
        payload.append({
            "id": sid,
            "current_title": s.get("title") or "",
            "source": s.get("source") or "",
            "model": s.get("model") or "",
            "message_count": s.get("message_count") or 0,
            "tool_call_count": s.get("tool_call_count") or 0,
            "snippets": snippets,
        })

    prompt = (
        "You are renaming Hermes sessions.\n"
        f"Rules: return ONLY valid JSON array. Each item must include id and title.\n"
        f"Keep each title <= {max_title_len} chars, no quotes around words unless required.\n"
        "Keep titles concrete and distinct. Prefer imperative/task phrasing over generic labels.\n"
        f"Extra instructions: {body.instructions}\n\n"
        "Input sessions:\n"
        f"{json.dumps(payload, ensure_ascii=True)}\n\n"
        "Return format:\n"
        "[{\"id\":\"...\",\"title\":\"...\"}]"
    )

    result = await run_hermes_rename(prompt, body.model, body.provider, timeout_sec)
    if not result.get("ok"):
        return result

    raw_items = result.get("items", [])
    picked = []
    seen_ids = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        sid = item.get("id")
        if sid in seen_ids or sid not in by_id:
            continue
        title = safe_title(item.get("title"), max_len=max_title_len)
        if not title:
            continue
        seen_ids.add(sid)
        picked.append({
            "id": sid,
            "current_title": by_id[sid].get("title") or "",
            "title": title,
        })

    return {"ok": True, "suggestions": picked, "count": len(picked), "requested": len(targets)}


@router.get("/api/sessions/{session_id}/tools")
async def api_session_tools(session_id: str):
    return state_reader.get_tool_calls(session_id)


@router.get("/api/sessions/{session_id}/messages")
async def api_session_messages(session_id: str, limit: int = 50):
    return state_reader.get_messages(session_id, limit)


@router.get("/api/sessions/{session_id}")
async def api_session(session_id: str):
    row = state_reader.get_session(session_id)
    if row is None:
        return {"error": "not_found"}
    return row


class TitleBody(BaseModel):
    title: str


@router.put("/api/sessions/{session_id}/title")
async def api_session_rename(session_id: str, body: TitleBody):
    return state_reader.rename_session(session_id, body.title)


@router.post("/api/sessions/{session_id}/kill")
async def api_session_kill(session_id: str):
    ok = state_reader.kill_session(session_id)
    return {"ok": ok}


@router.get("/api/tools/meta")
async def api_tools_meta():
    """Return Hermes tool registry metadata: {tool_name: {emoji, ...}}."""
    try:
        hermes_src = os.path.join(os.path.dirname(__file__), "..", "..", "hermes-agent")
        if hermes_src not in sys.path:
            sys.path.insert(0, hermes_src)
        from tools.registry import registry
        result = {}
        for name, entry in registry._tools.items():
            meta = {}
            if entry.emoji:
                meta["emoji"] = entry.emoji
            if meta:
                result[name] = meta
        return result
    except Exception:
        return {}


@router.get("/api/stats")
async def api_stats():
    return state_reader.get_stats()


@router.get("/api/processes")
async def api_processes():
    try:
        return json.loads(PROCESSES_PATH.read_text())
    except Exception:
        return []


@router.get("/api/health")
async def api_health():
    import time
    from .. import state_reader as sr
    from .._config import HERMES_HOME
    db_path = sr._db_path()
    from pathlib import Path
    return {
        "ok": True,
        "plugin": "zimmer",
        "state_db_exists": Path(db_path).exists(),
        "state_db": str(db_path),
        "hermes_home": str(HERMES_HOME),
        "ts": time.time(),
    }
