"""In-charge entry → Manager approval (stock moves) → Finance approval (final).

Escalations go back one step and are a conversation in the comments; only the Manager can ask
the Super Admin for a change, and only the Super Admin edits or rejects. Nothing is deleted.
"""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import act, production, purchase, sale, stock_of, team


def _one(t, entry: dict, path: str = "") -> str:  # noqa: ANN001
    return t.url(f"/entries/{entry['type']}/{entry['id']}{path}")


async def _say(client: AsyncClient, t, entry: dict, token: str, text: str):  # noqa: ANN001, ANN202
    return await client.post(
        _one(t, entry, "/comments"), json={"comment": text}, headers=bearer(token)
    )


async def _escalate(client: AsyncClient, t, entry: dict, token: str, text: str = "Check it"):  # noqa: ANN001, ANN202
    return await client.post(
        _one(t, entry, "/escalate"), json={"comment": text}, headers=bearer(token)
    )


def _purchase_body(entry: dict, t, qty: str, comment: str = "Corrected") -> dict:  # noqa: ANN001
    return {
        "entry_date": entry["entry_date"],
        "supplier_id": t.supplier,
        "grade": "A",
        "material": "truck",
        "qty": qty,
        "rate": "14.5",
        "invoice_no": entry["invoice_no"],
        "comment": comment,
    }


async def test_full_flow_pending_to_verified(client: AsyncClient) -> None:
    t = await team(client)
    res = await purchase(client, t, t.operator, qty="1000", approve=False)
    assert res.status_code == 201, res.text
    entry = res.json()
    assert entry["status"] == "pending"
    assert entry["ref_no"] == "PUR-MR-00001"
    assert entry["amount"] == 14500.0
    assert entry["created_by_name"] == "Ops"

    # Waiting for the Manager: not in stock yet.
    line = await stock_of(client, t, "truck")
    assert line["provisional"]["balance"] == 0

    # Finance cannot skip the Manager.
    assert (await act(client, t, t.finance, entry, "verify")).status_code == 400
    approved = await act(client, t, t.manager, entry, "approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["approved_by_name"] == "Mgr"
    # The Manager's approval puts it in stock; it is not final yet.
    line = await stock_of(client, t, "truck")
    assert line["provisional"]["balance"] == 1000 and line["confirmed"]["balance"] == 0

    verified = await act(client, t, t.finance, entry, "verify")
    assert verified.json()["status"] == "verified"
    assert verified.json()["verified_by_name"] == "Fin"
    assert (await stock_of(client, t, "truck"))["confirmed"]["balance"] == 1000

    actions = [e["action"] for e in verified.json()["events"]]
    assert actions == ["created", "approved", "verified"]


async def test_each_step_belongs_to_its_role(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, approve=False)).json()
    for token in (t.operator, t.finance):
        assert (await act(client, t, token, entry, "approve")).status_code == 403
    # The detail tells each person which buttons they have.
    detail = await client.get(_one(t, entry), headers=bearer(t.manager))
    # Purchases also let the Manager and the purchase in-charge add a debit note.
    assert set(detail.json()["actions"]) == {
        "approve",
        "request_change",
        "escalate",
        "comment",
        "debit_note",
    }
    mine = await client.get(_one(t, entry), headers=bearer(t.operator))
    assert mine.json()["actions"] == ["comment", "debit_note"]

    await act(client, t, t.manager, entry, "approve")
    for token in (t.operator, t.manager):
        assert (await act(client, t, token, entry, "verify")).status_code == 403
    detail = await client.get(_one(t, entry), headers=bearer(t.finance))
    assert set(detail.json()["actions"]) == {"verify", "escalate", "comment"}


