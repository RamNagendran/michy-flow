"""Wastage limits, debit notes, monthly allowances, stock checks, escalation, configuration
and shift crews."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, act, as_old_run, production, purchase, stock_of, team


async def _me(client: AsyncClient, token: str) -> int:
    return (await client.get("/auth/me", headers=bearer(token))).json()["id"]


async def _note(client: AsyncClient, t: Team, run: dict, token: str, no: str = "DN-1"):  # noqa: ANN202
    body = {
        "note_no": no,
        "supplier_id": t.supplier,
        "qty_kg": "50",
        "amount": "725",
        "reason": "Wet tyres",
    }
    return await client.post(
        t.url(f"/production/{run['id']}/debit-note"), json=body, headers=bearer(token)
    )


async def test_runs_over_the_limit_need_a_debit_note(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    run = (await production(client, t, t.admin, {"rubber": "900"})).json()
    # New runs always have 2% wastage; a run saved before that rule can be over the limit.
    await as_old_run(run, "5")
    run = (
        await client.get(t.url(f"/entries/production/{run['id']}"), headers=bearer(t.admin))
    ).json()
    assert run["debit_note_required"] is True and run["status"] == "pending"
    blocked = await act(client, t, t.admin, run, "approve")
    assert blocked.status_code == 409 and blocked.json()["code"] == "debit_note_required"

    pending = (await client.get(t.url("/debit-notes/pending"), headers=bearer(t.admin))).json()
    assert [p["ref_no"] for p in pending] == [run["ref_no"]]
    assert (await _note(client, t, run, t.operator)).status_code == 403
    noted = await _note(client, t, run, t.admin)
    assert noted.status_code == 201, noted.text
    assert noted.json()["debit_note"]["note_no"] == "DN-1"
    assert (await _note(client, t, run, t.admin, "DN-2")).status_code == 409
    assert (await act(client, t, t.admin, run, "approve")).status_code == 200
    summary = await client.get(
        t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
    )
    assert summary.json()["queue"]["debit_notes_due"] == 0


async def test_runs_within_the_limit_need_no_note(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    run = (await production(client, t, t.admin, {"rubber": "900"})).json()
    assert run["wastage_pct"] == 2.0
    assert run["debit_note_required"] is False and run["status"] == "approved"
    assert (await _note(client, t, run, t.admin)).status_code == 409


async def test_monthly_allowance_flags_runs_over_it(client: AsyncClient) -> None:
    t = await team(client)
    body = {"month": TODAY, "pct": "1.5", "note": "Monsoon stock"}
    url = t.url("/wastage/allowances")
    assert (await client.put(url, json=body, headers=bearer(t.operator))).status_code == 403
    too_high = {**body, "pct": "2.5"}
    assert (await client.put(url, json=too_high, headers=bearer(t.admin))).status_code == 422
    assert (await client.put(url, json=body, headers=bearer(t.admin))).status_code == 204

    await purchase(client, t, t.admin, "1000")
    run = (await production(client, t, t.admin, {"rubber": "900"})).json()
    # 2%: over this month's 1.5% allowance, but not over the 2% hard limit.
    assert run["wastage_flagged"] is True and run["debit_note_required"] is False
    assert run["wastage_allowance_pct"] == 1.5
    months = (
        await client.get(
            t.url(f"/wastage?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
        )
    ).json()
    assert months[0]["declared"] is True and months[0]["flagged_runs"] == 1
    assert months[0]["over_allowance"] is True and months[0]["high_runs"] == 0


async def test_stock_check_adjusts_the_book_stock(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "1000")
    body = {
        "counted_on": TODAY,
        "lines": [{"section": "raw", "item": "truck", "counted_qty": "950"}],
    }
    url = t.url("/stock-checks")
    assert (await client.post(url, json=body, headers=bearer(t.manager))).status_code == 403
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


async def test_finance_escalates_and_the_admin_resolves(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, "1000")).json()
    one = t.url(f"/entries/purchase/{entry['id']}")
    note = {"comment": "Weighbridge slip says 980 kg"}
    assert (
        await client.post(f"{one}/escalate", json=note, headers=bearer(t.operator))
    ).status_code == 403
    raised = await client.post(f"{one}/escalate", json=note, headers=bearer(t.finance))
    assert raised.status_code == 200 and raised.json()["escalated_at"]
    assert "resolve" in (await client.get(one, headers=bearer(t.admin))).json()["actions"]

    listed = (await client.get("/entries?escalated=true", headers=bearer(t.admin))).json()
    assert [r["ref_no"] for r in listed["items"]] == [entry["ref_no"]]
    done = await client.post(
        f"{one}/resolve", json={"comment": "Corrected"}, headers=bearer(t.admin)
    )
    assert done.status_code == 200 and done.json()["escalated_at"] is None
    assert done.json()["events"][-1]["action"] == "resolved"


async def test_super_admin_configures_items_and_density(client: AsyncClient) -> None:
    t = await team(client, "pyrolysis")
    config = {
        "input_items": ["truck", "car", "rubber"],
        "output_items": ["oil", "carbon", "steel", "waste"],
        "oil_density": "1.050",
        "stock_check_months": 3,
    }
    url = t.url("/config")
    assert (await client.put(url, json=config, headers=bearer(t.admin))).status_code == 403
    bad = {**config, "oil_density": "0.920"}
    assert (await client.put(url, json=bad, headers=bearer(t.super_admin))).status_code == 422
    res = await client.put(url, json=config, headers=bearer(t.super_admin))
    assert res.status_code == 200 and res.json()["input_items"] == ["truck", "car", "rubber"]

    # Rubber is now raw material here; oil is weighed at the new density.
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

    # Without oil the form has no density to send: the saved factor is kept.
    no_oil = {"input_items": ["truck"], "output_items": ["steel"], "stock_check_months": 1}
    res = await client.put(url, json=no_oil, headers=bearer(t.super_admin))
    assert res.status_code == 200, res.text
    assert res.json()["oil_density"] == 1.05
    only_waste = {**no_oil, "output_items": ["waste"]}
    assert (
        await client.put(url, json=only_waste, headers=bearer(t.super_admin))
    ).status_code == 422


async def test_production_in_charge_picks_the_crew(client: AsyncClient) -> None:
    t = await team(client)
    crew = (await client.get(t.url("/crew"), headers=bearer(t.admin))).json()
    # Only operators ticked as shift workers; a production operator without it is left out.
    ops = {await _me(client, t.operator2)}
    assert {c["id"] for c in crew} == ops
    assert (await client.get(t.url("/crew"), headers=bearer(t.finance))).status_code == 403

    await purchase(client, t, t.admin, "1000")
    body = {
        "entry_date": TODAY,
        "material": "truck",
        "shift": 2,
        "crew_ids": sorted(ops),
        "running_hours": "6",
        # 941 kg out + 2% = 960 kg used.
        "outputs": [{"product": "rubber", "qty": "700"}, {"product": "steel", "qty": "241"}],
    }
    res = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["efficiency_pct"] == 75.0 and run["kg_per_hour"] == 160.0
    assert {c["id"] for c in run["crew"]} == ops

    for outsider in (t.admin, t.operator):
        stranger = {**body, "crew_ids": [await _me(client, outsider)]}
        bad = await client.post(t.url("/production"), json=stranger, headers=bearer(t.admin))
        assert bad.status_code == 422 and bad.json()["code"] == "unknown_operator"

    report = (
        await client.get(
            t.url(f"/production-report?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.admin)
        )
    ).json()
    assert report["by_shift"][0]["shift"] == 2 and report["by_shift"][0]["efficiency_pct"] == 75.0
    assert {o["user_id"] for o in report["by_operator"]} == ops
    assert report["by_operator"][0]["processed_kg"] == 960
