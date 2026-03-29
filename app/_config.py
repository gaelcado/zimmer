"""Shared constants, helpers, and subprocess wrappers used across route modules."""

import asyncio
import json
import os
import re
import time
from pathlib import Path

import yaml
from fastapi import Request


# ── Paths / env ──────────────────────────────────────────────────────────────

HERMES_HOME = Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))
PROCESSES_PATH = HERMES_HOME / "processes.json"
LOGS_DIR = HERMES_HOME / "logs"
UI_DIST = Path(__file__).parent / "ui" / "dist"

WORKFLOW_API_TOKEN = os.getenv("ZIMMER_WORKFLOW_API_TOKEN", "").strip()
WORKFLOW_RUN_RETENTION_DAYS = float(os.getenv("ZIMMER_WORKFLOW_RUN_RETENTION_DAYS", "14"))
WORKFLOW_RUN_KEEP_PER_WORKFLOW = int(os.getenv("ZIMMER_WORKFLOW_RUN_KEEP_PER_WORKFLOW", "200"))

MAX_BATCH_RENAME_SESSIONS = 30


# ── Text helpers ─────────────────────────────────────────────────────────────

def safe_text(value: str | None, max_len: int = 220) -> str:
    if not value:
        return ""
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def safe_title(value: str | None, max_len: int = 100) -> str:
    if value is None:
        return ""
    text = re.sub(r"[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]", "", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len].rstrip()


def extract_json_array(text: str):
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "[":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, list):
            return obj
    return None


# ── Log reader ────────────────────────────────────────────────────────────────

def tail_log_lines(path: Path, tail_lines: int, max_scan_bytes: int = 2_000_000):
    """Return (content, truncated, shown_lines) without reading the full file."""
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        file_size = f.tell()
        pos = file_size
        chunks = []
        newline_count = 0
        scanned = 0
        chunk_size = 65536

        while pos > 0 and newline_count <= tail_lines and scanned < max_scan_bytes:
            read_size = min(chunk_size, pos, max_scan_bytes - scanned)
            pos -= read_size
            f.seek(pos)
            chunk = f.read(read_size)
            chunks.append(chunk)
            scanned += read_size
            newline_count += chunk.count(b"\n")

    data = b"".join(reversed(chunks))
    text = data.decode(errors="replace")
    lines = text.splitlines()
    truncated = pos > 0 or len(lines) > tail_lines
    if len(lines) > tail_lines:
        lines = lines[-tail_lines:]
    return "\n".join(lines), truncated, len(lines)


# ── Auth ──────────────────────────────────────────────────────────────────────

def check_workflow_auth(request: Request) -> dict | None:
    """Return error dict if auth fails, None if auth passes (or no token configured).

    Reads the token from the environment at call time so that tests can set
    ZIMMER_WORKFLOW_API_TOKEN via monkeypatch.setenv without a module reload.
    """
    token = os.getenv("ZIMMER_WORKFLOW_API_TOKEN", "").strip()
    if not token:
        return None
    incoming = (request.headers.get("x-zimmer-token") or "").strip()
    if incoming == token:
        return None
    return {"ok": False, "error": "unauthorized"}


# ── Async helpers ─────────────────────────────────────────────────────────────

async def call_blocking(func, *args, timeout_sec: float = 6.0, fallback=None):
    """Run a blocking function in a worker thread with timeout + safe fallback."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(func, *args), timeout=timeout_sec)
    except asyncio.TimeoutError:
        if fallback is not None:
            return fallback
        return {"error": f"timeout after {timeout_sec:.1f}s"}
    except Exception as e:
        if fallback is not None:
            if isinstance(fallback, dict):
                return {**fallback, "error": str(e)}
            return fallback
        return {"error": str(e)}


# ── Subprocess wrappers ───────────────────────────────────────────────────────

async def run_hermes_chat_text(
    prompt: str, model: str | None, provider: str | None, timeout_sec: int
) -> dict:
    cmd = ["hermes", "chat", "-Q", "-q", prompt]
    if model:
        cmd.extend(["-m", model])
    if provider:
        cmd.extend(["--provider", provider])
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {"ok": False, "error": f"timeout after {timeout_sec}s"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error": safe_text(err.decode(errors="replace"), 500) or f"hermes exited {proc.returncode}",
        }
    raw = out.decode(errors="replace")
    return {"ok": True, "output": raw.strip(), "raw": raw[:3000]}


async def run_hermes_rename(
    prompt: str, model: str | None, provider: str | None, timeout_sec: int
) -> dict:
    cmd = ["hermes", "chat", "-Q", "-q", prompt]
    if model:
        cmd.extend(["-m", model])
    if provider:
        cmd.extend(["--provider", provider])
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {"ok": False, "error": f"timeout after {timeout_sec}s"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error": safe_text(err.decode(errors="replace"), 400) or f"hermes exited {proc.returncode}",
        }
    raw = out.decode(errors="replace").strip()
    items = extract_json_array(raw)
    if items is None:
        return {"ok": False, "error": "could not parse JSON from hermes response", "raw": raw[:1000]}
    return {"ok": True, "items": items, "raw": raw[:1000]}
