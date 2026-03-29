"""Gateway hook bridge: map Hermes gateway events to Zimmer bus events.

This module is used by the runtime hook handler deployed to ~/.hermes/hooks/.
Keeping logic here makes it testable and versioned with the plugin.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Approximate queue depth per user conversation key.
_queue_depth: dict[str, int] = {}
# Track last known session_id per user key.
_user_session: dict[str, str] = {}


def _user_key(ctx: dict[str, Any]) -> str:
    platform = (ctx.get("platform") or "").strip()
    user_id = (ctx.get("user_id") or "").strip()
    return f"{platform}:{user_id}"


def _extract_session_id(ctx: dict[str, Any]) -> str:
    return (ctx.get("session_id") or "").strip()


def _extract_session_key(ctx: dict[str, Any]) -> str:
    return (ctx.get("session_key") or "").strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _publish(bus: Any, payload: dict[str, Any]) -> None:
    try:
        bus.publish(payload)
    except Exception as exc:
        logger.debug("Zimmer gateway bridge publish failed: %s", exc)


def _resolve_bus():
    """Return the shared Zimmer bus from the loaded plugin module."""
    try:
        from hermes_plugins import zimmer as zimmer_mod  # type: ignore
    except Exception:
        return None
    try:
        return zimmer_mod._get_or_create_bus()
    except Exception:
        return None


def handle_gateway_event(event_type: str, context: dict[str, Any] | None) -> None:
    """Translate gateway hook events into Zimmer event bus payloads."""
    ctx = context or {}
    bus = _resolve_bus()
    if bus is None:
        return

    user_key = _user_key(ctx)
    session_id = _extract_session_id(ctx)
    if session_id:
        _user_session[user_key] = session_id
    else:
        session_id = _user_session.get(user_key, "")

    if event_type == "session:start":
        sid = session_id or _extract_session_key(ctx)
        if sid:
            _user_session[user_key] = sid
        _queue_depth[user_key] = 0
        _publish(
            bus,
            {
                "type": "session_start",
                "session_id": sid,
                "platform": ctx.get("platform", ""),
                "source": "gateway_hook",
            },
        )
        return

    if event_type in ("session:end", "session:reset"):
        sid = session_id or _extract_session_key(ctx)
        _publish(
            bus,
            {
                "type": "session_end",
                "session_id": sid,
                "platform": ctx.get("platform", ""),
                "source": "gateway_hook",
            },
        )
        _queue_depth.pop(user_key, None)
        if event_type == "session:reset":
            _user_session.pop(user_key, None)
        return

    if event_type == "agent:start":
        # Approximate dequeue: if queue depth was non-zero, one item is now processing.
        depth = _queue_depth.get(user_key, 0)
        if depth > 0:
            depth -= 1
            _queue_depth[user_key] = depth
            _publish(
                bus,
                {
                    "type": "queue_change",
                    "queue_depth": depth,
                    "session_id": session_id,
                    "source": "gateway_hook",
                },
            )
        _publish(
            bus,
            {
                "type": "agent_start",
                "session_id": session_id,
                "platform": ctx.get("platform", ""),
                "message_preview": (ctx.get("message") or "")[:160],
                "source": "gateway_hook",
            },
        )
        return

    if event_type == "agent:end":
        _publish(
            bus,
            {
                "type": "agent_end",
                "session_id": session_id,
                "platform": ctx.get("platform", ""),
                "response_preview": (ctx.get("response") or "")[:200],
                "source": "gateway_hook",
            },
        )
        return

    if event_type == "agent:step":
        _publish(
            bus,
            {
                "type": "agent_step",
                "session_id": session_id,
                "platform": ctx.get("platform", ""),
                "iteration": _safe_int(ctx.get("iteration"), 0),
                "tool_names": list(ctx.get("tool_names") or []),
                "source": "gateway_hook",
            },
        )
        return

    if event_type == "command:queue":
        args = (ctx.get("args") or "").strip()
        depth = _queue_depth.get(user_key, 0) + 1
        _queue_depth[user_key] = depth
        _publish(
            bus,
            {
                "type": "task_queued",
                "task_id": "",
                "prompt_preview": args[:120],
                "session_id": session_id,
                "source": "gateway_hook",
            },
        )
        _publish(
            bus,
            {
                "type": "queue_change",
                "queue_depth": depth,
                "session_id": session_id,
                "source": "gateway_hook",
            },
        )
        return

    if event_type == "command:approve":
        _publish(
            bus,
            {
                "type": "permission_resolved",
                "tool": "terminal",
                "approved": True,
                "session_id": session_id,
                "scope": (ctx.get("args") or "").strip().lower(),
                "source": "gateway_hook",
            },
        )
        return

    if event_type == "command:deny":
        _publish(
            bus,
            {
                "type": "permission_resolved",
                "tool": "terminal",
                "approved": False,
                "session_id": session_id,
                "source": "gateway_hook",
            },
        )
        return


async def handle(event_type: str, context: dict[str, Any] | None = None) -> None:
    """Async entrypoint used by gateway hook loader."""
    # Keep it non-blocking for gateway. The logic is sync and fast.
    await asyncio.sleep(0)
    handle_gateway_event(event_type, context)
