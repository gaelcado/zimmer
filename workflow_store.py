"""Workflow storage and configured skills discovery for Zimmer."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml


_WORKFLOW_ID_RE = re.compile(r"^wf_[a-z0-9_-]{4,64}$")
_PLATFORM_MAP = {
    "macos": "darwin",
    "linux": "linux",
    "windows": "win32",
}
_EXCLUDED_SKILL_DIRS = frozenset((".git", ".github", ".hub"))
_SKILL_TABLE_ROW_RE = re.compile(r"^\s*│\s*(.*?)\s*│\s*(.*?)\s*│\s*(.*?)\s*│\s*(.*?)\s*│\s*$")


def _hermes_home() -> Path:
    return Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))


def _workflows_dir() -> Path:
    return _hermes_home() / "workflows"


def _workflow_runs_dir() -> Path:
    return _workflows_dir() / "runs"


def _workflow_path(workflow_id: str) -> Path:
    return _workflows_dir() / f"{workflow_id}.yaml"


def _is_valid_workflow_id(workflow_id: str) -> bool:
    return bool(_WORKFLOW_ID_RE.match(workflow_id or ""))


def _now() -> float:
    return time.time()


def _default_definition(name: str, description: str = "") -> dict[str, Any]:
    ts = _now()
    return {
        "id": f"wf_{uuid4().hex[:10]}",
        "name": name,
        "description": description,
        "version": 1,
        "created_at": ts,
        "updated_at": ts,
        "graph": {
            "nodes": [],
            "edges": [],
        },
        "defaults": {
            "model": "",
            "provider": "",
            "timeout_sec": 180,
            "max_turns": 30,
        },
        "metadata": {
            "tags": [],
        },
    }


def _sanitize_definition(data: dict[str, Any]) -> dict[str, Any]:
    base = _default_definition(
        name=str(data.get("name") or "Untitled Workflow").strip()[:120] or "Untitled Workflow",
        description=str(data.get("description") or "").strip()[:800],
    )

    workflow_id = str(data.get("id") or base["id"]).strip()
    if _is_valid_workflow_id(workflow_id):
        base["id"] = workflow_id

    if isinstance(data.get("version"), int) and data["version"] > 0:
        base["version"] = data["version"]

    created_at = data.get("created_at")
    if isinstance(created_at, (int, float)) and created_at > 0:
        base["created_at"] = float(created_at)

    graph = data.get("graph")
    if isinstance(graph, dict):
        nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
        edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
        base["graph"] = {
            "nodes": nodes,
            "edges": edges,
        }

    defaults = data.get("defaults")
    if isinstance(defaults, dict):
        base_defaults = base["defaults"]
        for key in ("model", "provider"):
            if key in defaults:
                base_defaults[key] = str(defaults.get(key) or "")[:120]
        for key in ("timeout_sec", "max_turns"):
            value = defaults.get(key)
            if isinstance(value, int) and value > 0:
                base_defaults[key] = value

    metadata = data.get("metadata")
    if isinstance(metadata, dict):
        tags = metadata.get("tags")
        if isinstance(tags, list):
            base["metadata"] = {
                "tags": [str(t).strip()[:48] for t in tags if str(t).strip()][:20]
            }

    updated_at = data.get("updated_at")
    if isinstance(updated_at, (int, float)) and updated_at > 0:
        base["updated_at"] = float(updated_at)
    else:
        base["updated_at"] = _now()
    return base


def list_workflows() -> list[dict[str, Any]]:
    root = _workflows_dir()
    if not root.exists():
        return []

    items: list[dict[str, Any]] = []
    for p in sorted(root.glob("wf_*.yaml")):
        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
            if not isinstance(raw, dict):
                continue
            wf = _sanitize_definition(raw)
            items.append({
                "id": wf["id"],
                "name": wf["name"],
                "description": wf.get("description", ""),
                "updated_at": wf.get("updated_at"),
                "node_count": len(wf.get("graph", {}).get("nodes", [])),
                "edge_count": len(wf.get("graph", {}).get("edges", [])),
                "path": str(p),
            })
        except Exception:
            continue

    items.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
    return items


def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    if not _is_valid_workflow_id(workflow_id):
        return None
    p = _workflow_path(workflow_id)
    if not p.exists():
        return None
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    wf = _sanitize_definition(raw)
    if wf["id"] != workflow_id:
        wf["id"] = workflow_id
    return wf


def create_workflow(name: str, description: str = "") -> dict[str, Any]:
    wf = _default_definition(name=(name or "New Workflow").strip()[:120] or "New Workflow", description=description)
    root = _workflows_dir()
    root.mkdir(parents=True, exist_ok=True)
    p = _workflow_path(wf["id"])
    p.write_text(yaml.safe_dump(wf, sort_keys=False), encoding="utf-8")
    return wf


def update_workflow(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not _is_valid_workflow_id(workflow_id):
        return None
    existing = get_workflow(workflow_id)
    if not existing:
        return None

    merged = {
        **existing,
        **{k: v for k, v in payload.items() if k in {"name", "description", "graph", "defaults", "metadata", "version"}},
        "id": workflow_id,
        "created_at": existing.get("created_at", _now()),
        "updated_at": _now(),
    }
    wf = _sanitize_definition(merged)
    wf["id"] = workflow_id
    wf["created_at"] = existing.get("created_at", wf["created_at"])

    p = _workflow_path(workflow_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(wf, sort_keys=False), encoding="utf-8")
    return wf


def import_workflow_definition(data: dict[str, Any], overwrite: bool = False) -> dict[str, Any]:
    """Import a workflow definition from parsed data.

    If overwrite=False and ID exists, allocate a new ID.
    """
    wf = _sanitize_definition(data if isinstance(data, dict) else {})
    root = _workflows_dir()
    root.mkdir(parents=True, exist_ok=True)

    target_id = wf["id"]
    target_path = _workflow_path(target_id)
    if target_path.exists() and not overwrite:
        wf["id"] = f"wf_{uuid4().hex[:10]}"
        wf["created_at"] = _now()
        wf["updated_at"] = wf["created_at"]
        target_path = _workflow_path(wf["id"])

    target_path.write_text(yaml.safe_dump(wf, sort_keys=False), encoding="utf-8")
    return wf


def export_workflow_yaml(workflow_id: str) -> str | None:
    wf = get_workflow(workflow_id)
    if wf is None:
        return None
    return yaml.safe_dump(wf, sort_keys=False)


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.DOTALL)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}
    return meta, text[m.end():]


def _skill_matches_platform(frontmatter: dict[str, Any]) -> bool:
    platforms = frontmatter.get("platforms")
    if not platforms:
        return True
    if not isinstance(platforms, list):
        platforms = [platforms]
    current = sys.platform
    for p in platforms:
        mapped = _PLATFORM_MAP.get(str(p).lower().strip(), str(p).lower().strip())
        if current.startswith(mapped):
            return True
    return False


def _load_config() -> dict[str, Any]:
    p = _hermes_home() / "config.yaml"
    if not p.exists():
        return {}
    try:
        cfg = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        return cfg if isinstance(cfg, dict) else {}
    except Exception:
        return {}


def _get_disabled_skill_names(config: dict[str, Any], platform: str = "cli") -> set[str]:
    skills_cfg = config.get("skills", {}) if isinstance(config.get("skills"), dict) else {}
    global_disabled = set(skills_cfg.get("disabled", []) or [])
    platform_map = skills_cfg.get("platform_disabled", {})
    platform_disabled = None
    if isinstance(platform_map, dict):
        platform_disabled = platform_map.get(platform)
    if platform_disabled is None:
        return {str(name) for name in global_disabled}
    return {str(name) for name in (platform_disabled or [])}


def _list_skills_from_hermes_cli() -> list[dict[str, Any]]:
    """Read installed skills from `hermes skills list` (same source as `/skills`)."""
    try:
        proc = subprocess.run(
            ["hermes", "skills", "list", "--source", "all"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
            env=os.environ.copy(),
        )
    except Exception:
        return []

    if proc.returncode != 0 or not proc.stdout:
        return []

    result: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        m = _SKILL_TABLE_ROW_RE.match(line)
        if not m:
            continue
        name, category, source, trust = (part.strip() for part in m.groups())
        if not name or name.lower() == "name":
            continue

        # CLI output can list the same skill name in multiple categories.
        # Keep all rows, but ensure option keys can remain stable/unique.
        synthetic_path = f"cli://{source}/{category}/{name}"
        result.append({
            "name": name,
            "description": "",
            "category": category or "uncategorized",
            "source": source,
            "trust": trust,
            "version": "",
            "author": "",
            "path": synthetic_path,
            "skill_md_path": "",
            "platform": "cli",
        })
    return result


def list_configured_skills(platform: str = "cli") -> list[dict[str, Any]]:
    cfg = _load_config()
    disabled = _get_disabled_skill_names(cfg, platform=platform)

    # Prefer CLI list so we mirror Hermes `/skills` semantics (builtin/local/hub).
    from_cli = _list_skills_from_hermes_cli()
    if from_cli:
        rows = []
        for row in from_cli:
            if row.get("name") in disabled:
                continue
            cloned = dict(row)
            cloned["platform"] = platform
            rows.append(cloned)
        rows.sort(key=lambda s: (s.get("category", ""), s.get("name", "")))
        return rows

    # Fallback: local scan for environments where CLI is unavailable.
    skills_dir = _hermes_home() / "skills"
    if not skills_dir.exists():
        return []

    result: list[dict[str, Any]] = []
    for skill_md in sorted(skills_dir.rglob("SKILL.md")):
        if any(part in _EXCLUDED_SKILL_DIRS for part in skill_md.parts):
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        meta, body = _parse_frontmatter(text)
        if not _skill_matches_platform(meta):
            continue

        name = str(meta.get("name") or skill_md.parent.name).strip()
        if not name or name in disabled:
            continue

        description = str(meta.get("description") or "").strip()
        if not description:
            for line in body.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    description = line[:140]
                    break

        rel = skill_md.relative_to(skills_dir)
        category = str(rel.parent.parent) if len(rel.parts) > 2 else str(rel.parent)
        result.append({
            "name": name,
            "description": description,
            "category": category if category != "." else "uncategorized",
            "version": str(meta.get("version") or ""),
            "author": str(meta.get("author") or ""),
            "path": str(skill_md.parent),
            "skill_md_path": str(skill_md),
            "platform": platform,
        })

    result.sort(key=lambda s: (s.get("category", ""), s.get("name", "")))
    return result


def create_run_record(workflow_id: str, workflow_name: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    run_id = f"run_{uuid4().hex[:12]}"
    now = _now()
    record = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "workflow_name": workflow_name,
        "status": "running",
        "started_at": now,
        "updated_at": now,
        "ended_at": None,
        "error": "",
        "payload": payload or {},
        "steps": [],
        "final_output": "",
    }
    runs_dir = _workflow_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    p = runs_dir / f"{run_id}.json"
    p.write_text(yaml.safe_dump(record, sort_keys=False), encoding="utf-8")
    return record


def save_run_record(record: dict[str, Any]) -> None:
    run_id = str(record.get("run_id") or "").strip()
    if not run_id.startswith("run_"):
        return
    runs_dir = _workflow_runs_dir()
    runs_dir.mkdir(parents=True, exist_ok=True)
    p = runs_dir / f"{run_id}.json"
    record["updated_at"] = _now()
    p.write_text(yaml.safe_dump(record, sort_keys=False), encoding="utf-8")


def get_run_record(run_id: str) -> dict[str, Any] | None:
    if not run_id.startswith("run_"):
        return None
    p = _workflow_runs_dir() / f"{run_id}.json"
    if not p.exists():
        return None
    try:
        raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    return raw


def list_run_records(workflow_id: str | None = None, limit: int = 40) -> list[dict[str, Any]]:
    runs_dir = _workflow_runs_dir()
    if not runs_dir.exists():
        return []
    rows: list[dict[str, Any]] = []
    for p in sorted(runs_dir.glob("run_*.json")):
        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        if workflow_id and raw.get("workflow_id") != workflow_id:
            continue
        rows.append({
            "run_id": raw.get("run_id"),
            "workflow_id": raw.get("workflow_id"),
            "workflow_name": raw.get("workflow_name"),
            "status": raw.get("status"),
            "started_at": raw.get("started_at"),
            "ended_at": raw.get("ended_at"),
            "error": raw.get("error", ""),
            "step_count": len(raw.get("steps") or []),
        })
    rows.sort(key=lambda r: r.get("started_at") or 0, reverse=True)
    return rows[: max(1, min(200, limit))]


def reconcile_running_runs(reason: str = "interrupted (server restart)") -> int:
    """Mark stale running runs as interrupted.

    Returns number of records changed.
    """
    runs_dir = _workflow_runs_dir()
    if not runs_dir.exists():
        return 0
    changed = 0
    now = _now()
    for p in runs_dir.glob("run_*.json"):
        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        if raw.get("status") != "running":
            continue
        raw["status"] = "error"
        raw["ended_at"] = now
        raw["updated_at"] = now
        raw["error"] = str(reason)
        events = raw.get("events")
        if not isinstance(events, list):
            events = []
        events.append({
            "ts": now,
            "level": "warn",
            "message": str(reason),
        })
        raw["events"] = events[-500:]
        try:
            p.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
            changed += 1
        except Exception:
            continue
    return changed


def cleanup_run_records(
    max_age_days: float = 14.0,
    keep_per_workflow: int = 200,
    dry_run: bool = False,
) -> dict[str, Any]:
    runs_dir = _workflow_runs_dir()
    if not runs_dir.exists():
        return {"deleted": 0, "candidates": 0, "dry_run": dry_run}

    now = _now()
    age_sec = max(0.0, float(max_age_days)) * 86400.0
    keep_per_workflow = max(1, int(keep_per_workflow))

    by_workflow: dict[str, list[tuple[Path, dict[str, Any]]]] = defaultdict(list)
    for p in runs_dir.glob("run_*.json"):
        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        wf = str(raw.get("workflow_id") or "_unknown")
        by_workflow[wf].append((p, raw))

    to_delete: list[Path] = []
    for _, rows in by_workflow.items():
        rows.sort(key=lambda pr: pr[1].get("started_at") or 0, reverse=True)
        survivors = rows[:keep_per_workflow]
        overflow = rows[keep_per_workflow:]
        threshold = now - age_sec
        for p, rec in overflow:
            started = rec.get("started_at") or 0
            if age_sec <= 0 or started < threshold:
                to_delete.append(p)
        # Also age-based cleanup for old failed/interrupted runs among survivors.
        for p, rec in survivors:
            started = rec.get("started_at") or 0
            status = str(rec.get("status") or "")
            if age_sec > 0 and started < threshold and status in {"error", "canceled"}:
                to_delete.append(p)

    uniq = list(dict.fromkeys(to_delete))
    deleted = 0
    if not dry_run:
        for p in uniq:
            try:
                p.unlink(missing_ok=True)
                deleted += 1
            except Exception:
                continue
    return {
        "deleted": deleted,
        "candidates": len(uniq),
        "dry_run": dry_run,
        "max_age_days": max_age_days,
        "keep_per_workflow": keep_per_workflow,
    }


def run_metrics(workflow_id: str | None = None, window_sec: int = 86400) -> dict[str, Any]:
    rows = list_run_records(workflow_id=workflow_id, limit=5000)
    now = _now()
    window_sec = max(60, int(window_sec))
    cutoff = now - window_sec
    filtered = [r for r in rows if (r.get("started_at") or 0) >= cutoff]

    status_counts: dict[str, int] = defaultdict(int)
    durations: list[float] = []
    for r in filtered:
        status = str(r.get("status") or "unknown")
        status_counts[status] += 1
        st = r.get("started_at") or 0
        en = r.get("ended_at")
        if st and en and en >= st:
            durations.append(float(en - st))

    avg_duration = (sum(durations) / len(durations)) if durations else 0.0
    success = status_counts.get("ok", 0)
    total_done = sum(status_counts.get(s, 0) for s in ("ok", "error", "canceled"))
    success_rate = (success / total_done) if total_done else 0.0

    return {
        "workflow_id": workflow_id or "",
        "window_sec": window_sec,
        "count": len(filtered),
        "status_counts": dict(status_counts),
        "avg_duration_sec": avg_duration,
        "success_rate": success_rate,
    }
