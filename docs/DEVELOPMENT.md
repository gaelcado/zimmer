# Development

## Test

```bash
cd ~/.hermes/plugins/zimmer
source .venv/bin/activate
python -m pytest tests -q
```

Run one file:

```bash
python -m pytest tests/test_event_bus.py -q
```

## Frontend dev/build

```bash
cd ui
npm run dev
npm run build
```

## Makefile shortcuts

```bash
make test
make ui-dev
make ui-build
```

## Key paths

| Path | Purpose |
|------|---------|
| `~/.hermes/state.db` | Sessions/messages/tool calls |
| `~/.hermes/SOUL.md` | Soul file |
| `~/.hermes/config.yaml` | Hermes config |
| `~/.hermes/memories/` | Memory files |
| `~/.hermes/skills/` | Skills |
| `~/.hermes/workflows/` | Workflow definitions |
| `~/.hermes/cron/jobs.json` | Cron jobs |
| `~/.hermes/logs/` | Log files |
| `ui/dist/` | Built SPA served by FastAPI |

## Test fixtures (`tests/conftest.py`)

| Fixture | Purpose |
|---------|---------|
| `event_bus` / `event_bus_with_loop` | Isolated EventBus instances |
| `tmp_state_db` / `populated_db` | Temporary SQLite DBs with Hermes schema |
| `patch_hermes_home` | Redirects `HERMES_HOME` to temp dir |
| `mock_plugin_ctx` | Mock plugin context for `register()` tests |
