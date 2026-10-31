"""The monthly wastage approval: sent at month end, approved (several at once) or escalated by
the Super Admin, answered by the Manager, changed only by the Super Admin, spread over the
tyres used, and locking the month once approved."""

from decimal import Decimal

from httpx import AsyncClient

from app.services.wastage_month_service import _spread
from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, act, purchase, stock_of, team

AUG, SEP = "2026-08-10", "2026-09-10"
RANGE = "?date_from=2026-08-01&date_to=2026-10-31"


async def _run(client: AsyncClient, t: Team, day: str, rubber: str, material: str = "truck"):  # noqa: ANN202
    """A run approved by the Manager. Wastage is 2% of the output."""
    body = {
        "entry_date": day,
        "material": material,
        "outputs": [{"product": "rubber", "qty": rubber}],
    }
    res = await client.post(t.url("/production"), json=body, headers=bearer(t.admin))
    assert res.status_code == 201, res.text
    run = res.json()
    assert (await act(client, t, t.manager, run, "approve")).status_code == 200
    return run


async def _months(client: AsyncClient, t: Team) -> dict[str, dict]:
    res = await client.get(t.url(f"/wastage{RANGE}"), headers=bearer(t.manager))
    assert res.status_code == 200, res.text
    return {m["month"]: m for m in res.json()}


async def _queue(client: AsyncClient, token: str) -> list[dict]:
    res = await client.get("/wastage/queue", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


def test_spread_follows_the_share_and_adds_up() -> None:
    shares = {"truck": Decimal(600), "car": Decimal(300), "otr": Decimal(100)}
    assert _spread(Decimal(100), shares) == [
        ("truck", Decimal(600), Decimal("60.000")),
        ("car", Decimal(300), Decimal("30.000")),
        ("otr", Decimal(100), Decimal("10.000")),
    ]
    down = _spread(Decimal("-10"), {"truck": Decimal(1), "car": Decimal(1), "otr": Decimal(1)})
    assert sum(q for *_, q in down) == Decimal(-10)  # the rounding goes to the first line
    assert _spread(Decimal(0), shares) == [] and _spread(Decimal(5), {}) == []


async def test_ended_months_wait_for_the_super_admin_and_lock_once_approved(
    client: AsyncClient,
) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "3000", entry_date=AUG)
    aug_run = await _run(client, t, AUG, "490")  # 9.8 kg wastage
    await _run(client, t, SEP, "980")  # 19.6 kg
    await _run(client, t, TODAY, "98")  # this month: still running

    months = await _months(client, t)
    assert [m["status"] for m in months.values()] == ["pending", "pending", "open"]
    assert months["2026-08-01"]["wastage_kg"] == 9.8 and months["2026-09-01"]["runs"] == 1
    # September did not wait for August to be approved.
    assert await _queue(client, t.super_admin) == [
        {"company_id": t.company["id"], "to_approve": 2, "escalated": 0}
    ]

    body = {
        "months": [
            {"month": "2026-08-01", "wastage_kg": "9.8"},
            {"month": SEP, "wastage_kg": "19.6"},
        ]
    }
    url = t.url("/wastage/approve")
    for outsider in (t.manager, t.finance, t.operator):
        assert (await client.post(url, json=body, headers=bearer(outsider))).status_code in (
            403,
            404,
        )
    res = await client.post(url, json=body, headers=bearer(t.super_admin))
    assert res.status_code == 200, res.text
    assert [m["status"] for m in res.json()] == ["approved", "approved"]
    assert await _queue(client, t.super_admin) == []

    again = await client.post(url, json=body, headers=bearer(t.super_admin))
    assert again.status_code == 422 and again.json()["code"] == "invalid_status"
    running = {"months": [{"month": TODAY, "wastage_kg": "1.96"}]}
    res = await client.post(url, json=running, headers=bearer(t.super_admin))
    assert res.status_code == 422 and res.json()["code"] == "month_open"

    # August is locked: no new run, no edit, no rejection dated in it.
    late = {"entry_date": AUG, "material": "truck", "outputs": [{"product": "rubber", "qty": "10"}]}
    res = await client.post(t.url("/production"), json=late, headers=bearer(t.admin))
    assert res.status_code == 409 and res.json()["code"] == "month_locked"
    moved = {**late, "entry_date": TODAY, "comment": "wrong month"}
    res = await client.put(
        t.url(f"/production/{aug_run['id']}"), json=moved, headers=bearer(t.admin)
    )
    assert res.status_code == 409 and res.json()["code"] == "month_locked"
    res = await act(client, t, t.super_admin, aug_run, "reject", "duplicate")
    assert res.status_code == 409 and res.json()["code"] == "month_locked"
    await _run(client, t, TODAY, "10")  # this month is still open


