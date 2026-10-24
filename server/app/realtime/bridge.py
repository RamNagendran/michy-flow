"""Share realtime events between server instances with Postgres LISTEN/NOTIFY.

Only needed when more than one instance runs. LISTEN needs a session connection, so this uses
its own URL: on Supabase that is the direct connection or the *session* pooler (port 5432),
not the transaction pooler (6543) the app uses.
"""

import asyncio
import json
import logging
from typing import Any

from app.realtime.hub import hub

logger = logging.getLogger(__name__)

CHANNEL = "michy_realtime"
# Postgres caps a NOTIFY payload at 8000 bytes.
_MAX_PAYLOAD = 7900


def _plain_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


class PostgresBridge:
    name = "realtime-bridge"

    def __init__(self, url: str) -> None:
        self._url = _plain_url(url)
        self._listener: Any = None
        self._sender: Any = None
        self._task: asyncio.Task | None = None
        self._stopping = False

    async def start(self) -> None:
        hub.publisher = self.notify
        self._task = asyncio.create_task(self._listen_forever())

    async def stop(self) -> None:
        self._stopping = True
        hub.publisher = None
        if self._task:
            self._task.cancel()
        for conn in (self._listener, self._sender):
            if conn is not None and not conn.is_closed():
                await conn.close()

    def _on_notify(self, _conn: Any, _pid: int, _channel: str, payload: str) -> None:
        try:
            hub.deliver(json.loads(payload))
        except ValueError:
            logger.warning("Ignoring a malformed realtime notification")

    async def _listen_forever(self) -> None:
        import asyncpg

        delay = 1.0
        while not self._stopping:
            try:
                closed = asyncio.Event()
                self._listener = await asyncpg.connect(self._url, statement_cache_size=0)
                self._listener.add_termination_listener(lambda _conn, done=closed: done.set())
                await self._listener.add_listener(CHANNEL, self._on_notify)
                logger.info("Realtime bridge listening")
                delay = 1.0
                await closed.wait()  # until the connection drops; then reconnect
            except asyncio.CancelledError:
                return
            except Exception:  # noqa: BLE001
                logger.exception("Realtime bridge connection failed; retrying in %.0fs", delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def notify(self, event: dict[str, Any]) -> None:
        import asyncpg

        payload = json.dumps(event)
        if len(payload) > _MAX_PAYLOAD:
            hub.deliver(event)
            return
        try:
            if self._sender is None or self._sender.is_closed():
                self._sender = await asyncpg.connect(self._url, statement_cache_size=0)
            await self._sender.execute("SELECT pg_notify($1, $2)", CHANNEL, payload)
        except Exception:  # noqa: BLE001
            # Better to reach this instance's clients than nobody.
            logger.exception("Realtime NOTIFY failed; delivering locally")
            hub.deliver(event)
