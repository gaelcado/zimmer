# Architecture

## Backend (Python)

| Module | Role |
|--------|------|
| `__init__.py` | Plugin entrypoint. Registers hooks, syncs gateway hook files, starts FastAPI server thread. |
| `gateway_hook_bridge.py` | Maps gateway hook events (`command:*`, `agent:*`, `session:*`) to Zimmer bus events. |
| `event_bus.py` | Thread-safe sync->async event bridge for SSE subscribers. |
| `server.py` | FastAPI app factory + router wiring + static SPA serving from `ui/dist/`. |
| `state_reader.py` | Read-only SQLite queries against `~/.hermes/state.db`. |
| `workflow_store.py` | Workflow persistence + skill discovery + run records. |
| `workflow_engine.py` | Workflow validation and execution planning. |
| `cron_store.py` | Cron jobs read/write (`~/.hermes/cron/jobs.json`). |
| `routes/*.py` | API endpoints (sessions, events, logs, context, workflows, terminal, honcho). |

## Frontend (React + Vite)

Main files:
- `ui/src/App.jsx` - scene routing + global hotkeys
- `ui/src/components/*` - scene/panel components
- `ui/src/hooks/useSSE.js` - live event stream
- `ui/src/hooks/useSessionData.js` - data loading
- `ui/src/lib/*` - timeline, turns, colors

## Gateway hook companion

Zimmer installs:
- `~/.hermes/hooks/zimmer_gateway_bridge/HOOK.yaml`
- `~/.hermes/hooks/zimmer_gateway_bridge/handler.py`

That hook forwards gateway lifecycle events into Zimmer's event bus without modifying Hermes core.

## Data flow

```
Hermes plugin hooks + gateway hooks
  -> EventBus.publish() (sync)
  -> asyncio subscriber queues
  -> /api/events (SSE)
  -> browser EventSource

Browser fetch
  -> FastAPI routes
  -> state_reader
  -> ~/.hermes/state.db
```

## Plugin boundary

Zimmer is self-contained in `~/.hermes/plugins/zimmer`. Prefer plugin-side solutions first; only upstream if absolutely required.
