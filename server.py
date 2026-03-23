"""FastAPI server: REST endpoints + SSE + SPA static file serving."""

import asyncio
import fcntl
import json
import os
import pty
import re
import struct
import termios
import time
from pathlib import Path

import yaml
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .event_bus import EventBus
from . import state_reader
from . import honcho_reader
from . import workflow_store
from . import workflow_engine
from . import cron_store


_UI_DIST = Path(__file__).parent / "ui" / "dist"
_HERMES_HOME = Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))
_PROCESSES_PATH = _HERMES_HOME / "processes.json"
_LOGS_DIR = _HERMES_HOME / "logs"
_MAX_BATCH_RENAME_SESSIONS = 30
_WORKFLOW_RUN_TASKS: dict[str, asyncio.Task] = {}
_WORKFLOW_API_TOKEN = os.getenv("ZIMMER_WORKFLOW_API_TOKEN", "").strip()
_WORKFLOW_RUN_RETENTION_DAYS = float(os.getenv("ZIMMER_WORKFLOW_RUN_RETENTION_DAYS", "14"))
_WORKFLOW_RUN_KEEP_PER_WORKFLOW = int(os.getenv("ZIMMER_WORKFLOW_RUN_KEEP_PER_WORKFLOW", "200"))


def _tail_log_lines(path: Path, tail_lines: int, max_scan_bytes: int = 2_000_000):
    """Return (content, truncated, shown_lines) without reading the full file by default."""
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


def _safe_text(value: str | None, max_len: int = 220) -> str:
    if not value:
        return ""
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def _safe_title(value: str | None, max_len: int = 100) -> str:
    if value is None:
        return ""
    text = re.sub(r"[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]", "", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len].rstrip()


def _extract_json_array(text: str):
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


async def _run_hermes_rename(prompt: str, model: str | None, provider: str | None, timeout_sec: int):
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
        return {"ok": False, "error": _safe_text(err.decode(errors="replace"), 400) or f"hermes exited {proc.returncode}"}
    raw = out.decode(errors="replace").strip()
    items = _extract_json_array(raw)
    if items is None:
        return {"ok": False, "error": "could not parse JSON from hermes response", "raw": raw[:1000]}
    return {"ok": True, "items": items, "raw": raw[:1000]}


async def _run_hermes_chat_text(prompt: str, model: str | None, provider: str | None, timeout_sec: int):
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
        return {"ok": False, "error": _safe_text(err.decode(errors="replace"), 500) or f"hermes exited {proc.returncode}"}
    raw = out.decode(errors="replace")
    return {"ok": True, "output": raw.strip(), "raw": raw[:3000]}


def _configured_skill_name_set(platform: str = "cli") -> set[str]:
    rows = workflow_store.list_configured_skills(platform=platform)
    return {str(r.get("name") or "").strip() for r in rows if str(r.get("name") or "").strip()}


def _check_workflow_auth(request: Request) -> dict | None:
    if not _WORKFLOW_API_TOKEN:
        return None
    incoming = (request.headers.get("x-zimmer-token") or "").strip()
    if incoming == _WORKFLOW_API_TOKEN:
        return None
    return {"ok": False, "error": "unauthorized"}


async def _call_blocking_with_timeout(func, *args, timeout_sec: float = 6.0, fallback=None):
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


