"""Workflow CRUD, execution, and run management endpoints."""

import asyncio
import time

import yaml
from fastapi import APIRouter, Request
from pydantic import BaseModel

from .. import workflow_store, workflow_engine
from ..event_bus import EventBus
from .._config import (
    WORKFLOW_RUN_RETENTION_DAYS,
    WORKFLOW_RUN_KEEP_PER_WORKFLOW,
    check_workflow_auth,
    safe_text,
    run_hermes_chat_text,
)

router = APIRouter()

# In-memory map of running asyncio tasks: run_id → Task.
# Populated by _execute(); cleared on completion/cancel.
_run_tasks: dict[str, asyncio.Task] = {}

# Set by create_app() so the execution engine can publish SSE events.
_bus: EventBus | None = None


def set_bus(bus: EventBus) -> None:
    global _bus
    _bus = bus


def _configured_skill_name_set(platform: str = "cli") -> set[str] | None:
    """Return the set of known skill names, or None if the list is unavailable.

    None tells validate_workflow to skip skill-availability checks entirely,
    which is the right behaviour when the hermes CLI cannot be reached (e.g.
    in test environments or sandboxed deployments).
    """
    rows = workflow_store.list_configured_skills(platform=platform)
    names = {str(r.get("name") or "").strip() for r in rows if str(r.get("name") or "").strip()}
    return names if names else None


# ── Pydantic models ───────────────────────────────────────────────────────────

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
    max_age_days: float = WORKFLOW_RUN_RETENTION_DAYS
    keep_per_workflow: int = WORKFLOW_RUN_KEEP_PER_WORKFLOW
    dry_run: bool = False


# ── List / auth ───────────────────────────────────────────────────────────────

@router.get("/api/workflows")
async def api_workflows():
    return workflow_store.list_workflows()


@router.get("/api/workflows/auth")
async def api_workflows_auth():
    import os
    return {"required": bool(os.getenv("ZIMMER_WORKFLOW_API_TOKEN", "").strip())}


# ── Runs (before /{workflow_id} to avoid shadowing) ───────────────────────────

@router.get("/api/workflows/runs")
async def api_workflow_runs(workflow_id: str | None = None, limit: int = 40):
    rows = workflow_store.list_run_records(workflow_id=workflow_id, limit=limit)
    return {"ok": True, "runs": rows}


@router.get("/api/workflows/runs/metrics")
async def api_workflow_runs_metrics(workflow_id: str | None = None, window_sec: int = 86400):
    return {
        "ok": True,
        "metrics": workflow_store.run_metrics(workflow_id=workflow_id, window_sec=window_sec),
    }


@router.post("/api/workflows/runs/cleanup")
async def api_workflow_runs_cleanup(body: WorkflowRunCleanupBody, request: Request):
    auth_err = check_workflow_auth(request)
    if auth_err:
        return auth_err
    result = workflow_store.cleanup_run_records(
        max_age_days=body.max_age_days,
        keep_per_workflow=body.keep_per_workflow,
        dry_run=body.dry_run,
    )
    return {"ok": True, **result}


@router.get("/api/workflows/runs/{run_id}")
async def api_workflow_run_get(run_id: str):
    run = workflow_store.get_run_record(run_id)
    if run is None:
        return {"ok": False, "error": "not_found"}
    return {"ok": True, "run": run}


@router.post("/api/workflows/runs/{run_id}/cancel")
async def api_workflow_run_cancel(run_id: str, request: Request):
    auth_err = check_workflow_auth(request)
    if auth_err:
        return auth_err
    task = _run_tasks.get(run_id)
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


# ── Skills ────────────────────────────────────────────────────────────────────

@router.get("/api/workflows/skills")
async def api_workflows_skills(platform: str = "cli"):
    skills = workflow_store.list_configured_skills(platform=platform)
    return {"platform": platform, "count": len(skills), "skills": skills}


# ── Per-workflow ───────────────────────────────────────────────────────────────

@router.post("/api/workflows")
async def api_workflows_create(body: WorkflowCreateBody, request: Request):
    auth_err = check_workflow_auth(request)
    if auth_err:
        return auth_err
    wf = workflow_store.create_workflow(body.name, body.description)
    return {"ok": True, "workflow": wf}


@router.post("/api/workflows/import")
async def api_workflows_import(body: WorkflowImportBody, request: Request):
    auth_err = check_workflow_auth(request)
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


@router.get("/api/workflows/{workflow_id}")
async def api_workflow_get(workflow_id: str):
    wf = workflow_store.get_workflow(workflow_id)
    if wf is None:
        return {"ok": False, "error": "not_found"}
    return {"ok": True, "workflow": wf}


@router.get("/api/workflows/{workflow_id}/export")
async def api_workflow_export(workflow_id: str, request: Request):
    auth_err = check_workflow_auth(request)
    if auth_err:
        return auth_err
    text = workflow_store.export_workflow_yaml(workflow_id)
    if text is None:
        return {"ok": False, "error": "not_found"}
    return {"ok": True, "workflow_id": workflow_id, "content": text}


@router.get("/api/workflows/{workflow_id}/validate")
async def api_workflow_validate(workflow_id: str):
    wf = workflow_store.get_workflow(workflow_id)
    if wf is None:
        return {"ok": False, "error": "not_found"}
    try:
        graph = workflow_engine.validate_workflow(
            wf, configured_skill_names=_configured_skill_name_set("cli")
        )
        return {"ok": True, "issues": [], "order": graph["order"], "edge_count": len(graph["edges"])}
    except workflow_engine.WorkflowValidationError as e:
        return {"ok": False, "error": "invalid_workflow", "issues": e.issues}


