"""Wastage limits, stock checks, configuration and operators on a shift. The monthly wastage
approval is in test_wastage_months.py."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import TODAY, act, as_old_run, production, purchase, stock_of, team


async def test_old_runs_over_the_limit_are_approved_without_a_debit_note(
    client: AsyncClient,
) -> None:
    """Debit notes are only for purchases now; production keeps the comments."""
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    run = (await production(client, t, t.admin, {"rubber": "900"})).json()
    assert run["wastage_pct"] == 0 and "debit_note_required" not in run
    await as_old_run(run, "5")
    assert (await act(client, t, t.manager, run, "approve")).status_code == 200
    gone = await client.post(
        t.url(f"/production/{run['id']}/debit-note"), json={}, headers=bearer(t.manager)
    )
    assert gone.status_code in (404, 405)
    assert (
        await client.get(t.url("/debit-notes/pending"), headers=bearer(t.manager))
    ).status_code in (404, 405, 422)


async def test_stock_check_adjusts_the_book_stock(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    body = {
        "counted_on": TODAY,
        "lines": [{"section": "raw", "item": "truck", "counted_qty": "950"}],
    }
    url = t.url("/stock-checks")
    # Only the Super Admin counts the stock.
    for someone in (t.finance, t.manager):
        assert (await client.post(url, json=body, headers=bearer(someone))).status_code == 403
    res = await client.post(url, json=body, headers=bearer(t.admin))
    assert res.status_code == 201, res.text

    line = await stock_of(client, t, "truck")
    assert line["provisional"]["balance"] == 950 and line["counted_adjustment"] == 50
    stock = (await client.get(t.url("/stock"), headers=bearer(t.admin))).json()
    assert stock["last_check_on"] == TODAY and stock["check_every_months"] == 1
    history = (await client.get(url, headers=bearer(t.admin))).json()
    assert history[0]["lines"][0]["difference"] == 50
    unknown = {**body, "lines": [{"section": "output", "item": "oil", "counted_qty": "1"}]}
    assert (await client.post(url, json=unknown, headers=bearer(t.admin))).status_code == 422


async def test_super_admin_configures_items_and_kg_per_litre(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    config = {
        "input_items": ["truck", "car", "rubber"],
        "output_items": ["oil", "carbon", "steel", "waste"],
        "kg_per_litre": {"oil": "1.050"},
        "stock_check_months": 3,
    }
    url = t.url("/config")
    assert (await client.put(url, json=config, headers=bearer(t.manager))).status_code == 403
    for bad_factor in ({"oil": "2.5"}, {"carbon": "1.0"}, {"rubber": "1.0"}):
        bad = {**config, "kg_per_litre": bad_factor}
        res = await client.put(url, json=bad, headers=bearer(t.super_admin))
        assert res.status_code == 422, bad_factor
    res = await client.put(url, json=config, headers=bearer(t.super_admin))
    assert res.status_code == 200 and res.json()["input_items"] == ["truck", "car", "rubber"]

    # Rubber is now raw material here; oil is weighed at the company's own number.
    assert (await purchase(client, t, t.admin, "1000", material="rubber")).status_code == 201
    body = {
        "entry_date": TODAY,
        "material": "rubber",
        "outputs": [{"product": "oil", "qty": "900"}],
    }
    run = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert run.status_code == 201, run.text
    assert run.json()["output_kg"] == 945  # 900 L × 1.05
    stock = (await client.get(t.url("/stock"), headers=bearer(t.admin))).json()
    assert stock["check_every_months"] == 3

    # With no number of its own, the company uses the item's (oil: 1.040).
    res = await client.put(url, json={**config, "kg_per_litre": {}}, headers=bearer(t.super_admin))
    assert res.status_code == 200 and res.json()["kg_per_litre"] == {}
    run = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert run.json()["output_kg"] == 936  # 900 L × 1.04
    res = await client.put(url, json=config, headers=bearer(t.super_admin))

    # Left out, the company's saved numbers are kept.
    no_oil = {"input_items": ["truck"], "output_items": ["steel"], "stock_check_months": 1}
    res = await client.put(url, json=no_oil, headers=bearer(t.super_admin))
    assert res.status_code == 200, res.text
    assert res.json()["kg_per_litre"] == {"oil": 1.05}
    only_waste = {**no_oil, "output_items": ["waste"]}
    assert (
        await client.put(url, json=only_waste, headers=bearer(t.super_admin))
    ).status_code == 422


async def test_production_in_charge_picks_the_crew(client: AsyncClient) -> None:
    t = await team(client)
    url = t.url("/operators")
    assert (await client.get(url, headers=bearer(t.operator))).json() == []
    # The in-charge adds operators by name and shift, with no login.
    res = await client.post(
        url, json={"name": "  Murugan  ", "shift": 2}, headers=bearer(t.operator)
    )
    assert res.status_code == 201, res.text
    assert res.json()["name"] == "Murugan" and res.json()["shift"] == 2
    dup = await client.post(url, json={"name": "murugan", "shift": 1}, headers=bearer(t.operator))
    assert dup.status_code == 409
    assert (
        await client.post(url, json={"name": "Ravi", "shift": 4}, headers=bearer(t.operator))
    ).status_code == 422
    finance = await client.post(url, json={"name": "Ravi", "shift": 1}, headers=bearer(t.finance))
    assert finance.status_code == 403
    assert (await client.get(url, headers=bearer(t.finance))).status_code == 403
    crew = (await client.get(url, headers=bearer(t.admin))).json()
    ops = {c["id"] for c in crew}
    assert [c["name"] for c in crew] == ["Murugan"]

    await purchase(client, t, t.admin, "1000")
    body = {
        "entry_date": TODAY,
        "material": "truck",
        "shift": 2,
        "crew_ids": sorted(ops),
        "running_hours": "6",
        # 941 kg out + 19 kg wastage = 960 kg used.
        "outputs": [{"product": "rubber", "qty": "700"}, {"product": "steel", "qty": "241"}],
        "wastage_kg": "19",
        "wastage_type": "liquid",
    }
    res = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["efficiency_pct"] == 75.0 and run["kg_per_hour"] == 160.0
    assert {c["id"] for c in run["crew"]} == ops

    stranger = {**body, "crew_ids": [max(ops) + 1]}
    bad = await client.post(t.url("/production"), json=stranger, headers=bearer(t.admin))
    assert bad.status_code == 422 and bad.json()["code"] == "unknown_operator"

    report = (
        await client.get(
            t.url(f"/production-report?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
        )
    ).json()
    assert report["by_shift"][0]["shift"] == 2 and report["by_shift"][0]["efficiency_pct"] == 75.0
    assert {o["operator_id"] for o in report["by_operator"]} == ops
    assert report["by_operator"][0]["processed_kg"] == 960