def create_app(bus: EventBus) -> FastAPI:
    app = FastAPI(title="Hermes Zimmer", docs_url=None, redoc_url=None)

    @app.on_event("startup")
    async def _workflow_startup_reconcile():
        # Recover stale runs left "running" across plugin restarts.
        workflow_store.reconcile_running_runs()
        workflow_store.cleanup_run_records(
            max_age_days=_WORKFLOW_RUN_RETENTION_DAYS,
            keep_per_workflow=_WORKFLOW_RUN_KEEP_PER_WORKFLOW,
            dry_run=False,
        )

    # ── REST ──────────────────────────────────────────────────────────────────

    @app.get("/api/sessions")
    async def api_sessions(limit: int = 50, offset: int = 0):
        return state_reader.get_sessions(limit, offset)

    class BatchRenameSuggestBody(BaseModel):
        session_ids: list[str] = []
        instructions: str = "Create concise, descriptive session titles."
        max_title_len: int = 54
        model: str | None = None
        provider: str | None = None
        timeout_sec: int = 90

    @app.post("/api/sessions/batch-rename/suggest")
    async def api_sessions_batch_rename_suggest(body: BatchRenameSuggestBody):
        requested = [sid for sid in body.session_ids if isinstance(sid, str) and sid.strip()]
        requested = requested[:_MAX_BATCH_RENAME_SESSIONS]
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
                content = _safe_text(m.get("content", ""), 180)
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

        result = await _run_hermes_rename(prompt, body.model, body.provider, timeout_sec)
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
            title = _safe_title(item.get("title"), max_len=max_title_len)
            if not title:
                continue
            seen_ids.add(sid)
            picked.append({
                "id": sid,
                "current_title": by_id[sid].get("title") or "",
                "title": title,
            })

        return {"ok": True, "suggestions": picked, "count": len(picked), "requested": len(targets)}

    @app.get("/api/sessions/active")
    async def api_sessions_active():
        return state_reader.get_active_sessions()

    @app.get("/api/tools/meta")
    async def api_tools_meta():
        """Return Hermes tool registry metadata: {tool_name: {emoji, ...}}."""
        try:
            import sys
            import os
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

    @app.get("/api/sessions/{session_id}/tools")
    async def api_session_tools(session_id: str):
        return state_reader.get_tool_calls(session_id)

    @app.get("/api/sessions/{session_id}")
    async def api_session(session_id: str):
        row = state_reader.get_session(session_id)
        if row is None:
            return {"error": "not_found"}
        return row

    @app.get("/api/sessions/{session_id}/messages")
    async def api_session_messages(session_id: str, limit: int = 50):
        return state_reader.get_messages(session_id, limit)

    @app.get("/api/processes")
    async def api_processes():
        try:
            text = _PROCESSES_PATH.read_text()
            return json.loads(text)
        except Exception:
            return []

    @app.get("/api/logs")
    async def api_logs():
        if not _LOGS_DIR.exists():
            return []
        items = []
        for p in sorted(_LOGS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
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

    @app.get("/api/logs/{filename}")
    async def api_log_file(filename: str, tail: int = 800):
        if Path(filename).name != filename or "/" in filename or "\\" in filename:
            return {"error": "invalid filename"}
        p = _LOGS_DIR / filename
        if not p.exists() or not p.is_file():
            return {"error": "not_found"}

        tail = max(50, min(5000, tail))
        view, truncated, shown_lines = _tail_log_lines(p, tail)
        return {
            "name": filename,
            "path": str(p),
            "content": view,
            "truncated": truncated,
            "line_count": None,
            "shown_lines": shown_lines,
        }

    @app.get("/api/stats")
    async def api_stats():
        return state_reader.get_stats()

    @app.get("/api/health")
    async def api_health():
        db_path = Path(state_reader._db_path())
        return {
            "ok": True,
            "plugin": "zimmer",
            "state_db_exists": db_path.exists(),
            "state_db": str(db_path),
            "hermes_home": str(_HERMES_HOME),
            "ts": time.time(),
        }

    # ── Workflows ───────────────────────────────────────────────────────────

    class WorkflowCreateBody(BaseModel):
        name: str = "New Workflow"
        description: str = ""

    class WorkflowUpdateBody(BaseModel):
        name: str | None = None
        description: str | None = None
        graph: dict | None = None
        defaults: dict | None = None
        metadata: dict | None = None
        version: int | None = None

    class WorkflowRunBody(BaseModel):
        input: str = ""
        model: str | None = None
        provider: str | None = None
        dry_run: bool = False
        timeout_sec: int = 120
        max_steps: int = 200
        default_retries: int = 0
        retry_backoff_ms: int = 350
        max_output_chars: int = 12000

    class WorkflowImportBody(BaseModel):
        content: str
        overwrite: bool = False

    class WorkflowRunCleanupBody(BaseModel):
        max_age_days: float = _WORKFLOW_RUN_RETENTION_DAYS
        keep_per_workflow: int = _WORKFLOW_RUN_KEEP_PER_WORKFLOW
        dry_run: bool = False

    @app.get("/api/workflows")
    async def api_workflows():
        return workflow_store.list_workflows()

    @app.get("/api/workflows/auth")
    async def api_workflows_auth():
        return {"required": bool(_WORKFLOW_API_TOKEN)}

    @app.post("/api/workflows")
    async def api_workflows_create(body: WorkflowCreateBody, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        wf = workflow_store.create_workflow(body.name, body.description)
        return {"ok": True, "workflow": wf}

    @app.post("/api/workflows/import")
    async def api_workflows_import(body: WorkflowImportBody, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        if len(body.content.encode("utf-8", errors="replace")) > 512_000:
            return {"ok": False, "error": "import too large (max 512KB)"}
        try:
            parsed = yaml.safe_load(body.content) or {}
        except yaml.YAMLError as e:
            return {"ok": False, "error": f"invalid_yaml: {e}"}
        if not isinstance(parsed, dict):
            return {"ok": False, "error": "workflow content must be a YAML object"}

        try:
            workflow_engine.validate_workflow(
                parsed,
                configured_skill_names=_configured_skill_name_set("cli"),
                allow_incomplete=True,
            )
        except workflow_engine.WorkflowValidationError as e:
            return {"ok": False, "error": "invalid_workflow", "issues": e.issues}

        wf = workflow_store.import_workflow_definition(parsed, overwrite=body.overwrite)
        return {"ok": True, "workflow": wf}

    @app.get("/api/workflows/runs")
    async def api_workflow_runs(workflow_id: str | None = None, limit: int = 40):
        rows = workflow_store.list_run_records(workflow_id=workflow_id, limit=limit)
        return {"ok": True, "runs": rows}

    @app.get("/api/workflows/runs/metrics")
    async def api_workflow_runs_metrics(workflow_id: str | None = None, window_sec: int = 86400):
        return {"ok": True, "metrics": workflow_store.run_metrics(workflow_id=workflow_id, window_sec=window_sec)}

    @app.post("/api/workflows/runs/cleanup")
    async def api_workflow_runs_cleanup(body: WorkflowRunCleanupBody, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        result = workflow_store.cleanup_run_records(
            max_age_days=body.max_age_days,
            keep_per_workflow=body.keep_per_workflow,
            dry_run=body.dry_run,
        )
        return {"ok": True, **result}

    @app.get("/api/workflows/skills")
    async def api_workflows_skills(platform: str = "cli"):
        skills = workflow_store.list_configured_skills(platform=platform)
        return {
            "platform": platform,
            "count": len(skills),
            "skills": skills,
        }

    @app.get("/api/workflows/{workflow_id}")
    async def api_workflow_get(workflow_id: str):
        wf = workflow_store.get_workflow(workflow_id)
        if wf is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "workflow": wf}

    @app.get("/api/workflows/{workflow_id}/export")
    async def api_workflow_export(workflow_id: str, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        text = workflow_store.export_workflow_yaml(workflow_id)
        if text is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "workflow_id": workflow_id, "content": text}

    @app.get("/api/workflows/{workflow_id}/validate")
    async def api_workflow_validate(workflow_id: str):
        wf = workflow_store.get_workflow(workflow_id)
        if wf is None:
            return {"ok": False, "error": "not_found"}
        try:
            graph = workflow_engine.validate_workflow(
                wf,
                configured_skill_names=_configured_skill_name_set("cli"),
            )
            return {
                "ok": True,
                "issues": [],
                "order": graph["order"],
                "edge_count": len(graph["edges"]),
            }
        except workflow_engine.WorkflowValidationError as e:
            return {"ok": False, "error": "invalid_workflow", "issues": e.issues}

    @app.get("/api/workflows/runs/{run_id}")
    async def api_workflow_run_get(run_id: str):
        run = workflow_store.get_run_record(run_id)
        if run is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "run": run}

    @app.post("/api/workflows/runs/{run_id}/cancel")
    async def api_workflow_run_cancel(run_id: str, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        task = _WORKFLOW_RUN_TASKS.get(run_id)
        run = workflow_store.get_run_record(run_id)
        if run is None:
            return {"ok": False, "error": "not_found"}
        if task and not task.done():
            task.cancel()
        run["status"] = "canceled"
        run["ended_at"] = time.time()
        run["error"] = "canceled by user"
        workflow_store.save_run_record(run)
        return {"ok": True}

    @app.post("/api/workflows/{workflow_id}/run")
    async def api_workflow_run(workflow_id: str, body: WorkflowRunBody, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        wf = workflow_store.get_workflow(workflow_id)
        if wf is None:
            return {"ok": False, "error": "not_found"}

        try:
            graph = workflow_engine.validate_workflow(
                wf,
                configured_skill_names=_configured_skill_name_set("cli"),
            )
        except workflow_engine.WorkflowValidationError as e:
            return {"ok": False, "error": "invalid_workflow", "issues": e.issues}

        timeout_sec = max(10, min(600, body.timeout_sec))
        max_steps = max(1, min(1000, body.max_steps))
        default_retries = max(0, min(6, body.default_retries))
        retry_backoff_ms = max(0, min(10_000, body.retry_backoff_ms))
        max_output_chars = max(500, min(200_000, body.max_output_chars))
        run = workflow_store.create_run_record(
            workflow_id=workflow_id,
            workflow_name=wf.get("name") or workflow_id,
            payload={
                "input": body.input or "",
                "model": body.model or "",
                "provider": body.provider or "",
                "dry_run": body.dry_run,
                "timeout_sec": timeout_sec,
                "max_steps": max_steps,
                "default_retries": default_retries,
                "retry_backoff_ms": retry_backoff_ms,
                "max_output_chars": max_output_chars,
            },
        )
        run["events"] = []
        workflow_store.save_run_record(run)

        def log_event(level: str, message: str, node_id: str = "", attempt: int | None = None):
            event = {
                "ts": time.time(),
                "level": level,
                "message": _safe_text(message, 500),
            }
            if node_id:
                event["node_id"] = node_id
            if attempt is not None:
                event["attempt"] = attempt
            run.setdefault("events", []).append(event)
            if len(run["events"]) > 500:
                run["events"] = run["events"][-500:]

        async def _execute():
            try:
                initial_input = body.input or ""
                node_outputs: dict[str, str] = {}
                order = graph["order"]
                predecessors = graph["predecessors"]
                node_map = graph["node_map"]

                for idx, node_id in enumerate(order):
                    if idx >= max_steps:
                        run["status"] = "error"
                        run["ended_at"] = time.time()
                        run["error"] = f"max_steps exceeded ({max_steps})"
                        workflow_store.save_run_record(run)
                        return

                    node = node_map[node_id]
                    node_type = str(node.get("type") or "prompt")
                    node_input = workflow_engine.render_node_input(initial_input, predecessors.get(node_id, []), node_outputs)
                    node_retries = max(0, min(6, int(node.get("retries", default_retries) or 0)))
                    step_timeout = max(10, min(600, int(node.get("timeout_sec", timeout_sec) or timeout_sec)))
                    step = {
                        "index": idx,
                        "node_id": node_id,
                        "node_type": node_type,
                        "status": "running",
                        "started_at": time.time(),
                        "ended_at": None,
                        "input_preview": _safe_text(node_input, 280),
                        "output_preview": "",
                        "error": "",
                        "attempts": 0,
                    }
                    run["steps"].append(step)
                    log_event("info", f"node start ({node_type})", node_id=node_id)
                    workflow_store.save_run_record(run)

                    if body.dry_run:
                        rendered = f"[dry-run] {node_type}:{node_id} executed with {len(predecessors.get(node_id, []))} upstream inputs."
                        step["status"] = "ok"
                        step["ended_at"] = time.time()
                        step["output_preview"] = _safe_text(rendered, 280)
                        node_outputs[node_id] = rendered
                        step["attempts"] = 1
                        log_event("info", "node dry-run complete", node_id=node_id, attempt=1)
                        workflow_store.save_run_record(run)
                        continue

                    attempt = 0
                    node_done = False
                    last_error = ""
                    while attempt <= node_retries and not node_done:
                        attempt += 1
                        step["attempts"] = attempt
                        log_event("info", "node attempt", node_id=node_id, attempt=attempt)
                        if node_type == "skill":
                            skill_name = str(node.get("skill") or node.get("label") or "").strip()
                            cmd_key = workflow_engine.skill_command_key(skill_name)
                            prompt = (
                                f"/{cmd_key}\n\n"
                                "Run this workflow skill node and return only the node output text.\n\n"
                                f"Input:\n{node_input}"
                            )
                        else:
                            prompt_tmpl = str(node.get("prompt") or "").strip()
                            if not prompt_tmpl:
                                prompt_tmpl = "Process this workflow input and produce a concise output."
                            prompt = prompt_tmpl.replace("{input}", node_input)
                            if "{input}" not in prompt_tmpl:
                                prompt = f"{prompt_tmpl}\n\nInput:\n{node_input}"

                        result = await _run_hermes_chat_text(
                            prompt=prompt,
                            model=body.model or wf.get("defaults", {}).get("model") or None,
                            provider=body.provider or wf.get("defaults", {}).get("provider") or None,
                            timeout_sec=step_timeout,
                        )
                        if result.get("ok"):
                            output = str(result.get("output") or "")
                            if len(output) > max_output_chars:
                                output = output[:max_output_chars]
                                log_event("warn", f"node output truncated to {max_output_chars} chars", node_id=node_id, attempt=attempt)
                            step["status"] = "ok"
                            step["ended_at"] = time.time()
                            step["output_preview"] = _safe_text(output, 280)
                            node_outputs[node_id] = output
                            log_event("info", "node succeeded", node_id=node_id, attempt=attempt)
                            workflow_store.save_run_record(run)
                            node_done = True
                            break

                        last_error = result.get("error") or "node execution failed"
                        log_event("warn", f"node failed: {last_error}", node_id=node_id, attempt=attempt)
                        if attempt <= node_retries and retry_backoff_ms > 0:
                            await asyncio.sleep(retry_backoff_ms / 1000.0)

                    if not node_done:
                        step["status"] = "error"
                        step["ended_at"] = time.time()
                        step["error"] = last_error or "node execution failed"
                        run["status"] = "error"
                        run["ended_at"] = time.time()
                        run["error"] = step["error"]
                        log_event("error", f"node terminal failure: {run['error']}", node_id=node_id, attempt=step["attempts"])
                        workflow_store.save_run_record(run)
                        return

                run["status"] = "ok"
                run["ended_at"] = time.time()
                final_node = order[-1] if order else ""
                final_output = node_outputs.get(final_node, initial_input)
                if len(final_output) > max_output_chars:
                    final_output = final_output[:max_output_chars]
                    log_event("warn", f"final output truncated to {max_output_chars} chars")
                run["final_output"] = final_output
                log_event("info", "run completed")
                workflow_store.save_run_record(run)
            except asyncio.CancelledError:
                run["status"] = "canceled"
                run["ended_at"] = time.time()
                run["error"] = "canceled by user"
                log_event("warn", "run canceled")
                workflow_store.save_run_record(run)
            except Exception as e:
                run["status"] = "error"
                run["ended_at"] = time.time()
                run["error"] = _safe_text(str(e), 500)
                log_event("error", run["error"])
                workflow_store.save_run_record(run)
            finally:
                _WORKFLOW_RUN_TASKS.pop(run["run_id"], None)

        task = asyncio.create_task(_execute())
        _WORKFLOW_RUN_TASKS[run["run_id"]] = task
        return {"ok": True, "run_id": run["run_id"]}

    @app.put("/api/workflows/{workflow_id}")
    async def api_workflow_update(workflow_id: str, body: WorkflowUpdateBody, request: Request):
        auth_err = _check_workflow_auth(request)
        if auth_err:
            return auth_err
        payload = body.model_dump(exclude_none=True)
        existing = workflow_store.get_workflow(workflow_id)
        if existing is None:
            return {"ok": False, "error": "not_found"}
        candidate = {**existing, **payload}
        try:
            workflow_engine.validate_workflow(
                candidate,
                configured_skill_names=_configured_skill_name_set("cli"),
                allow_incomplete=True,
            )
        except workflow_engine.WorkflowValidationError as e:
            return {"ok": False, "error": "invalid_workflow", "issues": e.issues}
        wf = workflow_store.update_workflow(workflow_id, payload)
        if wf is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "workflow": wf}

    class TitleBody(BaseModel):
        title: str

    @app.put("/api/sessions/{session_id}/title")
    async def api_session_rename(session_id: str, body: TitleBody):
        return state_reader.rename_session(session_id, body.title)

    @app.post("/api/sessions/{session_id}/kill")
    async def api_session_kill(session_id: str):
        ok = state_reader.kill_session(session_id)
        return {"ok": ok}

    # ── Context files ────────────────────────────────────────────────────────

    class ContextBody(BaseModel):
        content: str

    @app.get("/api/context/soul")
    async def api_context_soul():
        p = _HERMES_HOME / "SOUL.md"
        if not p.exists():
            return {"path": str(p), "content": "", "exists": False}
        return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}

    @app.put("/api/context/soul")
    async def api_context_soul_put(body: ContextBody):
        p = _HERMES_HOME / "SOUL.md"
        p.write_text(body.content)
        return {"ok": True, "bytes": len(body.content.encode())}

    # Workspace context file names the agent picks up
    _CONTEXT_FILENAMES = [
        "AGENTS.md", ".hermes.md", "HERMES.md", "CLAUDE.md",
        ".cursorrules",
    ]

    @app.get("/api/context/workspace")
    async def api_context_workspace():
        """Discover editable workspace context files (AGENTS.md, .hermes.md, etc.)."""
        home = Path.home()
        found = []
        # Scan home dir and one level of subdirs
        for dirpath in [home] + sorted(p for p in home.iterdir() if p.is_dir() and not p.name.startswith('.')):
            for name in _CONTEXT_FILENAMES:
                p = dirpath / name
                if p.exists() and p.is_file():
                    found.append({
                        "path": str(p),
                        "name": name,
                        "dir": str(dirpath),
                        "rel": str(p.relative_to(home)),
                    })
        # Also check .hermes/ for HERMES.md
        for name in _CONTEXT_FILENAMES:
            p = _HERMES_HOME / name
            if p.exists() and p.is_file() and not any(f["path"] == str(p) for f in found):
                found.append({
                    "path": str(p),
                    "name": name,
                    "dir": str(_HERMES_HOME),
                    "rel": str(p.relative_to(home)),
                })
        return found

    @app.get("/api/context/file")
    async def api_context_file(path: str):
        """Read a workspace context file by absolute path."""
        p = Path(path)
        # Security: only allow known context filenames under home
        if p.name not in _CONTEXT_FILENAMES or not str(p).startswith(str(Path.home())):
            return {"error": "not allowed"}
        if not p.exists():
            return {"path": str(p), "content": "", "exists": False}
        return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}

    @app.put("/api/context/file")
    async def api_context_file_put(path: str, body: ContextBody):
        """Write a workspace context file by absolute path."""
        p = Path(path)
        if p.name not in _CONTEXT_FILENAMES or not str(p).startswith(str(Path.home())):
            return {"error": "not allowed"}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.content)
        return {"ok": True, "bytes": len(body.content.encode())}

    @app.post("/api/context/workspace/create")
    async def api_context_workspace_create(body: dict):
        """Create a new workspace context file."""
        name = body.get("name", "")
        directory = body.get("dir", str(Path.home()))
        if name not in _CONTEXT_FILENAMES:
            return {"error": f"invalid filename, must be one of: {_CONTEXT_FILENAMES}"}
        p = Path(directory) / name
        if not str(p).startswith(str(Path.home())):
            return {"error": "not allowed"}
        if p.exists():
            return {"error": "file already exists"}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("")
        return {"ok": True, "path": str(p)}

    @app.get("/api/context/memories")
    async def api_context_memories():
        mem_dir = _HERMES_HOME / "memories"
        files = {}
        # Always include the canonical memory files first.
        for name in ("MEMORY.md", "USER.md"):
            p = mem_dir / name
            files[name] = {
                "path": str(p),
                "content": p.read_text(errors="replace") if p.exists() else "",
                "exists": p.exists(),
            }
        # Include any additional markdown files in ~/.hermes/memories.
        if mem_dir.exists():
            for p in sorted(mem_dir.glob("*.md")):
                if p.name in files:
                    continue
                files[p.name] = {
                    "path": str(p),
                    "content": p.read_text(errors="replace"),
                    "exists": True,
                }
        return files

    @app.post("/api/context/memories/create")
    async def api_context_memory_create(body: dict):
        name = str(body.get("name", "")).strip()
        if not name:
            return {"error": "missing filename"}
        if Path(name).name != name or "/" in name or "\\" in name:
            return {"error": "filename must not include directories"}
        if not name.endswith(".md"):
            return {"error": "filename must end with .md"}
        p = _HERMES_HOME / "memories" / name
        if p.exists():
            return {"error": "file already exists"}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("")
        return {"ok": True, "path": str(p)}

    @app.put("/api/context/memories/{filename}")
    async def api_context_memory_put(filename: str, body: ContextBody):
        if Path(filename).name != filename or "/" in filename or "\\" in filename:
            return {"error": "invalid filename"}
        if not filename.endswith(".md"):
            return {"error": "invalid filename"}
        p = _HERMES_HOME / "memories" / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body.content)
        return {"ok": True, "bytes": len(body.content.encode())}

    @app.get("/api/context/config")
    async def api_context_config():
        p = _HERMES_HOME / "config.yaml"
        if not p.exists():
            return {"path": str(p), "content": "", "exists": False}
        return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}

    @app.put("/api/context/config")
    async def api_context_config_put(body: ContextBody):
        # Validate YAML before saving
        try:
            yaml.safe_load(body.content)
        except yaml.YAMLError as e:
            return {"ok": False, "error": f"Invalid YAML: {e}"}
        p = _HERMES_HOME / "config.yaml"
        p.write_text(body.content)
        return {"ok": True, "bytes": len(body.content.encode())}

    @app.get("/api/context/skills")
    async def api_context_skills():
        return workflow_store.list_configured_skills(platform="cli")

    @app.get("/api/context/skills/{skill_name}/content")
    async def api_skill_content(skill_name: str):
        result = workflow_store.get_skill_content(skill_name)
        if result is None:
            return {"ok": False, "error": "skill not found"}
        return result

    class SkillToggleBody(BaseModel):
        disabled: bool

    @app.post("/api/context/skills/{skill_name}/toggle")
    async def api_skill_toggle(skill_name: str, body: SkillToggleBody):
        try:
            return workflow_store.toggle_skill_disabled(skill_name, body.disabled)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Cron ─────────────────────────────────────────────────────────────

    @app.get("/api/context/cron")
    async def api_cron_list():
        try:
            return cron_store.list_jobs()
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.get("/api/context/cron/{job_id}")
    async def api_cron_get(job_id: str):
        job = cron_store.get_job(job_id)
        if job is None:
            return {"ok": False, "error": "job not found"}
        return job

    class CronJobBody(BaseModel):
        name: str | None = None
        prompt: str | None = None
        skills: list[str] | None = None
        skill: str | None = None
        model: str | None = None
        provider: str | None = None
        base_url: str | None = None
        api_key_env: str | None = None
        schedule: dict | None = None
        schedule_display: str | None = None
        enabled: bool | None = None
        deliver: str | None = None
        origin: dict | None = None
        repeat: dict | None = None

    @app.post("/api/context/cron")
    async def api_cron_create(body: CronJobBody):
        try:
            job = cron_store.create_job(body.model_dump(exclude_none=True))
            return {"ok": True, "job": job}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.put("/api/context/cron/{job_id}")
    async def api_cron_update(job_id: str, body: CronJobBody):
        try:
            job = cron_store.update_job(job_id, body.model_dump(exclude_none=True))
            if job is None:
                return {"ok": False, "error": "job not found"}
            return {"ok": True, "job": job}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.delete("/api/context/cron/{job_id}")
    async def api_cron_delete(job_id: str):
        try:
            ok = cron_store.delete_job(job_id)
            if not ok:
                return {"ok": False, "error": "job not found"}
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    class CronToggleBody(BaseModel):
        enabled: bool

    @app.post("/api/context/cron/{job_id}/toggle")
    async def api_cron_toggle(job_id: str, body: CronToggleBody):
        try:
            job = cron_store.toggle_job(job_id, body.enabled)
            if job is None:
                return {"ok": False, "error": "job not found"}
            return {"ok": True, "job": job}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Honcho ──────────────────────────────────────────────────────────────

    @app.get("/api/honcho/status")
    async def api_honcho_status():
        return await _call_blocking_with_timeout(
            honcho_reader.get_honcho_status,
            timeout_sec=4.0,
            fallback={"configured": False, "enabled": False, "error": "honcho unavailable"},
        )

    @app.get("/api/honcho/config")
    async def api_honcho_config():
        return await _call_blocking_with_timeout(
            honcho_reader.get_honcho_config,
            timeout_sec=4.0,
            fallback={"path": str(Path.home() / ".honcho" / "config.json"), "content": "", "exists": False, "error": "honcho unavailable"},
        )

    @app.put("/api/honcho/config")
    async def api_honcho_config_put(body: ContextBody):
        return honcho_reader.update_honcho_config(body.content)

    @app.get("/api/honcho/sessions")
    async def api_honcho_sessions():
        return await _call_blocking_with_timeout(
            honcho_reader.list_honcho_sessions,
            timeout_sec=7.0,
            fallback=[],
        )

    @app.get("/api/honcho/peers")
    async def api_honcho_peers():
        return await _call_blocking_with_timeout(
            honcho_reader.list_honcho_peers,
            timeout_sec=7.0,
            fallback=[],
        )

    @app.get("/api/honcho/peers/{peer_id}")
    async def api_honcho_peer(peer_id: str):
        return await _call_blocking_with_timeout(
            honcho_reader.get_peer_representation,
            peer_id,
            timeout_sec=6.0,
            fallback={"error": "honcho unavailable"},
        )

    @app.get("/api/honcho/sessions/{session_id}/context")
    async def api_honcho_session_context(session_id: str):
        return await _call_blocking_with_timeout(
            honcho_reader.get_honcho_session_context,
            session_id,
            timeout_sec=7.0,
            fallback={"error": "honcho unavailable"},
        )

    # ── Events ─────────────────────────────────────────────────────────────

    @app.get("/api/events/history")
    async def api_events_history():
        return bus.get_history()

    @app.get("/api/events/active-tools")
    async def api_active_tools():
        # Primary source: in-process hook stream.
        # Fallback source: state.db inference (works on stock Hermes without core patches).
        active = bus.get_active_tools()
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

    @app.get("/api/events/active-llm")
    async def api_active_llm(window_sec: int = 180):
        sessions = state_reader.get_likely_thinking_sessions(window_sec=window_sec, limit=300)
        return {
            "sessions": sessions,
            "window_sec": max(20, min(1200, window_sec)),
            "source": "inferred_db",
        }

    # ── SSE ───────────────────────────────────────────────────────────────────

    @app.get("/api/events")
    async def api_events(request: Request):
        async def gen():
            # Send a keepalive comment immediately so the client knows it's connected
            yield ": connected\n\n"
            # Use a timeout on queue.get so we can send periodic keepalives
            # and check for disconnects. Without this, proxies (nginx default 60s)
            # or browsers silently drop idle SSE connections.
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
                        # Send SSE comment as keepalive (invisible to EventSource API)
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

    # ── WebSocket terminal ────────────────────────────────────────────────────

    @app.websocket("/api/terminal")
    async def api_terminal(websocket: WebSocket):
        await websocket.accept()
        master_fd, slave_fd = pty.openpty()
        proc = await asyncio.create_subprocess_exec(
            os.environ.get("SHELL", "/bin/bash"),
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env={**os.environ, "TERM": "xterm-256color"},
            close_fds=True,
        )
        os.close(slave_fd)

        # Set master_fd to non-blocking for async reads
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        loop = asyncio.get_event_loop()
        read_event = asyncio.Event()

        def _on_readable():
            read_event.set()

        loop.add_reader(master_fd, _on_readable)

        async def pty_to_ws():
            try:
                while True:
                    read_event.clear()
                    try:
                        data = os.read(master_fd, 16384)
                        if not data:
                            break
                        await websocket.send_bytes(data)
                    except BlockingIOError:
                        await read_event.wait()
                    except OSError:
                        break
            except Exception:
                pass

        async def ws_to_pty():
            try:
                while True:
                    msg = await websocket.receive()
                    msg_type = msg.get("type")
                    if msg_type == "websocket.disconnect":
                        break
                    if msg_type == "websocket.receive":
                        raw = msg.get("bytes")
                        if raw:
                            os.write(master_fd, raw)
                        text = msg.get("text")
                        if text:
                            try:
                                d = json.loads(text)
                                if d.get("type") == "resize":
                                    fcntl.ioctl(
                                        master_fd, termios.TIOCSWINSZ,
                                        struct.pack("HHHH", d["rows"], d["cols"], 0, 0),
                                    )
                                    continue
                            except (json.JSONDecodeError, ValueError):
                                pass
                            os.write(master_fd, text.encode("utf-8"))
            except (WebSocketDisconnect, Exception):
                pass

        task_read = asyncio.create_task(pty_to_ws())
        task_write = asyncio.create_task(ws_to_pty())
        try:
            await asyncio.wait([task_read, task_write], return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in [task_read, task_write]:
                t.cancel()
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass

    # ── SPA static files ──────────────────────────────────────────────────────

    assets_dir = _UI_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def spa_root():
        index = _UI_DIST / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"status": "UI not built — run install.sh"}

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        candidate = _UI_DIST / path
        if candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        index = _UI_DIST / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"status": "UI not built — run install.sh"}

    return app
