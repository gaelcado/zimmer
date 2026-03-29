"""SSE stream, event history, and active-tool/LLM inference endpoints."""

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .. import state_reader
from ..event_bus import EventBus

router = APIRouter()

# Set by create_app() after the bus is created.
_bus: EventBus | None = None


def set_bus(bus: EventBus) -> None:
    global _bus
    _bus = bus


@router.get("/api/events")
async def api_events(request: Request):
    bus = _bus

    async def gen():
        yield ": connected\n\n"
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        bus._lock.acquire()
        bus._subscribers.append(q)
        bus._lock.release()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            bus._lock.acquire()
            if q in bus._subscribers:
                bus._subscribers.remove(q)
            bus._lock.release()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/events/history")
async def api_events_history():
    return _bus.get_history()


@router.get("/api/events/active-tools")
async def api_active_tools():
    active = _bus.get_active_tools()
    db_inflight = state_reader.get_inflight_tool_calls(limit=400)
    for row in db_inflight:
        call_id = row.get("call_id")
        if not call_id:
            continue
        if call_id in active:
            # Backfill missing session_id when legacy hooks emit only task_id.
            if not active[call_id].get("session_id") and row.get("session_id"):
                active[call_id] = {**active[call_id], "session_id": row.get("session_id")}
            continue
        active[call_id] = {
            "type": "tool_start",
            "tool": row.get("tool_name") or "",
            "args": row.get("args"),
            "task_id": "",
            "call_id": call_id,
            "session_id": row.get("session_id") or "",
            "ts": row.get("started_at"),
        }
    return active


@router.get("/api/events/active-llm")
async def api_active_llm(window_sec: int = 180):
    sessions = state_reader.get_likely_thinking_sessions(window_sec=window_sec, limit=300)
    return {
        "sessions": sessions,
        "window_sec": max(20, min(1200, window_sec)),
        "source": "inferred_db",
    }
