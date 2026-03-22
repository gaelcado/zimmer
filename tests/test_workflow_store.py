"""Tests for workflow skill discovery behavior."""

from types import SimpleNamespace

from zimmer import workflow_store


def test_cli_skill_listing_parses_table_rows(monkeypatch):
    stdout = (
        "┏━━━━━━━━┓\n"
        "│ Name │ Category │ Source │ Trust │\n"
        "├────────┤\n"
        "│ alpha │ tools │ builtin │ builtin │\n"
        "│ beta │ productivity │ local │ local │\n"
        "└────────┘\n"
        "0 hub-installed, 1 builtin, 1 local\n"
    )

    monkeypatch.setattr(
        workflow_store.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=stdout),
    )

    rows = workflow_store._list_skills_from_hermes_cli()
    assert len(rows) == 2
    assert rows[0]["name"] == "alpha"
    assert rows[0]["category"] == "tools"
    assert rows[0]["source"] == "builtin"
    assert rows[0]["path"] == "cli://builtin/tools/alpha"
    assert rows[1]["name"] == "beta"
    assert rows[1]["source"] == "local"


def test_list_configured_skills_cli_applies_disabled_filter(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(
        "skills:\n"
        "  disabled:\n"
        "    - beta\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        workflow_store,
        "_list_skills_from_hermes_cli",
        lambda: [
            {"name": "alpha", "category": "tools", "source": "builtin", "trust": "builtin", "path": "cli://builtin/tools/alpha"},
            {"name": "beta", "category": "tools", "source": "local", "trust": "local", "path": "cli://local/tools/beta"},
        ],
    )

    rows = workflow_store.list_configured_skills(platform="cli")
    names = [row["name"] for row in rows]
    assert names == ["alpha"]
    assert rows[0]["platform"] == "cli"


def test_list_configured_skills_falls_back_to_filesystem_when_cli_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    skills_root = tmp_path / "skills" / "tools" / "alpha-skill"
    skills_root.mkdir(parents=True, exist_ok=True)
    (skills_root / "SKILL.md").write_text(
        "---\n"
        "name: alpha\n"
        "description: Alpha skill\n"
        "---\n"
        "# Alpha\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(workflow_store, "_list_skills_from_hermes_cli", lambda: [])

    rows = workflow_store.list_configured_skills(platform="cli")
    assert len(rows) == 1
    assert rows[0]["name"] == "alpha"
    assert rows[0]["description"] == "Alpha skill"
    assert rows[0]["category"] == "tools"
