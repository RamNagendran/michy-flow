"""Bring the database schema up to date when the app starts.

Runs the Alembic migrations (not `create_all`), so a fresh database gets every table and an
existing one gets only the changes it is missing. Several app instances starting together are
safe: alembic/env.py takes a Postgres lock, so one migrates and the others wait, then find
nothing to do.
"""

import asyncio
import logging
from pathlib import Path

from alembic.config import Config

from alembic import command

logger = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def _upgrade_to_head() -> None:
    cfg = Config(str(ALEMBIC_INI))
    # Keep the app's logging setup; alembic.ini would otherwise replace it.
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


async def migrate_to_head() -> None:
    # alembic/env.py runs its own event loop, so it needs a thread of its own.
    await asyncio.to_thread(_upgrade_to_head)
    logger.info("Database schema is up to date")
