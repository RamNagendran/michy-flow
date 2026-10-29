"""Trends, the oil KPI, purchase price history, trade analysis and the status summary."""

from httpx import AsyncClient

from tests.conftest import bearer, create_user, login_new_user
from tests.entry_helpers import TODAY, approve_new, party, production, purchase, sale, team

RANGE = "date_from=2026-09-01&date_to=2026-10-31"


async def test_trends_are_continuous_and_split_units(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    await purchase(client, t, t.admin, "1000", material="car")
    body = {
        "entry_date": TODAY,
        "material": "car",
        "outputs": [{"product": "oil", "qty": "400"}, {"product": "steel", "qty": "150"}],
    }
    made = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert (await approve_new(client, t, made)).status_code == 201
    rows = (
        await client.get(t.url(f"/trends?{RANGE}&bucket=month"), headers=bearer(t.admin))
    ).json()
    assert [r["period"] for r in rows] == ["2026-09-01", "2026-10-01"]
    sept, octo = rows
    assert sept["purchase_amount"] == 0
    assert octo["purchase_kg"] == 1000 and octo["processed_kg"] == 577  # 566 + 2%
    assert octo["output_kg"] == 566  # 400 L × 1.04 + 150 kg
    assert (
        await client.get(t.url(f"/trends?{RANGE}"), headers=bearer(t.operator))
    ).status_code == 403


async def test_oil_kpi_is_for_the_ceo_and_managers(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    await purchase(client, t, t.admin, "1000", material="truck")
    body = {
        "entry_date": TODAY,
        "material": "truck",
        "outputs": [{"product": "oil", "qty": "450"}, {"product": "carbon", "qty": "400"}],
    }
    await approve_new(
        client, t, await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    )
    url = t.url(f"/oil-kpi?{RANGE}&bucket=month")
    kpi = (await client.get(url, headers=bearer(t.manager))).json()
    # 450 L × 1.04 = 468 kg of oil from 885 kg used (868 kg out + 2%).
    assert kpi["pct"] == 52.88 and kpi["status"] == "green" and kpi["applicable"] is True
    assert (await client.get(url, headers=bearer(t.operator))).status_code == 403
    assert (await client.get(url, headers=bearer(t.finance))).status_code == 403
    ceo = await login_new_user(
        client, await create_user(client, t.super_admin, "ceo@example.com", global_role="ceo")
    )
    assert (await client.get(url, headers=bearer(ceo))).status_code == 200


async def test_price_history_compares_suppliers_with_the_average(client: AsyncClient) -> None:
    t = await team(client)
    cheap = await party(client, t, "supplier", "Kaveri Scrap")
    await purchase(client, t, t.admin, "1000", rate="15", n=1)  # Sri Balaji at ₹15
    await purchase(client, t, t.admin, "3000", rate="13", supplier_id=cheap, n=2)
    await purchase(client, t, t.admin, "500", rate="5", grade="C", n=3)  # paper only: ignored
    res = await client.get(
        t.url(f"/prices?item=truck&{RANGE}&bucket=month"), headers=bearer(t.finance)
    )
    assert res.status_code == 200, res.text
    h = res.json()
    assert h["avg_rate"] == 13.5 and h["qty"] == 4000  # (15000 + 39000) / 4000
    first, second = h["suppliers"]
    assert first["name"] == "Kaveri Scrap" and first["saving"] == 1500  # (13.5 − 13) × 3000
    assert round(second["diff_pct"], 2) == 11.11 and second["last_rate"] == 15
    assert h["series"][1]["suppliers"][str(cheap)] == 13
    assert (
        await client.get(t.url(f"/prices?item=truck&{RANGE}"), headers=bearer(t.operator))
    ).status_code == 403


async def test_trade_analysis_splits_by_item_supplier_and_grade(client: AsyncClient) -> None:
    t = await team(client)
    cheap = await party(client, t, "supplier", "Kaveri Scrap")
    await purchase(client, t, t.admin, "1000", rate="15", n=1)  # Sri Balaji, truck at ₹15
    await purchase(client, t, t.admin, "3000", rate="13", supplier_id=cheap, n=2)
    await purchase(client, t, t.admin, "500", rate="10", material="car", n=3)
    await purchase(client, t, t.admin, "200", rate="5", grade="C", n=4)  # bill only
    url = t.url(f"/trade-analysis?side=purchase&{RANGE}&bucket=month")

    res = await client.get(url, headers=bearer(t.finance))
    assert res.status_code == 200, res.text
    a = res.json()
    assert [p["period"] for p in a["series"]] == ["2026-09-01", "2026-10-01"]
    assert a["totals"] == {"bills": 3, "qty_kg": 4500, "qty_l": 0, "amount": 59000, "parties": 2}
    assert a["previous"]["bills"] == 0 and a["previous_to"] == "2026-08-31"
    truck, car = a["items"]  # biggest amount first
    assert truck["item"] == "truck" and (truck["min_rate"], truck["max_rate"]) == (13, 15)
    assert car["amount"] == 5000
    assert a["parties"][0]["name"] == "Kaveri Scrap" and a["parties"][0]["min_rate"] is None
    grades = {g["grade"]: g["amount"] for g in a["grades"]}
    assert grades == {"A": 59000, "B": 0, "C": 1000}  # the mix ignores the grade filter
    assert a["bills"] == []

    one = (await client.get(f"{url}&item=truck", headers=bearer(t.manager))).json()
    assert one["unit"] == "kg" and one["totals"]["amount"] == 54000
    rates = {p["name"]: (p["min_rate"], p["last_rate"]) for p in one["parties"]}
    assert rates == {"Kaveri Scrap": (13, 13), "Sri Balaji Tyres": (15, 15)}
    assert [b["rate"] for b in one["bills"]] == [15, 13]  # oldest first
    assert {(p["party_id"], p["qty"]) for p in one["party_series"]} == {
        (t.supplier, 1000),
        (cheap, 3000),
    }

    only = (
        await client.get(f"{url}&party_id={cheap}&grade=C&grade=A", headers=bearer(t.finance))
    ).json()
    assert only["totals"]["amount"] == 39000
    assert (await client.get(f"{url}&item=nope", headers=bearer(t.finance))).status_code == 422
    assert (await client.get(url, headers=bearer(t.operator))).status_code == 403


async def test_trade_analysis_of_sales_by_year(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    await production(client, t, t.admin, {"rubber": "600", "steel": "200"})
    await sale(client, t, t.admin, "100")  # rubber at ₹30 to Apex
    res = await client.get(
        t.url("/trade-analysis?side=sale&date_from=2025-01-01&date_to=2026-10-31&bucket=year"),
        headers=bearer(t.finance),
    )
    assert res.status_code == 200, res.text
    a = res.json()
    assert [p["period"] for p in a["series"]] == ["2025-01-01", "2026-01-01"]
    assert a["series"][1]["amount"] == 3000 and a["parties"][0]["name"] == "Apex Mouldings"
    assert a["items"][0]["item"] == "rubber"


async def test_long_ranges_fall_back_to_years(client: AsyncClient) -> None:
    t = await team(client)
    url = t.url("/trends?date_from=2020-01-01&date_to=2026-10-31")  # no bucket: picked for us
    rows = (await client.get(url, headers=bearer(t.finance))).json()
    assert [r["period"][:4] for r in rows] == [str(y) for y in range(2020, 2027)]
    too_long = t.url("/trends?date_from=2015-01-01&date_to=2026-10-31&bucket=year")
    assert (await client.get(too_long, headers=bearer(t.finance))).status_code == 422


async def test_status_summary_follows_visibility(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.operator, "100", n=1, approve=False)
    await purchase(client, t, t.operator2, "200", n=2, approve=False)
    await purchase(client, t, t.admin, "300", n=3)
    url = "/entries/status-summary?type=purchase"
    mine = {s["status"]: s for s in (await client.get(url, headers=bearer(t.operator))).json()}
    assert mine["pending"]["count"] == 1 and mine["approved"]["count"] == 0
    everyone = {s["status"]: s for s in (await client.get(url, headers=bearer(t.admin))).json()}
    assert everyone["pending"]["count"] == 2 and everyone["approved"]["amount"] == 4350
