"""Read/write access to ~/.hermes/cron/jobs.json.

Delegates to hermes.cron.jobs (atomic temp-file writes) when available so that
Zimmer and the Hermes scheduler share one consistent write path.  Falls back to
fcntl-locked direct writes for older / standalone environments.
"""

import fcntl
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

# ── Try to delegate I/O to Hermes core cron module ────────────────────────────
_hermes_src = os.path.join(os.path.dirname(__file__), "..", "..", "hermes-agent")
if _hermes_src not in sys.path:
    sys.path.insert(0, _hermes_src)

try:
    from cron.jobs import load_jobs as _h_load_jobs, save_jobs as _h_save_jobs
    _HERMES_CRON = True
    logger.debug("cron_store: delegating I/O to hermes cron.jobs")
except ImportError:
    _HERMES_CRON = False
    logger.debug("cron_store: hermes cron.jobs unavailable, using fcntl fallback")


def _hermes_home() -> Path:
    return Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))


def _cron_jobs_path() -> Path:
    return _hermes_home() / "cron" / "jobs.json"


def _read_jobs_locked() -> dict:
    if _HERMES_CRON:
        try:
            return {"jobs": _h_load_jobs()}
        except Exception:
            pass
    # fcntl fallback
    p = _cron_jobs_path()
    if not p.exists():
        return {"jobs": []}
    with open(p, "r") as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        try:
            return json.load(f)
        except (json.JSONDecodeError, ValueError):
            return {"jobs": []}
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _write_jobs_locked(data: dict) -> None:
    if _HERMES_CRON:
        try:
            _h_save_jobs(data.get("jobs", []))
            return
        except Exception:
            pass
    # fcntl fallback
    p = _cron_jobs_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "r+" if p.exists() else "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.seek(0)
            f.truncate()
            json.dump(data, f, indent=2, default=str)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


_ALLOWED_FIELDS = {
    "name", "prompt", "skills", "skill", "model", "provider",
    "base_url", "api_key_env", "schedule", "schedule_display",
    "enabled", "deliver", "origin", "repeat",
}


def list_jobs() -> list[dict]:
    """Return all jobs with prompt truncated to a preview."""
    data = _read_jobs_locked()
    jobs = data.get("jobs") or []
    result = []
    for job in jobs:
        row = dict(job)
        prompt = row.get("prompt") or ""
        row["prompt_preview"] = prompt[:120] + ("…" if len(prompt) > 120 else "")
        row.pop("prompt", None)
        result.append(row)
    return result


def get_job(job_id: str) -> dict[str, Any] | None:
    """Return a single job with full prompt."""
    data = _read_jobs_locked()
    for job in data.get("jobs") or []:
        if job.get("id") == job_id:
            return dict(job)
    return None


def update_job(job_id: str, patch: dict) -> dict[str, Any] | None:
    """Update allowed fields on a job. Returns the updated job or None."""
    data = _read_jobs_locked()
    jobs = data.get("jobs") or []
    for i, job in enumerate(jobs):
        if job.get("id") != job_id:
            continue
        for key, val in patch.items():
            if key in _ALLOWED_FIELDS:
                job[key] = val
        jobs[i] = job
        data["jobs"] = jobs
        _write_jobs_locked(data)
        return dict(job)
    return None


def create_job(fields: dict) -> dict[str, Any]:
    """Create a new cron job with defaults. Returns the created job."""
    data = _read_jobs_locked()
    jobs = data.get("jobs") or []

    job: dict[str, Any] = {
        "id": uuid4().hex[:12],
        "name": fields.get("name") or "Untitled Job",
        "prompt": fields.get("prompt") or "",
        "skills": fields.get("skills") or [],
        "skill": fields.get("skill") or "",
        "model": fields.get("model") or "",
        "provider": fields.get("provider") or "",
        "base_url": fields.get("base_url") or "",
        "api_key_env": fields.get("api_key_env") or "",
        "schedule": fields.get("schedule") or {"kind": "cron", "expr": "", "display": ""},
        "schedule_display": fields.get("schedule_display") or "",
        "repeat": fields.get("repeat") or {"times": None, "completed": 0},
        "enabled": fields.get("enabled", True),
        "state": "scheduled",
        "paused_at": None,
        "paused_reason": None,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "next_run_at": None,
        "last_run_at": None,
        "last_status": None,
        "last_error": None,
        "deliver": fields.get("deliver") or "",
        "origin": fields.get("origin") or {},
    }

    jobs.append(job)
    data["jobs"] = jobs
    _write_jobs_locked(data)
    return job


def delete_job(job_id: str) -> bool:
    """Remove a job by ID. Returns True if found and removed."""
    data = _read_jobs_locked()
    jobs = data.get("jobs") or []
    before = len(jobs)
    jobs = [j for j in jobs if j.get("id") != job_id]
    if len(jobs) == before:
        return False
    data["jobs"] = jobs
    _write_jobs_locked(data)
    return True


def toggle_job(job_id: str, enabled: bool) -> dict[str, Any] | None:
    """Toggle a job's enabled/paused state. Returns the updated job or None."""
    now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    if enabled:
        patch = {"enabled": True, "state": "scheduled", "paused_at": None, "paused_reason": None}
    else:
        patch = {"enabled": False, "state": "paused", "paused_at": now, "paused_reason": "disabled via Zimmer"}
    # toggle_job uses direct write to also set state/paused fields (not in _ALLOWED_FIELDS)
    data = _read_jobs_locked()
    jobs = data.get("jobs") or []
    for i, job in enumerate(jobs):
        if job.get("id") != job_id:
            continue
        job.update(patch)
        jobs[i] = job
        data["jobs"] = jobs
        _write_jobs_locked(data)
        return dict(job)
    return None
