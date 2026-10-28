"""Trends, the oil KPI, purchase price history and the status summary."""

from httpx import AsyncClient

from tests.conftest import bearer, create_user, login_new_user
from tests.entry_helpers import TODAY, approve_new, party, purchase, team

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
