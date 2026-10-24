"""The /ws endpoint: authenticate, register, then pump events until the client goes away.

The browser sends its access token in the first message (never in the URL, which ends up in
logs). The connection closes when that token expires; the client reconnects with a fresh one.
"""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.auth.permissions import CompanyPermission as P
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import InvalidTokenError, decode_token
from app.models import User
from app.realtime.hub import Connection, hub
from app.services.access_service import accessible_companies, permissions_in

logger = logging.getLogger(__name__)
router = APIRouter()

AUTH_TIMEOUT_SECONDS = 10
PING_EVERY_SECONDS = 25
# Close codes the client understands.
POLICY_VIOLATION = 1008
UNAUTHORIZED = 4401
TOKEN_EXPIRED = 4408


async def authenticate(token: str) -> tuple[User, dict[int, bool], datetime] | None:
    """The user, what they may see per company, and when their token expires. Uses its own
    short database session: a long-lived socket must not hold a database connection."""
    try:
        claims = decode_token(token, "access")
    except InvalidTokenError:
        return None
    async with SessionLocal() as db:
        user = await db.get(User, claims["user_id"])
        if (
            not user
            or not user.is_active
            or user.must_change_password
            or user.account_id != claims["account_id"]
            or user.token_version != claims["tv"]
        ):
            return None
        scopes: dict[int, bool] = {}
        for company in await accessible_companies(db, user):
            perms = permissions_in(user, company)
            if P.VIEW in perms:
                scopes[company.id] = P.VIEW_ALL_ENTRIES not in perms
        expires = datetime.fromtimestamp(claims["exp"], tz=UTC)
        return user, scopes, expires


async def _writer(conn: Connection) -> None:
    while not conn.closed:
        try:
            message = await asyncio.wait_for(conn.queue.get(), PING_EVERY_SECONDS)
        except TimeoutError:
            message = '{"type":"ping"}'  # keeps proxies from closing an idle connection
        if conn.closed or not message:
            return
        await conn.websocket.send_text(message)


async def _reader(websocket: WebSocket) -> None:
    # Clients only send pings; anything else is ignored. Large frames are refused by the server.
    while True:
        await websocket.receive_text()


@router.websocket("/ws")
async def realtime(websocket: WebSocket) -> None:
    origin = (websocket.headers.get("origin") or "").rstrip("/")
    # Browsers always send Origin; refusing others stops a third-party page riding the socket.
    if origin and origin not in settings.allowed_origins:
        await websocket.close(code=POLICY_VIOLATION)
        return
    await websocket.accept()
    try:
        hello = await asyncio.wait_for(websocket.receive_json(), AUTH_TIMEOUT_SECONDS)
        auth = await authenticate(str(hello.get("token", ""))) if isinstance(hello, dict) else None
    except (TimeoutError, ValueError, WebSocketDisconnect):
        auth = None
    if auth is None:
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=UNAUTHORIZED)
        return

    user, scopes, expires = auth
    conn = Connection(
        websocket=websocket, user_id=user.id, account_id=user.account_id, scopes=scopes
    )
    hub.register(conn)
    await websocket.send_json({"type": "ready", "companies": sorted(scopes)})
    lifetime = max((expires - datetime.now(UTC)).total_seconds(), 1)
    tasks = [asyncio.create_task(_writer(conn)), asyncio.create_task(_reader(websocket))]
    try:
        done, _ = await asyncio.wait(tasks, timeout=lifetime, return_when=asyncio.FIRST_COMPLETED)
        code = TOKEN_EXPIRED if not done else 1000
    except Exception:  # noqa: BLE001
        code = 1011
    finally:
        conn.closed = True
        hub.unregister(conn)
        for task in tasks:
            task.cancel()
    if websocket.client_state == WebSocketState.CONNECTED:
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close(code=code)