async def test_only_the_super_admin_rejects_or_edits(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="500")).json()
    body = _purchase_body(entry, t, "450")
    url = t.url(f"/purchases/{entry['id']}")
    for token in (t.manager, t.finance, t.operator):
        assert (await act(client, t, token, entry, "reject", "No")).status_code == 403
        assert (await client.put(url, json=body, headers=bearer(token))).status_code == 403
    # Entries are never deleted, not even by the Super Admin.
    gone = await client.delete(_one(t, entry), headers=bearer(t.super_admin))
    assert gone.status_code == 405


async def test_manager_escalates_to_the_incharge(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, approve=False)).json()
    assert (await _escalate(client, t, entry, t.manager, "")).status_code == 422
    # Finance cannot escalate an entry that is still with the Manager.
    assert (await _escalate(client, t, entry, t.finance)).status_code == 403
    raised = await _escalate(client, t, entry, t.manager, "Weighbridge slip says 980 kg")
    assert raised.status_code == 200, raised.text
    assert raised.json()["escalated_to"] == "incharge" and raised.json()["status"] == "pending"
    assert "escalate" not in raised.json()["actions"]

    # Back and forth in the comments; the escalation stays open.
    await _say(client, t, entry, t.operator, "Slip was wrong, 1000 kg is right")
    await _say(client, t, entry, t.manager, "Send the new slip photo")
    still = await _say(client, t, entry, t.operator, "Sent on WhatsApp")
    assert still.json()["escalated_to"] == "incharge"
    listed = (await client.get("/entries?escalated_to=incharge", headers=bearer(t.operator))).json()
    assert [r["ref_no"] for r in listed["items"]] == [entry["ref_no"]]

    # The Manager agrees and approves; that closes it.
    done = await act(client, t, t.manager, entry, "approve")
    assert done.json()["status"] == "approved" and done.json()["escalated_to"] is None
    steps = [e["action"] for e in done.json()["events"]]
    assert steps == ["created", "escalated", "commented", "commented", "commented", "approved"]


async def test_finance_escalates_to_the_manager(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()  # approved by the Manager
    raised = await _escalate(client, t, entry, t.finance, "Rate looks high")
    assert raised.json()["escalated_to"] == "manager" and raised.json()["status"] == "approved"
    summary = await client.get(
        t.url("/summary?date_from=2026-10-01&date_to=2026-10-01"), headers=bearer(t.manager)
    )
    assert summary.json()["queue"]["escalated_to_manager"] == 1

    await _say(client, t, entry, t.manager, "Market rate went up that week")
    reply = await _say(client, t, entry, t.finance, "OK")
    assert reply.json()["escalated_to"] == "manager"
    done = await act(client, t, t.finance, entry, "verify")
    assert done.json()["status"] == "verified" and done.json()["escalated_to"] is None


async def test_change_request_then_super_admin_edits(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="500")).json()  # approved, in stock
    await _escalate(client, t, entry, t.finance, "Bill says 450 kg")
    # Only the Manager can ask for a change, and must say what and why.
    assert (await act(client, t, t.finance, entry, "request_change", "Fix")).status_code == 403
    assert (await act(client, t, t.manager, entry, "request_change")).status_code == 400
    asked = await act(client, t, t.manager, entry, "request_change", "Bill says 450 kg")
    assert asked.json()["status"] == "change_requested" and asked.json()["escalated_to"] is None
    sa = await client.get(_one(t, entry), headers=bearer(t.super_admin))
    assert {"edit", "reject"} <= set(sa.json()["actions"])
    # It stays in stock while the Super Admin looks at it.
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 500

    url = t.url(f"/purchases/{entry['id']}")
    edited = await client.put(
        url, json=_purchase_body(entry, t, "450"), headers=bearer(t.super_admin)
    )
    assert edited.status_code == 200, edited.text
    # Back to the Manager, then Finance. Stock follows the new weight at once.
    assert edited.json()["status"] == "pending" and edited.json()["qty"] == 450
    last = edited.json()["events"][-1]
    assert last["action"] == "edited" and last["changes"]["qty"] == ["500.000", "450"]
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 450
    assert (await act(client, t, t.manager, entry, "approve")).json()["status"] == "approved"
    assert (await act(client, t, t.finance, entry, "verify")).json()["status"] == "verified"


