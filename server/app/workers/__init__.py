"""Background workers started in the app lifespan.

Each worker is an object with async `start()` and `stop()` methods. Add it to WORKERS to run it.
"""

from typing import Protocol


class Worker(Protocol):
    name: str

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


def _workers() -> list[Worker]:
    from app.core.config import settings
    from app.realtime.bridge import PostgresBridge

    return [PostgresBridge(settings.REALTIME_LISTEN_URL)] if settings.REALTIME_LISTEN_URL else []


WORKERS: list[Worker] = _workers()
