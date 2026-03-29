"""FastAPI app factory: registers routers, startup hook, and SPA static serving."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .event_bus import EventBus
from . import workflow_store
from ._config import WORKFLOW_RUN_RETENTION_DAYS, WORKFLOW_RUN_KEEP_PER_WORKFLOW
from . import _config
from .routes import sessions, events, logs, context, workflows, terminal, honcho

# Exposed as module-level attributes so tests can monkeypatch them before
# calling create_app().
_UI_DIST = _config.UI_DIST


def create_app(bus: EventBus) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        workflow_store.reconcile_running_runs()
        workflow_store.cleanup_run_records(
            max_age_days=WORKFLOW_RUN_RETENTION_DAYS,
            keep_per_workflow=WORKFLOW_RUN_KEEP_PER_WORKFLOW,
            dry_run=False,
        )
        from . import cron_store
        if not cron_store._HERMES_CRON:
            import logging
            logging.getLogger(__name__).warning(
                "Zimmer: hermes cron.jobs unavailable — cron writes use fcntl fallback "
                "which may conflict with Hermes v0.4.0+ scheduler. "
                "Ensure hermes-agent is at ../../hermes-agent relative to the plugin."
            )
        yield

    app = FastAPI(title="Hermes Zimmer", docs_url=None, redoc_url=None, lifespan=lifespan)

    # Wire the bus into routers that need it.
    events.set_bus(bus)
    workflows.set_bus(bus)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(sessions.router)
    app.include_router(events.router)
    app.include_router(logs.router)
    app.include_router(context.router)
    app.include_router(workflows.router)
    app.include_router(honcho.router)
    app.include_router(terminal.router)

    # ── SPA static files ──────────────────────────────────────────────────────
    # Read _UI_DIST at create_app() call time so tests can monkeypatch it.
    import zimmer.server as _self
    dist = _self._UI_DIST
    assets_dir = dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def spa_root():
        index = dist / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"status": "UI not built — run install.sh"}

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        candidate = dist / path
        if candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        index = dist / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"status": "UI not built — run install.sh"}

    return app
