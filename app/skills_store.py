"""Skill listing/content/toggle helpers used by Context scene."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

_SKILL_TABLE_ROW_RE = re.compile(r"^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$")
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)
_PLATFORM_MAP = {
    "darwin": "darwin",
    "mac": "darwin",
    "macos": "darwin",
    "linux": "linux",
    "windows": "win32",
    "win": "win32",
}
_EXCLUDED_SKILL_DIRS = {"references", "assets", "templates"}


def _hermes_home() -> Path:
    return Path(os.getenv("HERMES_HOME", Path.home() / ".hermes"))


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    m = _FRONTMATTER_RE.match(text or "")
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


def _find_skill_md(skill_name: str) -> Path | None:
    skills_dir = _hermes_home() / "skills"
    if not skills_dir.exists():
        return None
    for skill_md in skills_dir.rglob("SKILL.md"):
        if any(part in _EXCLUDED_SKILL_DIRS for part in skill_md.parts):
            continue
        try:
            text = skill_md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        meta, _ = _parse_frontmatter(text)
        name = str(meta.get("name") or skill_md.parent.name).strip()
        if name == skill_name:
            return skill_md
    return None


def _enrich_skill_from_fs(skill: dict) -> None:
    name = skill.get("name") or ""
    if not name:
        return
    skill_md = _find_skill_md(name)
    if not skill_md:
        return
    try:
        text = skill_md.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return
    meta, body = _parse_frontmatter(text)
    if not skill.get("description"):
        desc = str(meta.get("description") or "").strip()
        if not desc:
            for line in body.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    desc = line[:140]
                    break
        skill["description"] = desc
    if not skill.get("version"):
        skill["version"] = str(meta.get("version") or "")
    if not skill.get("author"):
        skill["author"] = str(meta.get("author") or "")
    tags_raw = meta.get("tags") or meta.get("metadata", {}).get("hermes", {}).get("tags") or []
    if isinstance(tags_raw, str):
        tags_raw = [t.strip() for t in tags_raw.split(",") if t.strip()]
    skill["tags"] = list(tags_raw) if isinstance(tags_raw, list) else []
    skill["prerequisites"] = meta.get("prerequisites") or {}
    skill["platforms"] = meta.get("platforms") or []
    skill["skill_md_path"] = str(skill_md)
    skill["path"] = str(skill_md.parent)


def get_skill_content(skill_name: str) -> dict[str, Any] | None:
    skill_md = _find_skill_md(skill_name)
    if not skill_md:
        return None
    try:
        text = skill_md.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    meta, body = _parse_frontmatter(text)
    return {
        "name": skill_name,
        "frontmatter": meta,
        "content": text,
        "body": body,
        "path": str(skill_md),
    }


def toggle_skill_disabled(skill_name: str, disabled: bool) -> dict[str, Any]:
    cfg = _load_config()
    skills_cfg = cfg.get("skills")
    if not isinstance(skills_cfg, dict):
        skills_cfg = {}
        cfg["skills"] = skills_cfg
    disabled_list = list(skills_cfg.get("disabled") or [])

    if disabled and skill_name not in disabled_list:
        disabled_list.append(skill_name)
    elif not disabled and skill_name in disabled_list:
        disabled_list.remove(skill_name)

    skills_cfg["disabled"] = disabled_list
    cfg["skills"] = skills_cfg

    p = _hermes_home() / "config.yaml"
    p.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    return {"ok": True, "disabled": disabled_list}


def list_configured_skills(platform: str = "cli") -> list[dict[str, Any]]:
    cfg = _load_config()
    disabled = _get_disabled_skill_names(cfg, platform=platform)

    from_cli = _list_skills_from_hermes_cli()
    if from_cli:
        rows = []
        for row in from_cli:
            cloned = dict(row)
            cloned["platform"] = platform
            cloned["disabled"] = row.get("name") in disabled
            _enrich_skill_from_fs(cloned)
            rows.append(cloned)
        rows.sort(key=lambda s: (s.get("category", ""), s.get("name", "")))
        return rows

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
        if not name:
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
        tags_raw = meta.get("tags") or meta.get("metadata", {}).get("hermes", {}).get("tags") or []
        if isinstance(tags_raw, str):
            tags_raw = [t.strip() for t in tags_raw.split(",") if t.strip()]
        prereqs = meta.get("prerequisites") or {}
        result.append({
            "name": name,
            "description": description,
            "category": category if category != "." else "uncategorized",
            "version": str(meta.get("version") or ""),
            "author": str(meta.get("author") or ""),
            "path": str(skill_md.parent),
            "skill_md_path": str(skill_md),
            "platform": platform,
            "disabled": name in disabled,
            "tags": list(tags_raw) if isinstance(tags_raw, list) else [],
            "prerequisites": prereqs if isinstance(prereqs, dict) else {},
            "platforms": meta.get("platforms") or [],
        })

    result.sort(key=lambda s: (s.get("category", ""), s.get("name", "")))
    return result
