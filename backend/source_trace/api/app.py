"""The FastAPI application (spec 03 section 3)."""

from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass
from typing import Annotated, Any, Literal

import httpx
from fastapi import FastAPI, Header, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StrictInt
from starlette.exceptions import HTTPException as StarletteHTTPException

from .. import __version__
from ..ai import AiService, make_provider
from ..clock import Clock, utc_now
from ..config import Settings
from ..engine.workspace import validate_workspace
from ..errors import AppError, envelope
from ..pdf import extract_text
from ..store import RevisionConflictError, Store, migrate
from .middleware import BodyLimit, Deadline, HostGuard, OriginGuard

log = logging.getLogger("source_trace.api")
ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")

_HTTP_CODES = {
    400: "bad_request",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    415: "unsupported_media_type",
}


@dataclass
class Context:
    settings: Settings
    store: Store
    ai: AiService


class PutWorkspace(BaseModel):
    baseRevision: StrictInt | None = Field(default=None, ge=0)  # noqa: N815
    workspace: dict[str, Any]


class SourceIn(BaseModel):
    # Workspace source ids only (spec 03 section 1), so an id can neither break the prompt's
    # source blocks nor carry text into the usage log.
    id: str = Field(pattern=r"^s_[1-9][0-9]{0,8}$")
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1)


class SuggestIn(BaseModel):
    task: Literal["suggest_claims", "find_evidence"]
    sources: list[SourceIn] = Field(min_length=1)
    claimText: str | None = Field(default=None, max_length=2000)  # noqa: N815


def _workspace_id(value: str) -> str:
    if ID_RE.fullmatch(value) is None:
        raise AppError(
            422, "invalid_request", "Workspace ids use letters, digits, _ and -, up to 64."
        )
    return value


def create_app(
    settings: Settings | None = None,
    *,
    clock: Clock | None = None,
    ai_transport: httpx.BaseTransport | None = None,
) -> FastAPI:
    config = settings if settings is not None else Settings.from_env()
    now = clock if clock is not None else utc_now
    migrate(config.db_path)
    ctx = Context(
        settings=config,
        store=Store(config.db_path, now),
        ai=AiService(config, make_provider(config, ai_transport), now),
    )
    app = FastAPI(
        title="SourceTrace API",
        version=__version__,
        description=(
            "Local-only backend of SourceTrace: validated workspace snapshots, bounded PDF text "
            "extraction and an optional, opt-in AI suggestion broker. No authentication: loopback."
        ),
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        generate_unique_id_function=lambda route: route.name,
    )
    app.state.ctx = ctx

    # --- error envelope --------------------------------------------------------------------
    @app.exception_handler(AppError)
    async def _app_error(_r: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, AppError)
        return JSONResponse(
            status_code=exc.status_code,
            content=envelope(exc.code, exc.message, exc.details),
            headers=exc.headers or None,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_r: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RequestValidationError)
        problems = [
            {
                "loc": [p for p in err.get("loc", ()) if isinstance(p, str | int)],
                "message": str(err.get("msg", "invalid value")),
            }
            for err in exc.errors()
        ]
        first = problems[0] if problems else None
        where = ".".join(str(p) for p in first["loc"]) if first else ""
        message = "The request is invalid" + (f": {where}: {first['message']}" if first else "")
        return JSONResponse(
            status_code=422, content=envelope("invalid_request", message, {"errors": problems})
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_r: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, StarletteHTTPException)
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        message = str(exc.detail) if exc.detail else code.replace("_", " ")
        return JSONResponse(status_code=exc.status_code, content=envelope(code, message))

    @app.exception_handler(sqlite3.OperationalError)
    async def _db(_r: Request, exc: Exception) -> JSONResponse:
        text = str(exc).lower()
        if "locked" in text or "busy" in text:
            return JSONResponse(
                status_code=503,
                content=envelope(
                    "database_busy",
                    "The database is locked by another program, so nothing was saved. Try again.",
                ),
                headers={"Retry-After": "5"},
            )
        log.exception("database error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=envelope("internal_error", "The server hit an unexpected error; see its log"),
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error in %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=envelope("internal_error", "The server hit an unexpected error; see its log"),
        )

    # --- routes -------------------------------------------------------------------------------
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/capabilities")
    def capabilities() -> dict[str, Any]:
        s = ctx.settings
        return {
            "version": __version__,
            "pdf": {
                "enabled": True,
                "maxBytes": s.pdf_max_bytes,
                "maxPages": s.pdf_max_pages,
                "timeoutSeconds": s.pdf_timeout_s,
            },
            "ai": ctx.ai.capabilities(),
            "storage": {"kind": "sqlite", "maxSnapshotBytes": s.max_body_bytes},
        }

    @app.get("/api/workspaces")
    def list_workspaces() -> dict[str, Any]:
        return {"workspaces": ctx.store.list_all()}

    @app.get("/api/workspaces/{workspace_id}")
    def get_workspace(workspace_id: str) -> dict[str, Any]:
        found = ctx.store.get(_workspace_id(workspace_id))
        if found is None:
            raise AppError(404, "not_found", "No such workspace.")
        return found

    @app.put("/api/workspaces/{workspace_id}")
    def put_workspace(workspace_id: str, body: PutWorkspace) -> dict[str, Any]:
        wid = _workspace_id(workspace_id)
        codes = validate_workspace(body.workspace)
        if codes:
            raise AppError(
                422,
                "invalid_workspace",
                "The workspace snapshot is not valid: " + ", ".join(codes),
                details={"codes": codes},
            )
        try:
            return ctx.store.save(wid, body.workspace, body.baseRevision)
        except RevisionConflictError as conflict:
            raise AppError(
                409,
                "stale_revision",
                "The stored workspace changed since you loaded it. Reload before saving.",
                details={"currentRevision": conflict.current},
            ) from conflict

    @app.delete("/api/workspaces/{workspace_id}", status_code=204)
    def delete_workspace(workspace_id: str) -> Response:
        if not ctx.store.delete(_workspace_id(workspace_id)):
            raise AppError(404, "not_found", "No such workspace.")
        return Response(status_code=204)

    @app.post("/api/pdf/extract")
    async def pdf_extract(request: Request) -> dict[str, Any]:
        media = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if media != "application/pdf":
            raise AppError(415, "unsupported_media_type", "Send the PDF as application/pdf.")
        data = await request.body()
        return await run_in_threadpool(extract_text, data, ctx.settings)

    @app.post("/api/ai/suggest")
    async def ai_suggest(
        body: SuggestIn,
        opt_in: Annotated[str | None, Header(alias="X-SourceTrace-AI-Opt-In")] = None,
    ) -> dict[str, Any]:
        sources = [{"id": s.id, "text": s.text} for s in body.sources]
        return await run_in_threadpool(
            ctx.ai.suggest, opt_in == "session", body.task, sources, body.claimText
        )

    # --- guards (the last one added is the outermost) --------------------------------------------
    app.add_middleware(BodyLimit, max_bytes=config.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_methods=["GET", "PUT", "POST", "DELETE"],
        allow_headers=["Content-Type", "X-SourceTrace-AI-Opt-In"],
        expose_headers=["Retry-After"],
        allow_credentials=False,
    )
    app.add_middleware(OriginGuard, allowed=frozenset(config.cors_origins))
    app.add_middleware(Deadline, seconds=config.request_timeout_s)
    app.add_middleware(HostGuard, served_hosts=config.served_hosts())
    return app
