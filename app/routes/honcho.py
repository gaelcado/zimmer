"""Honcho integration endpoints."""

from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from .. import honcho_reader
from .._config import call_blocking

router = APIRouter()


class ContextBody(BaseModel):
    content: str


@router.get("/api/honcho/status")
async def api_honcho_status():
    return await call_blocking(
        honcho_reader.get_honcho_status,
        timeout_sec=4.0,
        fallback={"configured": False, "enabled": False, "error": "honcho unavailable"},
    )


@router.get("/api/honcho/config")
async def api_honcho_config():
    return await call_blocking(
        honcho_reader.get_honcho_config,
        timeout_sec=4.0,
        fallback={
            "path": str(Path.home() / ".honcho" / "config.json"),
            "content": "",
            "exists": False,
            "error": "honcho unavailable",
        },
    )


@router.put("/api/honcho/config")
async def api_honcho_config_put(body: ContextBody):
    return honcho_reader.update_honcho_config(body.content)


@router.get("/api/honcho/sessions")
async def api_honcho_sessions():
    return await call_blocking(
        honcho_reader.list_honcho_sessions,
        timeout_sec=7.0,
        fallback=[],
    )


@router.get("/api/honcho/peers")
async def api_honcho_peers():
    return await call_blocking(
        honcho_reader.list_honcho_peers,
        timeout_sec=7.0,
        fallback=[],
    )


@router.get("/api/honcho/peers/{peer_id}")
async def api_honcho_peer(peer_id: str):
    return await call_blocking(
        honcho_reader.get_peer_representation,
        peer_id,
        timeout_sec=6.0,
        fallback={"error": "honcho unavailable"},
    )


@router.get("/api/honcho/sessions/{session_id}/context")
async def api_honcho_session_context(session_id: str):
    return await call_blocking(
        honcho_reader.get_honcho_session_context,
        session_id,
        timeout_sec=7.0,
        fallback={"error": "honcho unavailable"},
    )
