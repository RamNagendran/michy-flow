"""Operator entry → Admin review → Finance verification → finalised stock."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import act, production, purchase, sale, stock_of, team


async def test_full_flow_pending_to_verified(client: AsyncClient) -> None:
    t = await team(client)
    res = await purchase(client, t, t.operator, qty="1000")
    assert res.status_code == 201, res.text
    entry = res.json()
    assert entry["status"] == "pending"
    assert entry["ref_no"] == "PUR-MR-00001"
    assert entry["amount"] == 14500.0
    assert entry["created_by_name"] == "Ops"

    # Counts straight away, but is not final yet.
    line = await stock_of(client, t, "truck")
    assert line["provisional"]["balance"] == 1000
    assert line["confirmed"]["balance"] == 0

    # Finance cannot skip the Admin.
    assert (await act(client, t, t.finance, entry, "verify")).status_code == 400
    approved = await act(client, t, t.admin, entry, "approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["approved_by_name"] == "Adm"

    verified = await act(client, t, t.finance, entry, "verify")
    assert verified.json()["status"] == "verified"
    assert verified.json()["verified_by_name"] == "Fin"
    assert (await stock_of(client, t, "truck"))["confirmed"]["balance"] == 1000

    actions = [e["action"] for e in verified.json()["events"]]
    assert actions == ["created", "approved", "verified"]


async def test_each_step_belongs_to_its_role(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()
    for token in (t.operator, t.finance, t.manager):
        assert (await act(client, t, token, entry, "approve")).status_code == 403
    await act(client, t, t.admin, entry, "approve")
    for token in (t.operator, t.admin, t.manager):
        assert (await act(client, t, token, entry, "verify")).status_code == 403
    # The detail tells each person which buttons they have.
    detail = await client.get(t.url(f"/entries/purchase/{entry['id']}"), headers=bearer(t.finance))
    assert set(detail.json()["actions"]) == {"verify", "hold", "escalate", "comment"}


async def test_hold_needs_a_reason_and_admin_edit_resubmits(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="500")).json()
    await act(client, t, t.admin, entry, "approve")
    assert (await act(client, t, t.finance, entry, "hold")).status_code == 400
    held = await act(client, t, t.finance, entry, "hold", "Bill says 450 kg")
    assert held.json()["status"] == "on_hold"

    body = {
        "entry_date": entry["entry_date"],
        "supplier_id": t.supplier,
        "grade": "A",
        "material": "truck",
        "qty": "450",
        "rate": "14.5",
        "invoice_no": entry["invoice_no"],
        "comment": "Corrected to the bill",
    }
    edited = await client.put(
        t.url(f"/purchases/{entry['id']}"), json=body, headers=bearer(t.admin)
    )
    assert edited.status_code == 200, edited.text
    # The Admin's edit goes straight back to Finance.
    assert edited.json()["status"] == "approved"
    assert edited.json()["qty"] == 450
    last = edited.json()["events"][-1]
    assert last["action"] == "edited"
    assert last["changes"]["qty"] == ["500.000", "450"]
    assert (await act(client, t, t.finance, entry, "verify")).json()["status"] == "verified"


async def test_manager_cannot_enter_or_edit(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="500")).json()
    await act(client, t, t.admin, entry, "approve")
    body = {
        "entry_date": entry["entry_date"],
        "supplier_id": t.supplier,
        "grade": "A",
        "material": "car",
        "qty": "500",
        "rate": "11",
        "invoice_no": entry["invoice_no"],
    }
    res = await client.put(t.url(f"/purchases/{entry['id']}"), json=body, headers=bearer(t.manager))
    assert res.status_code == 403
    assert (await purchase(client, t, t.manager, n=2)).status_code == 403
    assert (
        await client.get(t.url(f"/entries/purchase/{entry['id']}"), headers=bearer(t.manager))
    ).status_code == 200


async def test_verified_entries_are_locked_except_for_super_admin(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.admin, qty="500")).json()
    await act(client, t, t.finance, entry, "verify")
    body = {
        "entry_date": entry["entry_date"],
        "supplier_id": t.supplier,
        "grade": "A",
        "material": "truck",
        "qty": "600",
        "rate": "14.5",
        "invoice_no": entry["invoice_no"],
    }
    url = t.url(f"/purchases/{entry['id']}")
    assert (await client.put(url, json=body, headers=bearer(t.admin))).status_code == 403
    one = t.url(f"/entries/purchase/{entry['id']}")
    assert (await client.delete(one, headers=bearer(t.admin))).status_code == 403
    by_sa = await client.put(url, json=body, headers=bearer(t.super_admin))
    assert by_sa.status_code == 200
    # Changing a verified entry sends it back to Finance.
    assert by_sa.json()["status"] == "approved"


async def test_entries_by_an_approver_start_approved(client: AsyncClient) -> None:
    t = await team(client)
    res = await purchase(client, t, t.admin)
    assert res.json()["status"] == "approved"
    assert (await purchase(client, t, t.operator, n=2)).json()["status"] == "pending"


async def test_rejected_entries_leave_stock(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="800")).json()
    assert (await act(client, t, t.admin, entry, "reject")).status_code == 400
    res = await act(client, t, t.admin, entry, "reject", "Wrong supplier")
    assert res.json()["status"] == "rejected"
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 0
    # Final: nothing more can happen to it.
    assert (await act(client, t, t.admin, entry, "approve")).status_code == 400
    assert "edit" not in res.json()["actions"]


async def test_cannot_reject_a_purchase_whose_tyres_were_processed(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator, qty="1000")).json()
    assert (
        await production(client, t, t.operator, {"rubber": "600", "steel": "250"})
    ).status_code == 201
    res = await act(client, t, t.admin, entry, "reject", "Duplicate")
    assert res.status_code == 409
    assert res.json()["code"] == "insufficient_stock"


async def test_comments_from_finance_and_operator(client: AsyncClient) -> None:
    t = await team(client)
    entry = (await purchase(client, t, t.operator)).json()
    url = t.url(f"/entries/purchase/{entry['id']}/comments")
    assert (
        await client.post(url, json={"comment": "Rate looks high?"}, headers=bearer(t.finance))
    ).status_code == 201
    reply = await client.post(url, json={"comment": "Market went up"}, headers=bearer(t.operator))
    assert [e["comment"] for e in reply.json()["events"] if e["action"] == "commented"] == [
        "Rate looks high?",
        "Market went up",
    ]
    assert (
        await client.post(url, json={"comment": "  "}, headers=bearer(t.finance))
    ).status_code == 422


async def test_ceo_reads_but_cannot_act(client: AsyncClient) -> None:
    from tests.conftest import create_user, login_new_user

    t = await team(client)
    ceo = await login_new_user(
        client, await create_user(client, t.super_admin, "ceo@example.com", global_role="ceo")
    )
    entry = (await purchase(client, t, t.operator)).json()
    detail = await client.get(t.url(f"/entries/purchase/{entry['id']}"), headers=bearer(ceo))
    assert detail.status_code == 200
    assert detail.json()["actions"] == []
    assert (await act(client, t, ceo, entry, "approve")).status_code == 403
    assert (await purchase(client, t, ceo, n=3)).status_code == 403


async def test_sales_check_output_stock(client: AsyncClient) -> None:
    t = await team(client)
    await purchase(client, t, t.operator, qty="1000")
    await production(client, t, t.operator, {"rubber": "600", "steel": "300"})
    too_much = await sale(client, t, t.operator, "700")
    assert too_much.status_code == 409
    ok = await sale(client, t, t.operator, "600")
    assert ok.status_code == 201
    assert (await stock_of(client, t, "rubber", "output"))["provisional"]["balance"] == 0
