from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    # No pre-ping: it costs a round trip on every request (~90 ms to Supabase from India).
    # A dropped connection fails one request and is replaced. Opening one takes ~800 ms, so
    # keep them for 30 minutes.
    pool_recycle=1800,
    pool_size=10,
    max_overflow=20,
    # pgbouncer (Supabase pooler) can't use asyncpg's prepared statement cache.
    connect_args={"statement_cache_size": 0},
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
