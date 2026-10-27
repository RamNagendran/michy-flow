"""An operator only reaches the parts of the API their ticked duties need."""

from httpx import AsyncClient

from tests.conftest import bearer, create_user, login_new_user
from tests.entry_helpers import Team, production, purchase, sale, team


async def _operator(client: AsyncClient, t: Team, duties: list[str]) -> tuple[int, str]:
    m = [{"company_id": t.company["id"], "role": "operator", "duties": duties}]
    created = await create_user(client, t.super_admin, "limited@example.com", memberships=m)
    return created["user"]["id"], await login_new_user(client, created)


async def test_purchase_only_operator_reaches_only_purchases(client: AsyncClient) -> None:
    t = await team(client)
    _, ops = await _operator(client, t, ["purchase"])
    h = bearer(ops)

    assert (await purchase(client, t, ops)).status_code == 201
    assert (await sale(client, t, ops, "10")).status_code == 403
    assert (await production(client, t, ops, {"rubber": "60"})).status_code == 403

    listed = (await client.get("/entries", headers=h)).json()
    assert listed["total"] == 1
    assert {row["type"] for row in listed["items"]} == {"purchase"}

    # No stock or company-wide figures.
    assert (await client.get(t.url("/stock"), headers=h)).status_code == 403
    summary = await client.get(
        t.url("/summary"), params={"date_from": "2026-10-01", "date_to": "2026-10-31"}, headers=h
    )
    assert summary.status_code == 403

    # Suppliers for the purchase form, but not buyers.
    parties = (await client.get(t.url("/parties"), headers=h)).json()
    assert {p["kind"] for p in parties} == {"supplier"}
    assert (await client.get(t.url("/parties?kind=buyer"), headers=h)).status_code == 403


async def test_taking_a_duty_away_hides_entries_of_that_kind(client: AsyncClient) -> None:
    t = await team(client)
    user_id, ops = await _operator(client, t, ["purchase"])
    entry = (await purchase(client, t, ops)).json()

    res = await client.put(
        f"/users/{user_id}/access",
        json={
            "memberships": [
                {"company_id": t.company["id"], "role": "operator", "duties": ["sales"]}
            ]
        },
        headers=bearer(t.super_admin),
    )
    assert res.status_code == 200, res.text
    login = await client.post(
        "/auth/login", json={"email": "limited@example.com", "password": "a-proper-password"}
    )
    h = bearer(login.json()["access_token"])

    assert (await client.get("/entries", headers=h)).json()["total"] == 0
    detail = await client.get(t.url(f"/entries/purchase/{entry['id']}"), headers=h)
    assert detail.status_code == 404
    # A sales operator needs stock and buyers for the sale form.
    assert (await client.get(t.url("/stock"), headers=h)).status_code == 200
    parties = (await client.get(t.url("/parties"), headers=h)).json()
    assert {p["kind"] for p in parties} == {"buyer"}


async def test_office_roles_still_see_stock(client: AsyncClient) -> None:
    t = await team(client)
    for token in (t.manager, t.admin, t.finance, t.super_admin):
        assert (await client.get(t.url("/stock"), headers=bearer(token))).status_code == 200
