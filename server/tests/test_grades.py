"""Grades A, B and C: what each may carry, and that their stocks never mix."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, production, purchase, sale, stock_of, team


async def _sale(client: AsyncClient, t: Team, item: str, qty: str, invoice: str, **extra):  # noqa: ANN001, ANN202
    body = {
        "entry_date": TODAY,
        "buyer_id": t.buyer,
        "product": item,
        "qty": qty,
        "rate": "20",
        "invoice_no": invoice,
        **extra,
    }
    return await client.post(t.url("/sales"), json=body, headers=bearer(t.admin))


async def test_grades_default_sensibly(client: AsyncClient) -> None:
    t = await team(client)
    bought = (await purchase(client, t, t.admin, "1000")).json()
    assert bought["grade"] == "A"
    await production(client, t, t.admin, {"rubber": "900"})
    assert (await sale(client, t, t.admin, "100")).json()["grade"] == "A"
    resold = await purchase(client, t, t.admin, "500", grade="B", n=2)
    assert resold.json()["grade"] == "B"
    # Selling tyres without a grade means re-selling them.
    tyres = await _sale(client, t, "truck", "200", "MR/2")
    assert tyres.status_code == 201, tyres.text
    assert tyres.json()["grade"] == "B"


async def test_each_grade_carries_only_its_items(client: AsyncClient) -> None:
    t = await team(client)
    bad_purchase = await purchase(client, t, t.admin, "100", material="rubber")
    assert bad_purchase.status_code == 422
    bad_sale = await _sale(client, t, "truck", "10", "MR/9", grade="A")
    assert bad_sale.status_code == 422
    # Grade C may record any item.
    books = await purchase(client, t, t.admin, "100", material="rubber", grade="C")
    assert books.status_code == 201, books.text


async def test_resale_tyres_cannot_go_into_production(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000", grade="B")
    made = await production(client, t, t.admin, {"rubber": "450"})
    assert made.status_code == 409
    assert "Grade A truck" in made.json()["detail"]

    assert (await _sale(client, t, "truck", "400", "MR/1")).status_code == 201
    assert (await stock_of(client, t, "truck", "resale"))["provisional"]["balance"] == 600
    assert (await stock_of(client, t, "truck", "raw"))["provisional"]["balance"] == 0
    too_much = await _sale(client, t, "truck", "601", "MR/2")
    assert too_much.status_code == 409


async def test_grade_c_is_a_separate_book_stock(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "300", material="rubber", grade="C")
    # Grade C rubber is not physical stock, so it cannot be sold as Grade A.
    assert (await sale(client, t, t.admin, "100")).status_code == 409
    assert (await _sale(client, t, "rubber", "200", "MR/1", grade="C")).status_code == 201
    books = await stock_of(client, t, "rubber", "books")
    assert books["provisional"]["balance"] == 100 and books["grade"] == "C"
    assert (await stock_of(client, t, "rubber", "output"))["provisional"]["balance"] == 0
    assert (await _sale(client, t, "rubber", "101", "MR/2", grade="C")).status_code == 409


async def test_admin_can_reclassify_a_purchase(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, "1000", grade="B")).json()
    body = {
        "entry_date": TODAY,
        "supplier_id": t.supplier,
        "material": "truck",
        "qty": "1000",
        "rate": "14.5",
        "invoice_no": entry["invoice_no"],
        "comment": "Going to the plant",
    }
    url = t.url(f"/purchases/{entry['id']}")
    # Edits must say the grade, so leaving it out never moves the entry by accident.
    assert (await client.put(url, json=body, headers=bearer(t.admin))).status_code == 422
    res = await client.put(url, json={**body, "grade": "A"}, headers=bearer(t.admin))
    assert res.status_code == 200, res.text
    assert res.json()["grade"] == "A"
    assert res.json()["events"][-1]["changes"]["grade"] == ["B", "A"]
    assert (await production(client, t, t.admin, {"rubber": "450"})).status_code == 201


async def test_lists_and_totals_split_by_grade(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    await purchase(client, t, t.admin, "500", grade="B", n=2)
    await purchase(client, t, t.admin, "200", grade="C", n=3)
    await production(client, t, t.admin, {"rubber": "900"})

    rows = (await client.get("/entries?grade=B", headers=bearer(t.admin))).json()["items"]
    assert [(r["type"], r["grade"]) for r in rows] == [("purchase", "B")]
    made = (await client.get("/entries?type=production", headers=bearer(t.admin))).json()
    assert made["items"][0]["grade"] == "A"

    summary = (
        await client.get(
            t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
        )
    ).json()
    by_grade = {g["grade"]: g for g in summary["purchases"]["by_grade"]}
    assert [g["grade"] for g in summary["purchases"]["by_grade"]] == ["A", "B", "C"]
    assert (by_grade["A"]["qty_kg"], by_grade["B"]["qty_kg"], by_grade["C"]["qty_kg"]) == (
        1000,
        500,
        200,
    )
    assert summary["purchases"]["qty_kg"] == 1700
    assert summary["sales"]["by_grade"][2] == {
        "grade": "C",
        "count": 0,
        "qty_kg": 0,
        "qty_l": 0,
        "amount": 0,
    }