@router.put("/api/workflows/{workflow_id}")
async def api_workflow_update(workflow_id: str, body: WorkflowUpdateBody, request: Request):
    auth_err = check_workflow_auth(request)
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


@router.post("/api/workflows/{workflow_id}/run")
async def api_workflow_run(workflow_id: str, body: WorkflowRunBody, request: Request):
    auth_err = check_workflow_auth(request)
    if auth_err:
        return auth_err
    wf = workflow_store.get_workflow(workflow_id)
    if wf is None:
        return {"ok": False, "error": "not_found"}

    try:
        graph = workflow_engine.validate_workflow(
            wf, configured_skill_names=_configured_skill_name_set("cli")
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

    def _publish(event_type: str, **kwargs):
        if _bus is not None:
            _bus.publish({
                "type": event_type,
                "run_id": run["run_id"],
                "workflow_id": workflow_id,
                **kwargs,
            })

    def log_event(level: str, message: str, node_id: str = "", attempt: int | None = None):
        event = {"ts": time.time(), "level": level, "message": safe_text(message, 500)}
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

            _publish("workflow_start", workflow_name=wf.get("name") or workflow_id)

            for idx, node_id in enumerate(order):
                if idx >= max_steps:
                    run["status"] = "error"
                    run["ended_at"] = time.time()
                    run["error"] = f"max_steps exceeded ({max_steps})"
                    workflow_store.save_run_record(run)
                    _publish("workflow_error", error=run["error"])
                    return

                node = node_map[node_id]
                node_type = str(node.get("type") or "prompt")
                node_input = workflow_engine.render_node_input(
                    initial_input, predecessors.get(node_id, []), node_outputs
                )
                node_retries = max(0, min(6, int(node.get("retries", default_retries) or 0)))
                step_timeout = max(10, min(600, int(node.get("timeout_sec", timeout_sec) or timeout_sec)))
                step = {
                    "index": idx,
                    "node_id": node_id,
                    "node_type": node_type,
                    "status": "running",
                    "started_at": time.time(),
                    "ended_at": None,
                    "input_preview": safe_text(node_input, 280),
                    "output_preview": "",
                    "error": "",
                    "attempts": 0,
                }
                run["steps"].append(step)
                log_event("info", f"node start ({node_type})", node_id=node_id)
                workflow_store.save_run_record(run)
                _publish("workflow_step_start", node_id=node_id, node_type=node_type, step_index=idx)

                if body.dry_run:
                    rendered = (
                        f"[dry-run] {node_type}:{node_id} executed with "
                        f"{len(predecessors.get(node_id, []))} upstream inputs."
                    )
                    step["status"] = "ok"
                    step["ended_at"] = time.time()
                    step["output_preview"] = safe_text(rendered, 280)
                    node_outputs[node_id] = rendered
                    step["attempts"] = 1
                    log_event("info", "node dry-run complete", node_id=node_id, attempt=1)
                    workflow_store.save_run_record(run)
                    _publish("workflow_step_done", node_id=node_id, step_index=idx, status="ok")
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

                    result = await run_hermes_chat_text(
                        prompt=prompt,
                        model=body.model or wf.get("defaults", {}).get("model") or None,
                        provider=body.provider or wf.get("defaults", {}).get("provider") or None,
                        timeout_sec=step_timeout,
                    )

                    if result.get("ok"):
                        output = str(result.get("output") or "")
                        if len(output) > max_output_chars:
                            output = output[:max_output_chars]
                            log_event(
                                "warn",
                                f"node output truncated to {max_output_chars} chars",
                                node_id=node_id,
                                attempt=attempt,
                            )
                        step["status"] = "ok"
                        step["ended_at"] = time.time()
                        step["output_preview"] = safe_text(output, 280)
                        node_outputs[node_id] = output
                        log_event("info", "node succeeded", node_id=node_id, attempt=attempt)
                        workflow_store.save_run_record(run)
                        _publish("workflow_step_done", node_id=node_id, step_index=idx, status="ok")
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
                    log_event(
                        "error",
                        f"node terminal failure: {run['error']}",
                        node_id=node_id,
                        attempt=step["attempts"],
                    )
                    workflow_store.save_run_record(run)
                    _publish(
                        "workflow_step_done",
                        node_id=node_id,
                        step_index=idx,
                        status="error",
                        error=step["error"],
                    )
                    _publish("workflow_error", error=run["error"])
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
            _publish("workflow_complete", step_count=len(order))

        except asyncio.CancelledError:
            run["status"] = "canceled"
            run["ended_at"] = time.time()
            run["error"] = "canceled by user"
            log_event("warn", "run canceled")
            workflow_store.save_run_record(run)
            _publish("workflow_error", error="canceled by user")
        except Exception as e:
            run["status"] = "error"
            run["ended_at"] = time.time()
            run["error"] = safe_text(str(e), 500)
            log_event("error", run["error"])
            workflow_store.save_run_record(run)
            _publish("workflow_error", error=run["error"])
        finally:
            _run_tasks.pop(run["run_id"], None)

    task = asyncio.create_task(_execute())
    _run_tasks[run["run_id"]] = task
    return {"ok": True, "run_id": run["run_id"]}
