"""Hermes Zimmer plugin — DAW-style agent monitor."""

import asyncio
import json
import logging
import os
import socket
from pathlib import Path
import threading
import time
import webbrowser
from uuid import uuid4

from . import gateway_hook_bridge  # noqa: F401 - imported for hook handler access

logger = logging.getLogger(__name__)

# ── Singleton bus shared by the plugin path and the gateway hook path ─────────

_bus = None
_bus_lock = threading.Lock()


def _get_or_create_bus():
    """Return the process-wide EventBus, creating it on first call."""
    global _bus
    if _bus is not None:
        return _bus
    with _bus_lock:
        if _bus is None:
            from .event_bus import EventBus
            _bus = EventBus()
    return _bus


def _is_port_in_use(host: str = "127.0.0.1", port: int = 7778) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def _register_hook_if_supported(ctx, hook_name: str, callback) -> bool:
    """Register a hook only when the host advertises support for it."""
    valid_hooks = set()
    try:
        from hermes_cli.plugins import VALID_HOOKS as _VALID_HOOKS
        valid_hooks = set(_VALID_HOOKS)
    except Exception:
        # If host introspection fails, fall back to direct registration.
        # Hermes will warn for unknown hooks, but runtime behavior remains.
        valid_hooks = set()

    if valid_hooks and hook_name not in valid_hooks:
        logger.debug("Zimmer: host does not support hook '%s'; skipping.", hook_name)
        return False

    try:
        ctx.register_hook(hook_name, callback)
        return True
    except (AttributeError, ValueError):
        # Older/strict hosts may reject unknown hooks via exceptions.
        logger.debug("Zimmer: host rejected hook '%s'; skipping.", hook_name)
        return False


def _sync_gateway_hook_files() -> None:
    """Install/update Zimmer gateway hook files under ~/.hermes/hooks."""
    if os.getenv("ZIMMER_DISABLE_GATEWAY_HOOK_SYNC", "").strip().lower() in {"1", "true", "yes"}:
        return

    src_dir = Path(__file__).resolve().parent / "gateway_hook"
    if not src_dir.exists():
        return

    hermes_home = Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")))
    dst_dir = hermes_home / "hooks" / "zimmer_gateway_bridge"
    dst_dir.mkdir(parents=True, exist_ok=True)

    for rel in ("HOOK.yaml", "handler.py"):
        src = src_dir / rel
        dst = dst_dir / rel
        try:
            content = src.read_text(encoding="utf-8")
            if dst.exists() and dst.read_text(encoding="utf-8") == content:
                continue
            dst.write_text(content, encoding="utf-8")
        except Exception as exc:
            logger.debug("Zimmer: failed syncing gateway hook file %s: %s", rel, exc)


