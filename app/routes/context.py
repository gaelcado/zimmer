"""Context file editors: SOUL.md, workspace files, memories, config, skills, cron."""

from pathlib import Path

import yaml
from fastapi import APIRouter
from pydantic import BaseModel

from .. import workflow_store, cron_store
from .._config import HERMES_HOME

router = APIRouter()

_CONTEXT_FILENAMES = [
    "AGENTS.md", ".hermes.md", "HERMES.md", "CLAUDE.md",
    ".cursorrules",
]


class ContextBody(BaseModel):
    content: str


# ── SOUL.md ───────────────────────────────────────────────────────────────────

@router.get("/api/context/soul")
async def api_context_soul():
    p = HERMES_HOME / "SOUL.md"
    if not p.exists():
        return {"path": str(p), "content": "", "exists": False}
    return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}


@router.put("/api/context/soul")
async def api_context_soul_put(body: ContextBody):
    p = HERMES_HOME / "SOUL.md"
    p.write_text(body.content)
    return {"ok": True, "bytes": len(body.content.encode())}


# ── Workspace context files ───────────────────────────────────────────────────

@router.get("/api/context/workspace")
async def api_context_workspace():
    home = Path.home()
    found = []
    for dirpath in [home] + sorted(p for p in home.iterdir() if p.is_dir() and not p.name.startswith(".")):
        for name in _CONTEXT_FILENAMES:
            p = dirpath / name
            if p.exists() and p.is_file():
                found.append({
                    "path": str(p),
                    "name": name,
                    "dir": str(dirpath),
                    "rel": str(p.relative_to(home)),
                })
    for name in _CONTEXT_FILENAMES:
        p = HERMES_HOME / name
        if p.exists() and p.is_file() and not any(f["path"] == str(p) for f in found):
            found.append({
                "path": str(p),
                "name": name,
                "dir": str(HERMES_HOME),
                "rel": str(p.relative_to(home)),
            })
    return found


@router.get("/api/context/file")
async def api_context_file(path: str):
    p = Path(path)
    if p.name not in _CONTEXT_FILENAMES or not str(p).startswith(str(Path.home())):
        return {"error": "not allowed"}
    if not p.exists():
        return {"path": str(p), "content": "", "exists": False}
    return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}


@router.put("/api/context/file")
async def api_context_file_put(path: str, body: ContextBody):
    p = Path(path)
    if p.name not in _CONTEXT_FILENAMES or not str(p).startswith(str(Path.home())):
        return {"error": "not allowed"}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content)
    return {"ok": True, "bytes": len(body.content.encode())}


@router.post("/api/context/workspace/create")
async def api_context_workspace_create(body: dict):
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


# ── Memories ──────────────────────────────────────────────────────────────────

@router.get("/api/context/memories")
async def api_context_memories():
    mem_dir = HERMES_HOME / "memories"
    files = {}
    for name in ("MEMORY.md", "USER.md"):
        p = mem_dir / name
        files[name] = {
            "path": str(p),
            "content": p.read_text(errors="replace") if p.exists() else "",
            "exists": p.exists(),
        }
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


@router.post("/api/context/memories/create")
async def api_context_memory_create(body: dict):
    name = str(body.get("name", "")).strip()
    if not name:
        return {"error": "missing filename"}
    if Path(name).name != name or "/" in name or "\\" in name:
        return {"error": "filename must not include directories"}
    if not name.endswith(".md"):
        return {"error": "filename must end with .md"}
    p = HERMES_HOME / "memories" / name
    if p.exists():
        return {"error": "file already exists"}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("")
    return {"ok": True, "path": str(p)}


@router.put("/api/context/memories/{filename}")
async def api_context_memory_put(filename: str, body: ContextBody):
    if Path(filename).name != filename or "/" in filename or "\\" in filename:
        return {"error": "invalid filename"}
    if not filename.endswith(".md"):
        return {"error": "invalid filename"}
    p = HERMES_HOME / "memories" / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content)
    return {"ok": True, "bytes": len(body.content.encode())}


# ── config.yaml ───────────────────────────────────────────────────────────────

@router.get("/api/context/config")
async def api_context_config():
    p = HERMES_HOME / "config.yaml"
    if not p.exists():
        return {"path": str(p), "content": "", "exists": False}
    return {"path": str(p), "content": p.read_text(errors="replace"), "exists": True}


