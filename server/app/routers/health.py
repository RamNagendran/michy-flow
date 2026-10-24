import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> JSONResponse:
    try:
        await db.execute(text("SELECT 1"))
    except (DBAPIError, OSError):
        logger.warning("Health check: database unreachable", exc_info=True)
        return JSONResponse(
            status_code=503, content={"status": "error", "code": "database_unavailable"}
        )
    return JSONResponse({"status": "ok"})