def register(ctx) -> None:
    bus = _get_or_create_bus()
    _sync_gateway_hook_files()

    # ── Tool lifecycle ────────────────────────────────────────────────────────

    def on_pre_tool(tool_name: str, args, task_id: str = "", **kwargs):
        session_id = kwargs.get("session_id") or ""
        call_id = str(uuid4())[:12]
        bus.publish({
            "type": "tool_start",
            "tool": tool_name,
            "args": args,
            "task_id": task_id,
            "call_id": call_id,
            "session_id": session_id,
        })

    def on_post_tool(tool_name: str, args, result, task_id: str = "", **kwargs):
        session_id = kwargs.get("session_id") or ""
        preview = result[:300] if isinstance(result, str) else ""
        call_id = bus.find_pending_call_id(tool_name, task_id) or str(uuid4())[:12]
        bus.publish({
            "type": "tool_end",
            "tool": tool_name,
            "task_id": task_id,
            "call_id": call_id,
            "session_id": session_id,
            "result_preview": preview,
        })

        # Compatibility fallback: Hermes v0.5 exposes no permission hooks yet.
        # Infer "permission requested" events from terminal approval-required
        # tool responses so Zimmer still surfaces approval pauses.
        if tool_name == "terminal" and isinstance(result, str):
            try:
                payload = json.loads(result)
            except Exception:
                payload = {}
            if payload.get("status") == "approval_required":
                bus.publish({
                    "type": "permission_request",
                    "tool": "terminal",
                    "reason": payload.get("description", "command flagged"),
                    "session_id": session_id,
                    "command": payload.get("command", ""),
                })

    _register_hook_if_supported(ctx, "pre_tool_call", on_pre_tool)
    _register_hook_if_supported(ctx, "post_tool_call", on_post_tool)

    # ── Session lifecycle ─────────────────────────────────────────────────────

    def on_session_start(session_id: str = "", platform: str = "", **kwargs):
        bus.publish({
            "type": "session_start",
            "session_id": session_id,
            "platform": platform,
        })

    def on_session_end(session_id: str = "", platform: str = "", **kwargs):
        bus.publish({
            "type": "session_end",
            "session_id": session_id,
            "platform": platform,
        })

    _register_hook_if_supported(ctx, "on_session_start", on_session_start)
    _register_hook_if_supported(ctx, "on_session_end", on_session_end)

    # ── LLM call lifecycle ────────────────────────────────────────────────────

    def on_pre_llm(messages=None, model: str = "", **kwargs):
        session_id = kwargs.get("session_id") or kwargs.get("task_id", "")
        bus.publish({
            "type": "llm_start",
            "model": model,
            "session_id": session_id,
            "message_count": len(messages) if messages else 0,
        })

    def on_post_llm(messages=None, response=None, model: str = "", **kwargs):
        session_id = kwargs.get("session_id") or kwargs.get("task_id", "")
        bus.publish({
            "type": "llm_end",
            "model": model,
            "session_id": session_id,
        })

    _register_hook_if_supported(ctx, "pre_llm_call", on_pre_llm)
    _register_hook_if_supported(ctx, "post_llm_call", on_post_llm)

    # ── Permission approval lifecycle (v0.4.0+) ───────────────────────────────
    # Wrapped in try/except so the plugin loads cleanly on older Hermes hosts
    # that don't expose these hooks.

    def on_permission_request(tool_name: str = "", reason: str = "", session_id: str = "", **kwargs):
        bus.publish({
            "type": "permission_request",
            "tool": tool_name,
            "reason": reason,
            "session_id": session_id,
        })

    def on_permission_resolved(tool_name: str = "", approved: bool = False, session_id: str = "", **kwargs):
        bus.publish({
            "type": "permission_resolved",
            "tool": tool_name,
            "approved": approved,
            "session_id": session_id,
        })

    _register_hook_if_supported(ctx, "on_permission_request", on_permission_request)
    _register_hook_if_supported(ctx, "on_permission_resolved", on_permission_resolved)

    # ── Queue events (v0.4.0+) ────────────────────────────────────────────────

    def on_task_queued(task_id: str = "", prompt: str = "", session_id: str = "", **kwargs):
        bus.publish({
            "type": "task_queued",
            "task_id": task_id,
            "prompt_preview": (prompt or "")[:120],
            "session_id": session_id,
        })

    def on_queue_change(queue_depth: int = 0, session_id: str = "", **kwargs):
        bus.publish({
            "type": "queue_change",
            "queue_depth": queue_depth,
            "session_id": session_id,
        })

    _register_hook_if_supported(ctx, "on_task_queued", on_task_queued)
    _register_hook_if_supported(ctx, "on_queue_change", on_queue_change)

    _start_server_thread(bus)


def _find_call_id(bus, tool_name: str, task_id: str) -> str:
    """Legacy fallback — use bus.find_pending_call_id() instead."""
    result = bus.find_pending_call_id(tool_name, task_id)
    if result:
        return result
    return str(uuid4())[:12]


def _start_server_thread(bus, open_browser: bool = True) -> None:
    if _is_port_in_use("127.0.0.1", 7778):
        logger.info("Zimmer: UI already running on 127.0.0.1:7778, skipping duplicate server start.")
        return

    def run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        bus.set_server_loop(loop)

        try:
            import uvicorn
        except ImportError:
            logger.warning("Zimmer: uvicorn not installed — UI unavailable.")
            return

        from .server import create_app

        app = create_app(bus)
        config = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=7778,
            loop="none",
            log_level="error",
            access_log=False,
        )
        server = uvicorn.Server(config)
        try:
            loop.run_until_complete(server.serve())
        except OSError as e:
            logger.warning("Zimmer: port 7778 in use — UI unavailable. (%s)", e)
        finally:
            loop.close()

    threading.Thread(target=run, name="hermes-zimmer", daemon=True).start()

    if open_browser and not os.getenv("ZIMMER_NO_BROWSER"):
        threading.Thread(
            target=lambda: (time.sleep(0.4), webbrowser.open("http://127.0.0.1:7778")),
            daemon=True,
        ).start()