@router.put("/api/context/config")
async def api_context_config_put(body: ContextBody):
    try:
        yaml.safe_load(body.content)
    except yaml.YAMLError as e:
        return {"ok": False, "error": f"Invalid YAML: {e}"}
    p = HERMES_HOME / "config.yaml"
    p.write_text(body.content)
    return {"ok": True, "bytes": len(body.content.encode())}


# ── MCP Servers ───────────────────────────────────────────────────────────────

def _read_config_yaml() -> dict:
    p = HERMES_HOME / "config.yaml"
    if not p.exists():
        return {}
    try:
        return yaml.safe_load(p.read_text(errors="replace")) or {}
    except yaml.YAMLError:
        return {}


def _write_config_yaml(config: dict) -> None:
    p = HERMES_HOME / "config.yaml"
    p.write_text(yaml.dump(config, allow_unicode=True, default_flow_style=False))


@router.get("/api/context/mcp/servers")
async def api_mcp_servers_list():
    config = _read_config_yaml()
    servers = config.get("mcp_servers") or {}
    return {"servers": servers, "exists": bool(servers)}


class McpServerBody(BaseModel):
    url: str | None = None
    command: str | None = None
    args: list | None = None
    headers: dict | None = None
    auth: str | None = None
    enabled: bool | None = None
    tools: dict | None = None


@router.put("/api/context/mcp/servers/{name}")
async def api_mcp_server_put(name: str, body: McpServerBody):
    if not name or "/" in name or "\\" in name:
        return {"ok": False, "error": "invalid server name"}
    config = _read_config_yaml()
    existing = dict(config.get("mcp_servers") or {})
    existing[name] = body.model_dump(exclude_none=True)
    config["mcp_servers"] = existing
    _write_config_yaml(config)
    return {"ok": True, "name": name}


@router.delete("/api/context/mcp/servers/{name}")
async def api_mcp_server_delete(name: str):
    config = _read_config_yaml()
    servers = dict(config.get("mcp_servers") or {})
    if name not in servers:
        return {"ok": False, "error": "server not found"}
    del servers[name]
    config["mcp_servers"] = servers or None
    if config["mcp_servers"] is None:
        config.pop("mcp_servers", None)
    _write_config_yaml(config)
    return {"ok": True}


# ── Skills ────────────────────────────────────────────────────────────────────

@router.get("/api/context/skills")
async def api_context_skills():
    return workflow_store.list_configured_skills(platform="cli")


@router.get("/api/context/skills/{skill_name}/content")
async def api_skill_content(skill_name: str):
    result = workflow_store.get_skill_content(skill_name)
    if result is None:
        return {"ok": False, "error": "skill not found"}
    return result


class SkillToggleBody(BaseModel):
    disabled: bool


@router.post("/api/context/skills/{skill_name}/toggle")
async def api_skill_toggle(skill_name: str, body: SkillToggleBody):
    try:
        return workflow_store.toggle_skill_disabled(skill_name, body.disabled)
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Cron ──────────────────────────────────────────────────────────────────────

@router.get("/api/context/cron")
async def api_cron_list():
    try:
        return cron_store.list_jobs()
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/api/context/cron/{job_id}")
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


@router.post("/api/context/cron")
async def api_cron_create(body: CronJobBody):
    try:
        job = cron_store.create_job(body.model_dump(exclude_none=True))
        return {"ok": True, "job": job}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.put("/api/context/cron/{job_id}")
async def api_cron_update(job_id: str, body: CronJobBody):
    try:
        job = cron_store.update_job(job_id, body.model_dump(exclude_none=True))
        if job is None:
            return {"ok": False, "error": "job not found"}
        return {"ok": True, "job": job}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.delete("/api/context/cron/{job_id}")
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


@router.post("/api/context/cron/{job_id}/toggle")
async def api_cron_toggle(job_id: str, body: CronToggleBody):
    try:
        job = cron_store.toggle_job(job_id, body.enabled)
        if job is None:
            return {"ok": False, "error": "job not found"}
        return {"ok": True, "job": job}
    except Exception as e:
        return {"ok": False, "error": str(e)}
