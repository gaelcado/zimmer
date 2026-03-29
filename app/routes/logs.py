"""Log file browser endpoints."""

from pathlib import Path

from fastapi import APIRouter

from .._config import LOGS_DIR, tail_log_lines

router = APIRouter()


@router.get("/api/logs")
async def api_logs():
    if not LOGS_DIR.exists():
        return []
    items = []
    for p in sorted(LOGS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_file() or p.name.startswith("."):
            continue
        st = p.stat()
        items.append({
            "name": p.name,
            "path": str(p),
            "size": st.st_size,
            "mtime": st.st_mtime,
        })
    return items


@router.get("/api/logs/{filename}")
async def api_log_file(filename: str, tail: int = 800):
    if Path(filename).name != filename or "/" in filename or "\\" in filename:
        return {"error": "invalid filename"}
    p = LOGS_DIR / filename
    if not p.exists() or not p.is_file():
        return {"error": "not_found"}
    tail = max(50, min(5000, tail))
    view, truncated, shown_lines = tail_log_lines(p, tail)
    return {
        "name": filename,
        "path": str(p),
        "content": view,
        "truncated": truncated,
        "line_count": None,
        "shown_lines": shown_lines,
    }
