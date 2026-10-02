"""Application factory."""

from __future__ import annotations

from fastapi import Depends, FastAPI

from app.api.data import router as data_router
from app.api.routes import health_router
from app.api.routes import router as api_router
from app.core.security import require_auth
from app.spa import mount_spa


def create_app() -> FastAPI:
    app = FastAPI(title="Monthly Budget", docs_url=None, redoc_url=None)

    app.include_router(health_router)  # unauthenticated: Cloud Run probes
    protected = [Depends(require_auth)]
    app.include_router(api_router, dependencies=protected)
    app.include_router(data_router, dependencies=protected)
    mount_spa(app, protected)  # last: it is a catch-all for the React app
    return app


app = create_app()
