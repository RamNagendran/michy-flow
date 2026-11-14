"""The audit trail: every change, who made it, old and new values, and its filters."""

from httpx import AsyncClient

from app.core.clock import today
from tests.conftest import bearer, make_gstin
from tests.entry_helpers import purchase, team


async def _logs(client: AsyncClient, token: str, query: str = "") -> list[dict]:
    res = await client.get(f"/audit-logs?page_size=200&{query}", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()["items"]


async def test_edits_keep_the_old_and_new_values(client: AsyncClient) -> None:
    t = await team(client)
    body = {
        "kind": "supplier",
        "name": "Sri Balaji Tyres",
        "gstin": make_gstin("supplier-Sri Balaji Tyres"),
    }
    res = await client.put(
        t.url(f"/parties/{t.supplier}"),
        json={**body, "name": "Balaji Tyres"},
        headers=bearer(t.manager),
    )
    assert res.status_code == 200, res.text
    log = (await _logs(client, t.super_admin, "area=parties"))[0]
    assert log["action"] == "party_updated" and log["company_name"] == t.company["name"]
    assert log["details"]["changes"] == {"name": ["Sri Balaji Tyres", "Balaji Tyres"]}


async def test_stock_check_is_in_the_audit_trail(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    body = {"lines": [{"section": "raw", "item": "truck", "counted_qty": "950"}]}
    assert (
        await client.post(t.url("/stock-checks"), json=body, headers=bearer(t.admin))
    ).status_code == 201
    log = (await _logs(client, t.super_admin, "area=wastage"))[0]
    assert log["action"] == "stock_counted"
    book, counted = log["details"]["differences"]["truck"]
    assert (float(book), float(counted)) == (1000, 950)


async def test_filters_by_person_area_date_and_search(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, approve=False)).json()
    me = (await client.get("/auth/me", headers=bearer(t.operator))).json()
    mine = await _logs(client, t.super_admin, f"actor_id={me['id']}&area=entries")
    assert mine and all(log["actor_id"] == me["id"] for log in mine)
    assert [log["action"] for log in mine] == ["entry.created"]
    assert await _logs(client, t.super_admin, f"q={entry['ref_no']}")
    day = today().isoformat()  # when it was logged, not the entry's date
    assert await _logs(client, t.super_admin, f"date_from={day}&date_to={day}")
    assert not await _logs(client, t.super_admin, "date_from=2000-01-01&date_to=2000-01-02")
    signins = await _logs(client, t.super_admin, "area=sign_in")
    assert signins and {log["action"] for log in signins} <= {
        "login",
        "login_failed",
        "password_changed",
        "password_reset",
    }
