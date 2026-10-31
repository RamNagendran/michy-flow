import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.config import settings
from app.core.db import engine
from app.core.errors import AppError, app_error_handler
from app.core.migrations import migrate_to_head
from app.core.rate_limit import limiter
from app.realtime import socket as realtime_socket
from app.routers import (
    analytics,
    audit,
    auth,
    companies,
    debit_notes,
    documents,
    entries,
    health,
    parties,
    stock,
    users,
    wastage,
)
from app.workers import WORKERS, Worker

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("app").setLevel(logging.INFO)
logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

logger = logging.getLogger("app")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db_ok = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
        logger.info("Database connection OK")
    except Exception:
        # Keep serving so /health can report the problem instead of crash-looping.
        logger.exception("Database connection check failed at startup")

    if db_ok and settings.AUTO_MIGRATE:
        # A failed migration stops startup: serving on a half-updated schema would be worse.
        await migrate_to_head()

    started: list[Worker] = []
    for worker in WORKERS:
        try:
            await worker.start()
            started.append(worker)
            logger.info("Started worker %s", worker.name)
        except Exception:
            logger.exception("Worker %s failed to start", worker.name)

    yield

    for worker in reversed(started):
        try:
            await worker.stop()
        except Exception:
            logger.exception("Worker %s failed to stop cleanly", worker.name)
    await engine.dispose()


async def _db_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, IntegrityError):
        return JSONResponse(
            status_code=409,
            content={"detail": "This conflicts with existing data", "code": "integrity_error"},
        )
    logger.error("Database error: %s", exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "The database is temporarily unavailable. Please try again.",
            "code": "database_unavailable",
        },
    )


def create_app() -> FastAPI:
    docs = settings.is_development
    app = FastAPI(
        title="Michy Flow API",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_exception_handler(DBAPIError, _db_error_handler)
    app.add_exception_handler(AppError, app_error_handler)

    # Starlette runs the last-added middleware first, so CORS wraps everything
    # (429s and errors still carry CORS headers).
    app.add_middleware(SlowAPIMiddleware)

    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(companies.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    app.include_router(parties.router)
    app.include_router(entries.router)
    app.include_router(stock.router)
    app.include_router(documents.router)
    app.include_router(wastage.router)
    app.include_router(wastage.queue_router)
    app.include_router(debit_notes.router)
    app.include_router(analytics.router)
    app.include_router(realtime_socket.router)
    return app


app = create_app()