async def test_change_request_then_super_admin_rejects(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="800")).json()
    await act(client, t, t.manager, entry, "request_change", "Duplicate bill")
    assert (await act(client, t, t.super_admin, entry, "reject")).status_code == 400
    res = await act(client, t, t.super_admin, entry, "reject", "Duplicate bill")
    assert res.json()["status"] == "rejected"
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 0
    # Final: nothing more can happen to it.
    assert (await act(client, t, t.manager, entry, "approve")).status_code == 400
    assert "edit" not in res.json()["actions"]


async def test_every_step_is_in_the_audit_log(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()
    await _escalate(client, t, entry, t.finance, "Why this rate?")
    await _say(client, t, entry, t.manager, "New supplier rate")
    await act(client, t, t.finance, entry, "verify")
    logs = (await client.get(t.url("/audit-logs"), headers=bearer(t.manager))).json()["items"]
    steps = [log["action"] for log in logs if log["entity_id"] == entry["id"]]
    for step in (
        "entry.created",
        "entry.approved",
        "entry.escalated",
        "entry.commented",
        "entry.verified",
    ):
        assert step in steps


async def test_super_admin_entries_also_wait_for_the_manager(client: AsyncClient) -> None:
    t = await team(client)
    res = await purchase(client, t, t.super_admin, approve=False)
    assert res.json()["status"] == "pending"


async def test_cannot_reject_a_purchase_whose_tyres_were_processed(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="1000")).json()
    assert (
        await production(client, t, t.operator, {"rubber": "600", "steel": "250"})
    ).status_code == 201
    res = await act(client, t, t.super_admin, entry, "reject", "Duplicate")
    assert res.status_code == 409
    assert res.json()["code"] == "insufficient_stock"


async def test_comments_from_finance_and_operator(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()
    assert (await _say(client, t, entry, t.finance, "Rate looks high?")).status_code == 201
    reply = await _say(client, t, entry, t.operator, "Market went up")
    assert [e["comment"] for e in reply.json()["events"] if e["action"] == "commented"] == [
        "Rate looks high?",
        "Market went up",
    ]
    assert (await _say(client, t, entry, t.finance, "  ")).status_code == 422


async def test_ceo_reads_but_cannot_act(client: AsyncClient) -> None:
    from tests.conftest import create_user, login_new_user

    t = await team(client)
    ceo = await login_new_user(
        client, await create_user(client, t.super_admin, "ceo@example.com", global_role="ceo")
    )
    entry = (await purchase(client, t, t.operator, approve=False)).json()
    detail = await client.get(_one(t, entry), headers=bearer(ceo))
    assert detail.status_code == 200
    assert detail.json()["actions"] == []
    assert (await act(client, t, ceo, entry, "approve")).status_code == 403
    assert (await purchase(client, t, ceo, n=3)).status_code == 403


async def test_manager_cannot_enter(client: AsyncClient) -> None:
    t = await team(client)
    assert (await purchase(client, t, t.manager, n=2)).status_code == 403


async def test_sales_check_approved_stock(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.operator, qty="1000")
    await production(client, t, t.operator, {"rubber": "600", "steel": "300"})
    too_much = await sale(client, t, t.operator, "700")
    assert too_much.status_code == 409
    # Two sales that each fit: both can be entered, but only one can be approved.
    first = (await sale(client, t, t.operator, "600", "MR/1", approve=False)).json()
    second = (await sale(client, t, t.operator, "600", "MR/2", approve=False)).json()
    assert (await act(client, t, t.manager, first, "approve")).status_code == 200
    late = await act(client, t, t.manager, second, "approve")
    assert late.status_code == 409 and late.json()["code"] == "insufficient_stock"
    assert (await stock_of(client, t, "rubber", "output"))["provisional"]["balance"] == 0
