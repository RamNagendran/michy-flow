"""Connected clients and fan-out. One Hub per process.

Events are dicts with a "type" and the fields needed to decide who may see them. Delivery is
O(connections in that organisation): connections are indexed account → user → connections.
Each connection has a bounded queue; a client too slow to keep up is dropped, and reconnects
and refetches.
"""

import asyncio
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

QUEUE_SIZE = 100
MAX_CONNECTIONS_PER_USER = 5


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: int
    account_id: int
    # company_id → True when this person may only see their own entries there (operators).
    scopes: dict[int, bool]
    queue: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(QUEUE_SIZE))
    closed: bool = False

    def wants(self, event: dict[str, Any]) -> bool:
        kind = event.get("type")
        if kind == "access":
            return self.user_id in event.get("user_ids", ())
        if kind == "company":
            return True
        company_id = event.get("company_id")
        if company_id not in self.scopes:
            return False
        if kind == "entry" and self.scopes[company_id]:
            return event.get("created_by_id") == self.user_id
        return True


class Hub:
    def __init__(self) -> None:
        self._by_account: dict[int, dict[int, list[Connection]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self.publisher: Any = None  # set by the Postgres bridge when several instances run

    def register(self, conn: Connection) -> None:
        mine = self._by_account[conn.account_id][conn.user_id]
        mine.append(conn)
        # Too many tabs or a reconnect loop: the oldest connection makes way.
        while len(mine) > MAX_CONNECTIONS_PER_USER:
            self._drop(mine.pop(0))

    def unregister(self, conn: Connection) -> None:
        users = self._by_account.get(conn.account_id)
        if not users or conn not in users.get(conn.user_id, []):
            return
        users[conn.user_id].remove(conn)
        if not users[conn.user_id]:
            del users[conn.user_id]
        if not users:
            del self._by_account[conn.account_id]

    def connection_count(self) -> int:
        return sum(len(c) for users in self._by_account.values() for c in users.values())

    def _drop(self, conn: Connection) -> None:
        conn.closed = True
        try:
            conn.queue.put_nowait("")  # wakes the writer, which then closes the socket
        except asyncio.QueueFull:
            pass

    def deliver(self, event: dict[str, Any]) -> int:
        """Send to every connection on this process that may see the event. Returns how many."""
        users = self._by_account.get(event.get("account_id", -1))
        if not users:
            return 0
        message = json.dumps(
            {k: v for k, v in event.items() if k not in ("account_id", "user_ids")}
        )
        sent = 0
        for conns in list(users.values()):
            for conn in list(conns):
                if conn.closed or not conn.wants(event):
                    continue
                try:
                    conn.queue.put_nowait(message)
                    sent += 1
                except asyncio.QueueFull:
                    logger.info("Dropping slow realtime client (user %s)", conn.user_id)
                    self.unregister(conn)
                    self._drop(conn)
        return sent

    async def publish(self, event: dict[str, Any]) -> None:
        """Through the bridge when there is one (it delivers back here too), else locally."""
        if self.publisher is not None:
            await self.publisher(event)
        else:
            self.deliver(event)


hub = Hub()