async def test_escalation_and_a_changed_figure_spread_over_the_tyres(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.admin, "2000", entry_date=SEP)
    await purchase(client, t, t.admin, "2000", entry_date=SEP, material="car", n=2)
    await _run(client, t, SEP, "588")  # 600 kg of truck tyres used, 11.76 kg wastage
    await _run(client, t, SEP, "392", "car")  # 400 kg of car tyres, 7.84 kg
    month = t.url("/wastage/months/2026-09-01")
    step = lambda action: f"{month}/actions/{action}"  # noqa: E731
    note = {"comment": "Why so low for September?"}

    change = {"wastage_kg": "119.6", "comment": "Weighbridge shows 100 kg more"}
    assert (await client.put(month, json=change, headers=bearer(t.manager))).status_code == 403
    assert (
        await client.post(step("escalate"), json=note, headers=bearer(t.manager))
    ).status_code == 403
    assert (
        await client.post(step("resend"), json=note, headers=bearer(t.super_admin))
    ).status_code == 422
    res = await client.post(step("escalate"), json=note, headers=bearer(t.super_admin))
    assert res.status_code == 200 and res.json()["status"] == "escalated"
    assert res.json()["actions"] == ["approve", "change", "comment"]
    assert await _queue(client, t.manager) == [
        {"company_id": t.company["id"], "to_approve": 0, "escalated": 1}
    ]
    blank = {"comment": "   "}
    assert (
        await client.post(step("resend"), json=blank, headers=bearer(t.manager))
    ).status_code == 422
    reply = {"comment": "Two runs were wet tyres"}
    assert (
        await client.post(step("comment"), json=reply, headers=bearer(t.manager))
    ).status_code == 200
    res = await client.post(step("resend"), json=reply, headers=bearer(t.manager))
    assert res.status_code == 200 and res.json()["status"] == "pending"

    res = await client.put(month, json=change, headers=bearer(t.super_admin))
    assert res.status_code == 200, res.text
    m = res.json()
    assert m["calculated_kg"] == 19.6 and m["wastage_kg"] == 119.6 and m["changed"] is True
    spread = {a["item"]: a for a in m["adjustments"]}
    assert spread["truck"]["qty"] == 60 and spread["truck"]["share_pct"] == 60
    assert spread["car"]["qty"] == 40 and spread["car"]["stock_after"] == 1560
    # Nothing moves in stock before approval.
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 1400

    approve = t.url("/wastage/approve")
    stale = {"months": [{"month": SEP, "wastage_kg": "19.6"}]}
    res = await client.post(approve, json=stale, headers=bearer(t.super_admin))
    assert res.status_code == 409 and res.json()["code"] == "wastage_changed"
    seen = {"months": [{"month": SEP, "wastage_kg": "119.6"}], "comment": "Agreed"}
    assert (await client.post(approve, json=seen, headers=bearer(t.super_admin))).status_code == 200

    truck = await stock_of(client, t, "truck")
    assert truck["provisional"]["balance"] == 1340 and truck["wastage_adjustment"] == 60
    car = await stock_of(client, t, "car")
    assert car["provisional"]["out_qty"] == 440 and car["confirmed"]["out_qty"] == 40
    assert (await client.put(month, json=change, headers=bearer(t.super_admin))).status_code == 422

    detail = (await client.get(month, headers=bearer(t.finance))).json()
    assert [e["action"] for e in detail["events"]] == [
        "sent",
        "escalated",
        "commented",
        "resent",
        "changed",
        "approved",
    ]
    assert detail["events"][-1]["changes"]["stock_kg"] == {"truck": "-60.000", "car": "-40.000"}
    assert detail["actions"] == [] and detail["approved_by_name"]
    audit = await client.get(
        f"/audit-logs?entity_type=wastage_month&company_id={t.company['id']}",
        headers=bearer(t.super_admin),
    )
    assert audit.status_code == 200 and audit.json()["total"] == 5
