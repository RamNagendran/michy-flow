"""Uploading bills, reading them, and turning them into entries."""

from httpx import AsyncClient

from tests import bill_samples
from tests.bill_samples import OUR_GSTIN, SELLER_GSTIN
from tests.conftest import bearer
from tests.entry_helpers import Team, party, team


async def _with_gstins(client: AsyncClient) -> Team:
    t = await team(client)
    await client.patch(t.url(), json={"gstin": OUR_GSTIN}, headers=bearer(t.super_admin))
    t.supplier = await party(client, t, "supplier", "Sri Balaji Tyre Traders", gstin=SELLER_GSTIN)
    return t


async def _upload(
    client: AsyncClient,
    t: Team,
    token: str,
    content: bytes,
    name: str = "bill.pdf",
    kind: str = "purchase",
):  # noqa: ANN202
    return await client.post(
        t.url(f"/documents?kind={kind}"),
        files={"file": (name, content, "application/octet-stream")},
        headers=bearer(token),
    )


def _purchase_body(t: Team, doc: dict) -> dict:
    p = doc["parsed"]
    return {
        "entry_date": p["invoice_date"]["value"],
        "supplier_id": doc["party_id"],
        "material": p["item"]["value"],
        "qty": str(p["qty"]["value"]),
        "rate": str(p["rate"]["value"]),
        "invoice_no": p["invoice_no"]["value"],
        "document_id": doc["id"],
    }


async def test_upload_reads_the_bill_and_matches_the_supplier(client: AsyncClient) -> None:
    t = await _with_gstins(client)
    res = await _upload(
        client, t, t.operator, bill_samples.pdf(with_qr=True), name="../SBT invoice.pdf"
    )
    assert res.status_code == 201, res.text
    doc = res.json()
    assert doc["filename"] == "SBT invoice.pdf"
    assert doc["method"] == "pdf_text"
    assert doc["party_id"] == t.supplier
    assert doc["parsed"]["einvoice"] is True
    assert doc["parsed"]["addressed_to_us"] is True
    assert doc["parsed"]["qty"]["value"] == 8460.0
    assert doc["duplicate_of"] is None
    assert doc["lines"][0] == "Sri Balaji Tyre Traders"


async def test_confirmed_bill_becomes_a_pending_entry(client: AsyncClient) -> None:
    t = await _with_gstins(client)
    # One set of bytes: the generator stamps each PDF with the time it was made.
    pdf = bill_samples.pdf()
    doc = (await _upload(client, t, t.operator, pdf)).json()
    res = await client.post(
        t.url("/purchases"), json=_purchase_body(t, doc), headers=bearer(t.operator)
    )
    assert res.status_code == 201, res.text
    entry = res.json()
    assert entry["status"] == "pending"
    assert entry["source"] == "ai"  # shown as "read from the bill"
    assert entry["document_id"] == doc["id"]
    assert entry["amount"] == 120132.0

    # The same file again is recognised, and cannot become a second entry.
    again = (await _upload(client, t, t.operator, pdf)).json()
    assert again["id"] == doc["id"]
    assert again["duplicate_of"] == entry["ref_no"]
    body = {**_purchase_body(t, doc), "invoice_no": "OTHER-1"}
    dup = await client.post(t.url("/purchases"), json=body, headers=bearer(t.operator))
    assert dup.status_code == 409


async def test_a_rejected_entry_frees_its_bill(client: AsyncClient) -> None:
    t = await _with_gstins(client)
    doc = (await _upload(client, t, t.operator, bill_samples.pdf())).json()
    entry = (
        await client.post(
            t.url("/purchases"), json=_purchase_body(t, doc), headers=bearer(t.operator)
        )
    ).json()
    await client.post(
        t.url(f"/entries/purchase/{entry['id']}/actions/reject"),
        json={"comment": "wrong rate"},
        headers=bearer(t.admin),
    )
    again = await client.post(
        t.url("/purchases"), json=_purchase_body(t, doc), headers=bearer(t.operator)
    )
    assert again.status_code == 201


async def test_bad_uploads_are_refused(client: AsyncClient) -> None:
    t = await team(client)
    html = await _upload(
        client, t, t.operator, b"<html><script>alert(1)</script></html>", name="bill.pdf"
    )
    assert html.status_code == 415
    empty = await _upload(client, t, t.operator, b"")
    assert empty.status_code == 415
    huge = await _upload(client, t, t.operator, b"%PDF-" + b"0" * (10 * 1024 * 1024 + 1))
    assert huge.status_code == 413
    broken = await _upload(client, t, t.operator, b"%PDF-1.4 nothing here")
    assert broken.status_code == 415


async def test_upload_needs_the_matching_duty(client: AsyncClient) -> None:
    t = await team(client)
    assert (await _upload(client, t, t.finance, bill_samples.pdf())).status_code == 403
    sale_doc = await _upload(client, t, t.operator, bill_samples.pdf(), kind="sale")
    assert sale_doc.status_code == 201
    # A sales bill cannot be attached to a purchase.
    body = {
        "entry_date": "2026-09-26",
        "supplier_id": t.supplier,
        "material": "truck",
        "qty": "100",
        "rate": "10",
        "invoice_no": "X-1",
        "document_id": sale_doc.json()["id"],
    }
    res = await client.post(t.url("/purchases"), json=body, headers=bearer(t.operator))
    assert res.status_code == 400
    assert res.json()["code"] == "unknown_document"


async def test_only_permitted_people_can_open_a_bill(client: AsyncClient) -> None:
    t = await _with_gstins(client)
    doc = (await _upload(client, t, t.operator, bill_samples.png(), name="photo.png")).json()
    assert doc["method"] == "ocr"
    url = t.url(f"/documents/{doc['id']}/file")
    mine = await client.get(url, headers=bearer(t.operator))
    assert mine.status_code == 200
    assert mine.headers["content-type"] == "image/png"
    assert mine.content.startswith(b"\x89PNG")
    # Another operator cannot see it; the Admin and Finance can.
    assert (await client.get(url, headers=bearer(t.operator2))).status_code == 404
    assert (await client.get(url, headers=bearer(t.finance))).status_code == 200
