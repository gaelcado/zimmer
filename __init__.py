"""Hermes Zimmer plugin — DAW-style agent orchestration monitor."""

import asyncio
import logging
import os
import socket
import threading
import time
import webbrowser
from uuid import uuid4

logger = logging.getLogger(__name__)


def _is_port_in_use(host: str = "127.0.0.1", port: int = 7778) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def register(ctx) -> None:
    from .event_bus import EventBus

    bus = EventBus()

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

    ctx.register_hook("pre_tool_call", on_pre_tool)
    ctx.register_hook("post_tool_call", on_post_tool)

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

    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)

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

    ctx.register_hook("pre_llm_call", on_pre_llm)
    ctx.register_hook("post_llm_call", on_post_llm)

    _start_server_thread(bus)


def _find_call_id(bus, tool_name: str, task_id: str) -> str:
    """Legacy fallback — use bus.find_pending_call_id() instead."""
    result = bus.find_pending_call_id(tool_name, task_id)
    if result:
        return result
    return str(uuid4())[:12]


def _start_server_thread(bus) -> None:
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

    if not os.getenv("ZIMMER_NO_BROWSER"):
        threading.Thread(
            target=lambda: (time.sleep(0.4), webbrowser.open("http://127.0.0.1:7778")),
            daemon=True,
        ).start()
