"""Serve the built React app (frontend/dist) at the site root, with index.html as the client-side-routing fallback."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse

DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"

# Vite hashes asset file names, so they can be cached forever. index.html names the current
# bundle, so it must always be revalidated or a rebuild stays invisible.
ASSET_CACHE = "public, max-age=31536000, immutable"
INDEX_CACHE = "no-cache"


def mount_spa(app: FastAPI, dependencies: Sequence = ()) -> None:
    """Register the catch-all route. Call it last so it never shadows the API routes."""
    index = DIST / "index.html"
    router = APIRouter(dependencies=list(dependencies))

    @router.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")  # unknown API paths must not fall back to the HTML page
        if not index.exists():
            raise HTTPException(503, "Front end not built. Run `npm run build` in frontend/.")
        candidate = (DIST / path).resolve()
        if path and candidate.is_file() and DIST.resolve() in candidate.parents:
            return FileResponse(candidate, headers={"Cache-Control": ASSET_CACHE})
        return FileResponse(index, headers={"Cache-Control": INDEX_CACHE})

    app.include_router(router)
