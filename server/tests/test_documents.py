"""Uploading bills, reading them, and turning them into entries."""

from httpx import AsyncClient

from tests import bill_samples
from tests.bill_samples import SELLER_GSTIN
from tests.conftest import bearer, make_gstin
from tests.entry_helpers import Team, party, team


async def _with_bill_supplier(client: AsyncClient) -> Team:
    """A team whose supplier list has the party named on the sample bill, with its GST number."""
    t = await team(client)
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
    t = await _with_bill_supplier(client)
    res = await _upload(
        client, t, t.operator, bill_samples.pdf(with_qr=True), name="../SBT invoice.pdf"
    )
    assert res.status_code == 201, res.text
    doc = res.json()
    assert doc["filename"] == "SBT invoice.pdf"
    assert doc["method"] == "pdf_text"
    assert doc["party_id"] == t.supplier
    assert doc["parsed"]["einvoice"] is True
    assert doc["parsed"]["qty"]["value"] == 8460.0
    assert doc["duplicate_of"] is None
    assert doc["lines"][0] == "Sri Balaji Tyre Traders"


async def test_confirmed_bill_becomes_a_pending_entry(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
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

    # The same file again is read afresh as a new upload, flagged, and cannot become a second entry.
    again = (await _upload(client, t, t.operator, pdf)).json()
    assert again["id"] != doc["id"]
    assert again["duplicate_of"] == entry["ref_no"]
    for d in (doc, again):
        body = {**_purchase_body(t, d), "invoice_no": "OTHER-1"}
        dup = await client.post(t.url("/purchases"), json=body, headers=bearer(t.operator))
        assert dup.status_code == 409


async def test_a_rejected_entry_frees_its_bill(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
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
    t = await _with_bill_supplier(client)
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


async def test_every_upload_is_read_afresh(client: AsyncClient) -> None:
    """Nothing from an earlier upload is reused, even for the very same file."""
    from sqlalchemy import update

    from app.core.db import SessionLocal
    from app.models import Document

    t = await _with_bill_supplier(client)
    pdf = bill_samples.pdf(with_qr=False)
    first = (await _upload(client, t, t.operator, pdf)).json()
    # Even if what was stored for the first upload were wrong, a new upload reads the file again.
    stale = {
        "fields": {"rate": {"value": "1", "confidence": 92, "source": "arithmetic"}},
        "lines": [],
    }
    async with SessionLocal() as db:
        await db.execute(update(Document).where(Document.id == first["id"]).values(parsed=stale))
        await db.commit()

    again = (await _upload(client, t, t.operator, pdf)).json()
    assert again["id"] != first["id"]
    assert again["parsed"]["rate"]["value"] == first["parsed"]["rate"]["value"] != 1
    assert again["duplicate_of"] is None  # not entered yet


async def test_bill_gst_numbers_are_read_and_matched(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
    for with_qr in (False, True):
        doc = (await _upload(client, t, t.operator, bill_samples.pdf(with_qr=with_qr))).json()
        assert doc["company_gstin_on_bill"] == bill_samples.OUR_GSTIN, with_qr
        assert doc["party_gstin_on_bill"] == SELLER_GSTIN
        # The supplier is found by the GST number on the bill.
        assert doc["party_id"] == t.supplier


async def test_bill_must_show_our_gst_number(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
    someone_else = make_gstin("not-us")
    pdf = bill_samples.pdf(buyer=someone_else)
    doc = (await _upload(client, t, t.operator, pdf)).json()
    res = await client.post(
        t.url("/purchases"), json=_purchase_body(t, doc), headers=bearer(t.operator)
    )
    assert res.status_code == 400 and res.json()["code"] == "gstin_mismatch"
    assert someone_else in res.json()["detail"]


async def test_bill_must_show_the_supplier_gst_number(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
    # A different supplier, with its own GST number, picked for this bill.
    other = await party(client, t, "supplier", "Kaveri Scrap")
    doc = (await _upload(client, t, t.operator, bill_samples.pdf())).json()
    body = {**_purchase_body(t, doc), "supplier_id": other}
    res = await client.post(t.url("/purchases"), json=body, headers=bearer(t.operator))
    assert res.status_code == 400 and res.json()["code"] == "gstin_mismatch"
    assert "Kaveri Scrap" in res.json()["detail"]
    # Typed in by hand (no bill), nothing is checked.
    manual = {k: v for k, v in body.items() if k != "document_id"}
    ok = await client.post(t.url("/purchases"), json=manual, headers=bearer(t.operator))
    assert ok.status_code == 201, ok.text


async def test_a_misread_gst_number_can_be_corrected(client: AsyncClient) -> None:
    t = await _with_bill_supplier(client)
    # The bill is read with a wrong supplier GST number (e.g. a smudged scan).
    misread = make_gstin("smudged")
    doc = (await _upload(client, t, t.operator, bill_samples.pdf(seller=misread))).json()
    assert doc["party_gstin_on_bill"] == misread
    body = {**_purchase_body(t, doc), "supplier_id": t.supplier}
    refused = await client.post(t.url("/purchases"), json=body, headers=bearer(t.operator))
    assert refused.status_code == 400 and refused.json()["code"] == "gstin_mismatch"
    assert SELLER_GSTIN in refused.json()["detail"] and misread in refused.json()["detail"]
    # The person checks the paper bill and types the right number: it is saved and logged.
    fixed = {**body, "bill_party_gstin": SELLER_GSTIN.lower()}
    res = await client.post(t.url("/purchases"), json=fixed, headers=bearer(t.operator))
    assert res.status_code == 201, res.text
    steps = [(e["action"], e["comment"]) for e in res.json()["events"]]
    assert steps[0][0] == "created" and steps[1][0] == "gstin_corrected"
    assert misread in steps[1][1] and SELLER_GSTIN in steps[1][1]
    logs = (await client.get(t.url("/audit-logs"), headers=bearer(t.manager))).json()["items"]
    assert any(log["action"] == "bill_gstin_corrected" for log in logs)
    # A typed number must still be a real GST number.
    bad = {**body, "bill_party_gstin": "33AAJCR8510J1Z8", "invoice_no": "X-2"}
    assert (
        await client.post(t.url("/purchases"), json=bad, headers=bearer(t.operator))
    ).status_code == 422
