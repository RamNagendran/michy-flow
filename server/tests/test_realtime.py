"""Live updates: who receives what, and that saves publish events."""

import asyncio
import json

import pytest
from httpx import AsyncClient

from app.core.security import create_token
from app.realtime import socket as realtime_socket
from app.realtime.hub import MAX_CONNECTIONS_PER_USER, QUEUE_SIZE, Connection, Hub, hub
from tests.conftest import bearer, login_new_user
from tests.entry_helpers import act, purchase, team


def _conn(user_id: int, scopes: dict[int, bool], account_id: int = 1) -> Connection:
    return Connection(websocket=None, user_id=user_id, account_id=account_id, scopes=scopes)  # type: ignore[arg-type]


def _received(conn: Connection) -> list[dict]:
    out = []
    while not conn.queue.empty():
        out.append(json.loads(conn.queue.get_nowait()))
    return out


def test_entry_events_reach_only_permitted_people() -> None:
    h = Hub()
    admin = _conn(1, {10: False})
    operator = _conn(2, {10: True})  # sees only their own entries
    other_company = _conn(3, {20: False})
    other_account = _conn(4, {10: False}, account_id=2)
    for c in (admin, operator, other_company, other_account):
        h.register(c)

    h.deliver(
        {"type": "entry", "account_id": 1, "company_id": 10, "created_by_id": 9, "ref_no": "PUR-1"}
    )
    h.deliver(
        {"type": "entry", "account_id": 1, "company_id": 10, "created_by_id": 2, "ref_no": "PUR-2"}
    )

    assert [e["ref_no"] for e in _received(admin)] == ["PUR-1", "PUR-2"]
    assert [e["ref_no"] for e in _received(operator)] == ["PUR-2"]
    assert _received(other_company) == [] and _received(other_account) == []


def test_access_events_go_to_the_named_people_only() -> None:
    h = Hub()
    a, b = _conn(1, {}), _conn(2, {})
    h.register(a)
    h.register(b)
    h.deliver({"type": "access", "account_id": 1, "user_ids": [2]})
    assert _received(a) == []
    # Internal routing fields are not sent to the browser.
    assert _received(b) == [{"type": "access"}]


def test_slow_clients_are_dropped_and_tabs_are_capped() -> None:
    h = Hub()
    slow = _conn(1, {10: False})
    h.register(slow)
    for i in range(QUEUE_SIZE + 1):
        h.deliver({"type": "party", "account_id": 1, "company_id": 10, "party_id": i})
    assert slow.closed and h.connection_count() == 0

    tabs = [_conn(5, {}) for _ in range(MAX_CONNECTIONS_PER_USER + 1)]
    for c in tabs:
        h.register(c)
    assert h.connection_count() == MAX_CONNECTIONS_PER_USER
    assert tabs[0].closed


async def test_socket_auth_checks_the_token_and_scopes(client: AsyncClient) -> None:
    t = await team(client)
    me = (await client.get("/auth/me", headers=bearer(t.operator))).json()
    auth = await realtime_socket.authenticate(t.operator)
    assert auth is not None
    user, scopes, _ = auth
    assert user.id == me["id"]
    assert scopes == {t.company["id"]: True}  # an operator: own entries only

    assert await realtime_socket.authenticate("garbage") is None
    stale = create_token(
        user_id=me["id"], account_id=me["account_id"], token_version=99, token_type="access"
    )
    assert await realtime_socket.authenticate(stale) is None
    refresh = create_token(
        user_id=me["id"], account_id=me["account_id"], token_version=1, token_type="refresh"
    )
    assert await realtime_socket.authenticate(refresh) is None


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    events: list[dict] = []

    async def capture(event: dict) -> None:
        events.append(event)

    monkeypatch.setattr(hub, "publisher", capture)
    return events


async def test_saves_publish_events_after_commit(client: AsyncClient, captured: list[dict]) -> None:
    t = await team(client)
    captured.clear()
    entry = (await purchase(client, t, t.operator, approve=False)).json()
    await act(client, t, t.manager, entry, "approve")
    await client.post(
        t.url(f"/entries/purchase/{entry['id']}/comments"),
        json={"comment": "ok?"},
        headers=bearer(t.finance),
    )
    await client.post(
        t.url(f"/entries/purchase/{entry['id']}/escalate"),
        json={"comment": "Rate?"},
        headers=bearer(t.finance),
    )

    entry_events = [(e["action"], e["status"]) for e in captured if e["type"] == "entry"]
    assert entry_events == [
        ("created", "pending"),
        ("approved", "approved"),
        ("commented", "approved"),
        ("escalated", "approved"),
    ]
    first = next(e for e in captured if e["type"] == "entry")
    assert first["ref_no"] == entry["ref_no"] and first["actor_name"] == "Ops"
    assert first["company_id"] == t.company["id"]


async def test_access_change_is_published_to_that_user(
    client: AsyncClient, captured: list[dict]
) -> None:
    from tests.conftest import create_user

    t = await team(client)
    created = await create_user(client, t.super_admin, "late@example.com", global_role="ceo")
    await login_new_user(client, created)
    captured.clear()
    target = created["user"]["id"]
    await client.patch(f"/users/{target}", json={"is_active": False}, headers=bearer(t.super_admin))
    assert [(e["type"], e["user_ids"]) for e in captured] == [("access", [target])]


async def test_writer_sends_pings_when_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []

    class FakeSocket:
        async def send_text(self, text: str) -> None:
            sent.append(text)

    monkeypatch.setattr(realtime_socket, "PING_EVERY_SECONDS", 0.01)
    conn = Connection(websocket=FakeSocket(), user_id=1, account_id=1, scopes={})  # type: ignore[arg-type]
    task = asyncio.create_task(realtime_socket._writer(conn))
    await asyncio.sleep(0.05)
    conn.queue.put_nowait('{"type":"entry"}')
    await asyncio.sleep(0.02)
    conn.closed = True
    conn.queue.put_nowait("")
    await asyncio.wait_for(task, 1)
    assert '{"type":"ping"}' in sent and '{"type":"entry"}' in sent


async def test_bridge_queues_events_without_holding_the_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    from app.realtime.bridge import PostgresBridge

    bridge = PostgresBridge("postgresql+asyncpg://localhost/unused")
    sent: list[dict] = []
    network = asyncio.Event()

    async def slow_send(event: dict) -> None:
        await network.wait()  # a slow NOTIFY round trip
        sent.append(event)

    monkeypatch.setattr(bridge, "_send", slow_send)
    sender = asyncio.create_task(bridge._send_forever())
    try:
        # Returns at once even though sending is stuck.
        await asyncio.wait_for(bridge.notify({"n": 1}), timeout=0.05)
        await bridge.notify({"n": 2})
        assert sent == []
        network.set()
        for _ in range(10):
            await asyncio.sleep(0)
        assert sent == [{"n": 1}, {"n": 2}]  # in order
    finally:
        sender.cancel()
