"""Entry input rules, wastage, visibility, listing, summaries and parties."""

from httpx import AsyncClient

from tests.conftest import bearer, create_company
from tests.entry_helpers import TODAY, act, party, production, purchase, sale, team


async def test_production_works_out_wastage(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.operator, qty="1000")
    res = await production(client, t, t.operator, "1000", {"rubber": "620", "steel": "350"})
    assert res.status_code == 201, res.text
    p = res.json()
    assert p["output_kg"] == 970
    assert p["wastage_kg"] == 30
    assert p["wastage_pct"] == 3.0
    assert p["wastage_flagged"] is True  # over 2%
    assert p["ref_no"] == "PRD-MR-00001"


async def test_production_input_rules(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.operator, qty="1000")
    # More out than in.
    assert (await production(client, t, t.operator, "500", {"rubber": "600"})).status_code == 422
    # Nothing out.
    assert (await production(client, t, t.operator, "500", {"rubber": "0"})).status_code == 422
    # More in than is in stock.
    res = await production(client, t, t.operator, "1500", {"rubber": "900"})
    assert res.status_code == 409


async def test_input_validation(client: AsyncClient) -> None:
    t = await team(client)
    bad = [
        {"qty": "0"},
        {"qty": "-5"},
        {"qty": "1.2345"},  # more than gram precision
        {"rate": "-1"},
        {"material": "plastic"},
        {"entry_date": "2099-01-01"},
        {"invoice_no": "   "},
    ]
    for extra in bad:
        res = await purchase(client, t, t.operator, **extra)
        assert res.status_code == 422, extra


async def test_duplicate_bill_is_refused(client: AsyncClient) -> None:
    t = await team(client)
    first = await purchase(client, t, t.operator, invoice_no="sbt/26-27/0042")
    assert first.status_code == 201
    dup = await purchase(client, t, t.operator, invoice_no="SBT/26-27/0042")
    assert dup.status_code == 409
    assert dup.json()["code"] == "duplicate_entry"
    # A rejected bill can be entered again.
    await act(client, t, t.admin, first.json(), "reject", "Wrong rate")
    assert (await purchase(client, t, t.operator, invoice_no="SBT/26-27/0042")).status_code == 201


async def test_party_must_belong_to_the_company(client: AsyncClient) -> None:
    t = await team(client)
    other = await create_company(client, t.super_admin, code="ES")
    res = await client.post(
        f"/companies/{other['id']}/parties",
        json={"kind": "supplier", "name": "Elsewhere"},
        headers=bearer(t.super_admin),
    )
    foreign = res.json()["id"]
    assert (await purchase(client, t, t.operator, supplier_id=foreign)).status_code == 400
    # A buyer is not a supplier.
    assert (await purchase(client, t, t.operator, supplier_id=t.buyer)).status_code == 400


async def test_operators_see_only_their_own_entries(client: AsyncClient) -> None:
    t = await team(client)
    mine = (await purchase(client, t, t.operator, n=1)).json()
    theirs = (await purchase(client, t, t.operator2, n=2)).json()

    listed = (await client.get("/entries", headers=bearer(t.operator))).json()
    assert [e["ref_no"] for e in listed["items"]] == [mine["ref_no"]]
    hidden = await client.get(
        t.url(f"/entries/purchase/{theirs['id']}"), headers=bearer(t.operator)
    )
    assert hidden.status_code == 404
    # Operators do not see company-wide money figures.
    summary = await client.get(
        t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.operator)
    )
    assert summary.status_code == 403

    everything = (await client.get("/entries", headers=bearer(t.admin))).json()
    assert everything["total"] == 2


async def test_entry_list_filters(client: AsyncClient) -> None:
    t = await team(client)
    p = (await purchase(client, t, t.admin, qty="2000", invoice_no="ABC-1")).json()
    await production(client, t, t.admin, "1000", {"rubber": "600", "steel": "300"})
    await sale(client, t, t.admin, "100", invoice="MR/77")
    await act(client, t, t.finance, p, "verify")

    def get(query: str) -> dict:
        return client.get(f"/entries?{query}", headers=bearer(t.admin))

    assert (await get("")).json()["total"] == 3
    assert [e["type"] for e in (await get("type=sale")).json()["items"]] == ["sale"]
    assert (await get("type=purchase&type=sale")).json()["total"] == 2
    assert (await get("status=verified")).json()["items"][0]["ref_no"] == p["ref_no"]
    assert (await get("q=abc")).json()["total"] == 1
    assert (await get("q=Apex")).json()["total"] == 1  # buyer name
    assert (await get("q=100%25")).json()["total"] == 0  # % is literal, not a wildcard
    assert (await get("date_from=2026-10-02")).json()["total"] == 0
    page = (await get("page_size=2&page=2")).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    row = (await get("type=production")).json()["items"][0]
    assert row["output_kg"] == 900 and row["wastage_pct"] == 10.0


async def test_summary_counts_pending_but_tracks_verified_money(client: AsyncClient) -> None:
    t = await team(client)
    p1 = (await purchase(client, t, t.admin, qty="1000", n=1)).json()
    await purchase(client, t, t.operator, qty="500", n=2)
    await act(client, t, t.finance, p1, "verify")
    res = await client.get(
        t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.finance)
    )
    s = res.json()
    assert s["purchases"]["count"] == 2
    assert s["purchases"]["qty_kg"] == 1500
    assert s["purchases"]["amount"] == 21750
    assert s["purchases"]["verified_amount"] == 14500
    assert s["queue"] == {
        "pending": 1,
        "approved": 0,
        "on_hold": 0,
        "escalated": 0,
        "debit_notes_due": 0,
    }


async def test_delete_is_soft_and_admin_only(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()
    url = t.url(f"/entries/purchase/{entry['id']}")
    assert (await client.delete(url, headers=bearer(t.manager))).status_code == 403
    assert (await client.delete(url + "?reason=typo", headers=bearer(t.admin))).status_code == 204
    assert (await client.get(url, headers=bearer(t.admin))).status_code == 404
    assert (await client.get("/entries", headers=bearer(t.admin))).json()["total"] == 0


async def test_parties_are_managed_by_manager_and_admin(client: AsyncClient) -> None:
    t = await team(client)
    body = {
        "kind": "supplier",
        "name": "Kaveri Scrap",
        "phone": "+91 94433 51902",
    }
    assert (
        await client.post(t.url("/parties"), json=body, headers=bearer(t.operator))
    ).status_code == 403
    assert (
        await client.post(t.url("/parties"), json=body, headers=bearer(t.finance))
    ).status_code == 403
    created = await client.post(t.url("/parties"), json=body, headers=bearer(t.admin))
    assert created.status_code == 201
    assert "gstin" not in created.json()
    dup = await client.post(
        t.url("/parties"), json={**body, "name": " kaveri SCRAP "}, headers=bearer(t.manager)
    )
    assert dup.status_code == 409
    listed = await client.get(t.url("/parties?kind=supplier"), headers=bearer(t.operator))
    assert {p["name"] for p in listed.json()} == {"Sri Balaji Tyres", "Kaveri Scrap"}


async def test_inactive_party_cannot_be_chosen(client: AsyncClient) -> None:
    t = await team(client)
    pid = await party(client, t, "supplier", "Old Supplier")
    await client.put(
        t.url(f"/parties/{pid}"),
        json={"kind": "supplier", "name": "Old Supplier", "is_active": False},
        headers=bearer(t.manager),
    )
    res = await purchase(client, t, t.operator, supplier_id=pid)
    assert res.status_code == 400
    assert res.json()["code"] == "inactive_party"
