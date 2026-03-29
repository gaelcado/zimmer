"""Gateway hook entrypoint for Zimmer bridge."""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def handle(event_type, context):
    """Relay gateway hook events to the Zimmer bridge module."""
    try:
        from hermes_plugins import zimmer as zimmer_mod  # type: ignore
        bridge = getattr(zimmer_mod, "gateway_hook_bridge", None)
        if bridge is None:
            import importlib
            bridge = importlib.import_module("hermes_plugins.zimmer.gateway_hook_bridge")
        handler = getattr(bridge, "handle", None)
        if handler is None:
            return
        result = handler(event_type, context or {})
        if asyncio.iscoroutine(result):
            await result
    except Exception as exc:
        logger.debug("Zimmer gateway hook handler skipped: %s", exc)
