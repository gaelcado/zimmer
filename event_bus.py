"""Thread-safe event bus: CLI thread → asyncio SSE stream."""

import asyncio
import logging
import threading
import time
from collections import deque
from typing import AsyncGenerator
from uuid import uuid4

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self, max_size: int = 2000):
        self._events: deque = deque(maxlen=max_size)
        self._subscribers: list[asyncio.Queue] = []
        self._lock = threading.Lock()
        self._server_loop: asyncio.AbstractEventLoop | None = None
        # Maintained incrementally — O(1) on publish instead of O(n) scan
        self._active_tools: dict[str, dict] = {}
        # Index for fast call_id lookup: (tool_name, task_id) → [call_ids]
        self._pending_calls: dict[tuple[str, str], list[str]] = {}

    def set_server_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._server_loop = loop

    def publish(self, event: dict) -> None:
        """Called from CLI thread — must not block."""
        event = {**event, "id": str(uuid4()), "ts": time.time()}
        with self._lock:
            self._events.append(event)
            # Maintain active tools index
            etype = event.get("type")
            call_id = event.get("call_id")
            if etype == "tool_start" and call_id:
                self._active_tools[call_id] = event
                key = (event.get("tool", ""), event.get("task_id", ""))
                self._pending_calls.setdefault(key, []).append(call_id)
            elif etype == "tool_end" and call_id:
                self._active_tools.pop(call_id, None)
                key = (event.get("tool", ""), event.get("task_id", ""))
                pending = self._pending_calls.get(key)
                if pending and call_id in pending:
                    pending.remove(call_id)
                    if not pending:
                        del self._pending_calls[key]

            loop = self._server_loop
            subs = list(self._subscribers)

        if loop and loop.is_running():
            for q in subs:
                try:
                    loop.call_soon_threadsafe(q.put_nowait, event)
                except asyncio.QueueFull:
                    logger.debug("Zimmer: SSE subscriber queue full — dropping event %s", event.get("type"))
                except RuntimeError:
                    pass  # loop closed or subscriber gone

    async def subscribe(self) -> AsyncGenerator[dict, None]:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        with self._lock:
            self._subscribers.append(q)
        try:
            while True:
                yield await q.get()
        finally:
            with self._lock:
                if q in self._subscribers:
                    self._subscribers.remove(q)

    def get_history(self) -> list[dict]:
        with self._lock:
            return list(self._events)

    def get_active_tools(self) -> dict[str, dict]:
        """Return currently active (unmatched) tool calls. O(1) — maintained incrementally."""
        with self._lock:
            return dict(self._active_tools)

    def find_pending_call_id(self, tool_name: str, task_id: str) -> str | None:
        """Find the most recent unmatched call_id for a given tool+session. O(1)."""
        with self._lock:
            key = (tool_name, task_id)
            pending = self._pending_calls.get(key)
            if pending:
                return pending[-1]  # LIFO: most recent unmatched
        return None
