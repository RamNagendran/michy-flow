"""Debit notes on purchases: raised when part of a load is useless, shown on the supplier's
next purchases, and closed when a later bill takes the amount off."""

from httpx import AsyncClient

from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, act, party, purchase, stock_of, team

NOTE = {"qty": "150", "amount": "2175", "reason": "150 kg wet and mud-filled, useless"}


async def _raise(client: AsyncClient, t: Team, entry: dict, token: str, **body: object):  # noqa: ANN202
    return await client.post(
        t.url(f"/purchases/{entry['id']}/debit-notes"),
        json={**NOTE, **body},
        headers=bearer(token),
    )


async def _detail(client: AsyncClient, t: Team, entry: dict, token: str) -> dict:
    res = await client.get(t.url(f"/entries/purchase/{entry['id']}"), headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


async def _open_notes(client: AsyncClient, t: Team, token: str, supplier: int) -> list[dict]:
    res = await client.get(
        t.url(f"/debit-notes?supplier_id={supplier}&open=true"), headers=bearer(token)
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _row(client: AsyncClient, t: Team, entry: dict, token: str) -> dict:
    rows = (await client.get("/entries?type=purchase", headers=bearer(token))).json()["items"]
    return next(r for r in rows if r["id"] == entry["id"])


async def test_debit_note_is_shown_on_the_next_purchase_until_reduced(
    client: AsyncClient,
) -> None:
    t = await team(client)
    first = (await purchase(client, t, t.operator, "1000", n=1)).json()

    # The purchase in-charge (or the Manager) raises it; Finance cannot; never more than bought.
    assert (await _raise(client, t, first, t.finance)).status_code == 403
    too_much = await _raise(client, t, first, t.operator, qty="1001")
    assert too_much.status_code == 422 and too_much.json()["code"] == "debit_note_too_much"
    res = await _raise(client, t, first, t.operator)
    assert res.status_code == 201, res.text
    note = res.json()["debit_notes"][0]
    assert note["note_no"] == "DN-MR-00001" and note["is_open"] is True
    assert note["qty"] == 150 and note["amount"] == 2175 and note["item"] == "truck"
    assert note["supplier_name"] == "Sri Balaji Tyres"
    assert "debit_note" in [e["action"] for e in res.json()["events"]]
    dup = await _raise(client, t, first, t.manager, note_no="DN-MR-00001")
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_debit_note"
    # The bill it was raised on does not itself show it as "from an earlier bill".
    assert (await _row(client, t, first, t.manager))["open_debit_notes"] == 0

    # Next purchase from the same supplier: everyone sees the open note.
    second = (await purchase(client, t, t.operator, "800", approve=False, n=2)).json()
    assert [n["id"] for n in await _open_notes(client, t, t.operator, t.supplier)] == [note["id"]]
    assert (await _row(client, t, second, t.manager))["open_debit_notes"] == 1
    assert (await _row(client, t, second, t.finance))["open_debit_notes"] == 1
    for token in (t.manager, t.finance, t.operator):
        d = await _detail(client, t, second, token)
        assert [n["note_no"] for n in d["supplier_open_debit_notes"]] == ["DN-MR-00001"]
    assert "adjust_debit_note" in (await _detail(client, t, second, t.manager))["actions"]
    assert "adjust_debit_note" not in (await _detail(client, t, second, t.finance))["actions"]
    summary = await client.get(
        t.url(f"/summary?date_from={TODAY}&date_to={TODAY}"), headers=bearer(t.manager)
    )
    assert summary.json()["queue"]["open_debit_notes"] == 1

    # A third bill takes the amount off, marked while entering it.
    third = await purchase(
        client, t, t.operator, "500", approve=False, n=3, debit_note_ids=[note["id"]]
    )
    assert third.status_code == 201, third.text
    third = third.json()
    assert [n["note_no"] for n in third["adjusted_debit_notes"]] == ["DN-MR-00001"]
    assert third["supplier_open_debit_notes"] == []
    assert await _open_notes(client, t, t.operator, t.supplier) == []
    assert (await _row(client, t, second, t.manager))["open_debit_notes"] == 0
    raised_on = (await _detail(client, t, first, t.manager))["debit_notes"][0]
    assert raised_on["is_open"] is False and raised_on["adjusted_ref_no"] == third["ref_no"]
    first_events = [e["action"] for e in (await _detail(client, t, first, t.manager))["events"]]
    assert "debit_note_adjusted" in first_events

    # It cannot be taken off twice.
    again = await purchase(
        client, t, t.operator, "400", approve=False, n=4, debit_note_ids=[note["id"]]
    )
    assert again.status_code == 422 and again.json()["code"] == "debit_note_not_open"

    # The Super Admin rejects the bill that took it off: the note is open again.
    assert (await act(client, t, t.super_admin, third, "reject", "Wrong bill")).status_code == 200
    assert [n["id"] for n in await _open_notes(client, t, t.manager, t.supplier)] == [note["id"]]

    # The Manager marks it on the second bill from its drawer.
    adjusted = await client.post(
        t.url(f"/purchases/{second['id']}/debit-notes/adjust"),
        json={"note_ids": [note["id"]]},
        headers=bearer(t.manager),
    )
    assert adjusted.status_code == 200, adjusted.text
    assert [n["note_no"] for n in adjusted.json()["adjusted_debit_notes"]] == ["DN-MR-00001"]
    assert await _open_notes(client, t, t.manager, t.supplier) == []


async def test_another_suppliers_note_cannot_be_reduced(client: AsyncClient) -> None:
    t = await team(client)
    first = (await purchase(client, t, t.operator, "1000", n=1)).json()
    note = (await _raise(client, t, first, t.manager)).json()["debit_notes"][0]
    other = await party(client, t, "supplier", "Kaveri Rubbers")
    res = await purchase(
        client, t, t.operator, "300", n=2, supplier_id=other, debit_note_ids=[note["id"]]
    )
    assert res.status_code == 422 and res.json()["code"] == "debit_note_not_open"
    fresh = (await purchase(client, t, t.operator, "300", n=3, supplier_id=other)).json()
    assert (await _detail(client, t, fresh, t.manager))["supplier_open_debit_notes"] == []


async def test_no_debit_note_on_a_rejected_purchase(client: AsyncClient) -> None:
    t = await team(client)
    first = (await purchase(client, t, t.operator, "1000", approve=False, n=1)).json()
    note = (await _raise(client, t, first, t.operator)).json()["debit_notes"][0]
    assert (await act(client, t, t.super_admin, first, "reject", "Not ours")).status_code == 200
    assert (await _raise(client, t, first, t.manager)).status_code == 403
    # A note on a rejected bill is not open any more.
    assert await _open_notes(client, t, t.manager, t.supplier) == []
    assert note["is_open"] is True


async def test_final_bills_are_not_flagged(client: AsyncClient) -> None:
    t = await team(client)
    old = (await purchase(client, t, t.operator, "700", n=1)).json()
    assert (await act(client, t, t.finance, old, "verify")).status_code == 200
    first = (await purchase(client, t, t.operator, "1000", n=2)).json()
    await _raise(client, t, first, t.operator)
    waiting = (await purchase(client, t, t.operator, "500", approve=False, n=3)).json()
    assert (await _row(client, t, old, t.manager))["open_debit_notes"] == 0
    assert (await _row(client, t, waiting, t.manager))["open_debit_notes"] == 1


async def test_a_note_is_only_a_flag(client: AsyncClient) -> None:
    """Any issue can be flagged with just a message; it changes no stock and no amounts."""
    t = await team(client)
    first = (await purchase(client, t, t.operator, "1000", n=1)).json()
    before = await stock_of(client, t, "truck")
    res = await client.post(
        t.url(f"/purchases/{first['id']}/debit-notes"),
        json={"reason": "Driver unloaded late; check the weighbridge slip next time"},
        headers=bearer(t.operator),
    )
    assert res.status_code == 201, res.text
    note = res.json()["debit_notes"][0]
    assert note["qty"] is None and note["amount"] is None
    assert res.json()["amount"] == first["amount"] and res.json()["qty"] == first["qty"]
    assert await stock_of(client, t, "truck") == before
    blank = await client.post(
        t.url(f"/purchases/{first['id']}/debit-notes"),
        json={"reason": "  "},
        headers=bearer(t.operator),
    )
    assert blank.status_code == 422
