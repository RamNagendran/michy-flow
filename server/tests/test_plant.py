"""Operators and machines: the Manager keeps the lists, the in-charge picks from them, and only
the Manager and Super Admin see how each one performed."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import TODAY, purchase, team

REPORT = f"/plant-report?date_from={TODAY}&date_to={TODAY}"


async def test_the_manager_keeps_operators_and_machines(client: AsyncClient) -> None:
    t = await team(client)
    url = t.url("/operators")
    names = lambda res: [o["name"] for o in res.json()]  # noqa: E731
    assert names(await client.get(url, headers=bearer(t.operator))) == ["Selvam"]
    res = await client.post(
        url,
        json={"name": "  Murugan  ", "phone": "94433 51902", "email": "", "shift": 2},
        headers=bearer(t.manager),
    )
    assert res.status_code == 201, res.text
    murugan = res.json()
    assert murugan["name"] == "Murugan" and murugan["email"] is None and murugan["is_active"]
    dup = {"name": "murugan", "phone": "1"}
    assert (await client.post(url, json=dup, headers=bearer(t.manager))).status_code == 409
    no_phone = {"name": "Ravi", "phone": ""}
    assert (await client.post(url, json=no_phone, headers=bearer(t.manager))).status_code == 422
    bad_mail = {"name": "Ravi", "phone": "1", "email": "ravi"}
    assert (await client.post(url, json=bad_mail, headers=bearer(t.manager))).status_code == 422
    # The in-charge and Finance cannot add; Finance cannot even read the list.
    ravi = {"name": "Ravi", "phone": "1"}
    assert (await client.post(url, json=ravi, headers=bearer(t.operator))).status_code == 403
    assert (await client.post(url, json=ravi, headers=bearer(t.finance))).status_code == 403
    assert (await client.get(url, headers=bearer(t.finance))).status_code == 403

    # Inactive operators drop off the in-charge's list but stay on the Manager's.
    off = {"name": "Murugan", "phone": "94433 51902", "is_active": False}
    res = await client.put(f"{url}/{murugan['id']}", json=off, headers=bearer(t.manager))
    assert res.status_code == 200 and not res.json()["is_active"]
    assert names(await client.get(url, headers=bearer(t.operator))) == ["Selvam"]
    assert len((await client.get(url, headers=bearer(t.manager))).json()) == 2

    machines = t.url("/machines")
    taken = {"code": "m-01 ", "name": "Another"}
    res = await client.post(machines, json=taken, headers=bearer(t.manager))
    assert res.status_code == 409
    listed = (await client.get(machines, headers=bearer(t.operator))).json()
    assert [(m["code"], m["name"]) for m in listed] == [("M-01", "Pyrolysis 1")]


async def test_every_run_names_a_machine_and_the_report_credits_it(client: AsyncClient) -> None:
    t = await team(client)
    ops = []
    for name in ("Murugan", "Ravi"):
        body = {"name": name, "phone": "1"}
        res = await client.post(t.url("/operators"), json=body, headers=bearer(t.manager))
        ops.append(res.json()["id"])
    res = await client.post(
        t.url("/machines"), json={"code": "M-02", "name": "Cracker 2"}, headers=bearer(t.manager)
    )
    second = res.json()["id"]

    await purchase(client, t, t.admin, "1000")
    body = {
        "entry_date": TODAY,
        "material": "truck",
        "shift": 2,
        "crew_ids": ops,
        "machine_id": t.machine,
        "running_hours": "6",
        # 941 kg out + 19 kg wastage = 960 kg used.
        "outputs": [{"product": "rubber", "qty": "700"}, {"product": "steel", "qty": "241"}],
        "wastage_kg": "19",
        "wastage_type": "liquid",
    }
    url = t.url("/production")
    # The machine and at least one operator are required.
    for missing in ({"machine_id": None}, {"crew_ids": []}):
        res = await client.post(url, json={**body, **missing}, headers=bearer(t.clerk))
        assert res.status_code == 422, missing
    stranger = {**body, "crew_ids": [max(ops) + 1]}
    bad = await client.post(url, json=stranger, headers=bearer(t.clerk))
    assert bad.status_code == 422 and bad.json()["code"] == "unknown_operator"
    res = await client.post(url, json=body, headers=bearer(t.clerk))
    assert res.status_code == 201, res.text
    run = res.json()
    assert run["efficiency_pct"] == 75.0 and run["kg_per_hour"] == 160.0
    assert {c["id"] for c in run["crew"]} == set(ops)
    assert run["machine"] == {"id": t.machine, "code": "M-01", "name": "Pyrolysis 1"}

    # A retired machine cannot be chosen for a new run.
    retire = {"code": "M-02", "name": "Cracker 2", "is_active": False}
    res = await client.put(t.url(f"/machines/{second}"), json=retire, headers=bearer(t.manager))
    assert res.status_code == 200 and not res.json()["is_active"], res.text
    retired = {**body, "machine_id": second}
    res = await client.post(url, json=retired, headers=bearer(t.clerk))
    assert res.status_code == 422 and res.json()["code"] == "inactive_machine"

    report = (await client.get(t.url(REPORT), headers=bearer(t.manager))).json()
    assert report["totals"]["runs"] == 1 and report["totals"]["processed_kg"] == 960
    assert report["totals"]["wastage_pct"] == 1.98
    assert {o["id"] for o in report["by_operator"]} == set(ops)
    assert report["by_operator"][0]["efficiency_pct"] == 75.0
    assert [(m["code"], m["runs"]) for m in report["by_machine"]] == [("M-01", 1)]
    assert [p["output_kg"] for p in report["trend"]] == [941]

    # Filters: one operator, another shift, or another machine.
    one = await client.get(t.url(f"{REPORT}&operator_id={ops[0]}"), headers=bearer(t.manager))
    assert [o["id"] for o in one.json()["by_operator"]] == [ops[0]]
    shift1 = (await client.get(t.url(f"{REPORT}&shift=1"), headers=bearer(t.manager))).json()
    assert shift1["totals"]["runs"] == 0 and shift1["by_machine"] == []
    other = await client.get(t.url(f"{REPORT}&machine_id={second}"), headers=bearer(t.manager))
    assert other.json()["totals"]["runs"] == 0

    # Only the Manager and the Super Admin see it.
    assert (await client.get(t.url(REPORT), headers=bearer(t.super_admin))).status_code == 200
    for who in (t.finance, t.operator):
        assert (await client.get(t.url(REPORT), headers=bearer(who))).status_code == 403
