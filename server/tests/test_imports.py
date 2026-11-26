"""Import purchases: overseas suppliers, a foreign price turned into rupees, the Bill of Entry."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.parsing.bill_of_entry import is_bill_of_entry, parse_bill_of_entry
from app.services import fx_service
from tests.conftest import bearer
from tests.entry_helpers import TODAY, Team, approve_new, stock_of, team


async def _overseas(client: AsyncClient, t: Team, name: str = "Inspyre Trading FZE") -> int:
    body = {"kind": "supplier", "name": name, "overseas": True, "city": "Sharjah, UAE"}
    res = await client.post(t.url("/parties"), json=body, headers=bearer(t.manager))
    assert res.status_code == 201, res.text
    assert res.json()["gstin"] is None and res.json()["overseas"] is True
    return res.json()["id"]


def _import_body(t: Team, supplier: int, **extra: object) -> dict:
    return {
        "entry_date": TODAY,
        "supplier_id": supplier,
        "origin": "import",
        "currency": "usd",
        "material": "truck",
        "qty": "83140",
        "foreign_rate": "0.105",
        "fx_rate": "94.1",
        "customs_duty": "137482",
        "be_no": "5189281",
        "be_date": TODAY,
        "invoice_no": "INV26-0183",
        "vehicle_nos": ["CAIU8369229", "MRKU5689025"],
        "bill_company_gstin": t.company["gstin"],
        **extra,
    }


async def test_only_overseas_suppliers_go_without_a_gst_number(client: AsyncClient) -> None:
    t = await team(client)
    await _overseas(client, t)
    for body in (
        {"kind": "supplier", "name": "Local Tyres"},
        {"kind": "buyer", "name": "Gulf Buyer", "overseas": True},
    ):
        res = await client.post(t.url("/parties"), json=body, headers=bearer(t.manager))
        assert res.status_code == 422, body


async def test_an_import_is_priced_in_rupees_at_the_exchange_rate(client: AsyncClient) -> None:
    t = await team(client)
    supplier = await _overseas(client, t)
    res = await client.post(
        t.url("/purchases"), json=_import_body(t, supplier), headers=bearer(t.clerk)
    )
    assert res.status_code == 201, res.text
    await approve_new(client, t, res)
    entry = res.json()
    assert entry["origin"] == "import" and entry["currency"] == "USD"
    assert entry["rate"] == pytest.approx(9.8805)  # 0.105 × 94.1
    assert entry["foreign_amount"] == pytest.approx(8729.70)
    assert entry["amount"] == pytest.approx(821464.77)  # 8,729.70 × 94.1
    assert entry["customs_duty"] == pytest.approx(137482)
    assert entry["be_no"] == "5189281"
    # Goes into Grade A raw material like any purchase.
    assert (await stock_of(client, t, "truck"))["provisional"]["balance"] == 83140


async def test_import_and_supplier_must_agree(client: AsyncClient) -> None:
    t = await team(client)
    supplier = await _overseas(client, t)
    domestic = await client.post(
        t.url("/purchases"), json=_import_body(t, t.supplier), headers=bearer(t.clerk)
    )
    assert domestic.status_code == 422 and domestic.json()["code"] == "wrong_origin"
    as_domestic = _import_body(t, supplier, origin="domestic", rate="10")
    res = await client.post(t.url("/purchases"), json=as_domestic, headers=bearer(t.clerk))
    assert res.status_code == 422 and res.json()["code"] == "wrong_origin"


async def test_an_import_needs_its_rates_and_bill_of_entry(client: AsyncClient) -> None:
    t = await team(client)
    supplier = await _overseas(client, t)
    for missing in ("fx_rate", "foreign_rate", "be_no"):
        body = _import_body(t, supplier)
        body.pop(missing)
        res = await client.post(t.url("/purchases"), json=body, headers=bearer(t.clerk))
        assert res.status_code == 422, missing
    inr = _import_body(t, supplier, currency="INR")
    assert (
        await client.post(t.url("/purchases"), json=inr, headers=bearer(t.clerk))
    ).status_code == 422


async def test_our_gst_number_is_still_checked_on_an_import(client: AsyncClient) -> None:
    t = await team(client)
    supplier = await _overseas(client, t)
    body = _import_body(t, supplier, bill_company_gstin=None)
    res = await client.post(t.url("/purchases"), json=body, headers=bearer(t.clerk))
    assert res.status_code == 400 and res.json()["code"] == "gstin_mismatch"


async def test_live_rate(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    t = await team(client)
    calls: list[str] = []

    async def fake(currency: str) -> tuple[Decimal, datetime]:
        calls.append(currency)
        return Decimal("94.0512"), datetime(2026, 11, 26, tzinfo=UTC)

    monkeypatch.setattr(fx_service, "_fetch", fake)
    monkeypatch.setattr(fx_service, "_cache", {})
    for _ in range(2):
        res = await client.get("/fx-rates/usd", headers=bearer(t.clerk))
        assert res.status_code == 200, res.text
        assert res.json()["currency"] == "USD" and Decimal(res.json()["rate"]) == Decimal("94.0512")
    assert calls == ["USD"]  # kept for an hour

    async def down(currency: str) -> tuple[Decimal, datetime]:
        raise ValueError("no rate")

    monkeypatch.setattr(fx_service, "_fetch", down)
    res = await client.get("/fx-rates/eur", headers=bearer(t.clerk))
    assert res.status_code == 503 and res.json()["code"] == "fx_unavailable"


# Lines as the text layer of an ICEGATE Bill of Entry gives them (trimmed).
_BOE_LINES = [
    "Port Code BE No BE Date BE Type",
    "INMAA1 5189281 20/11/2026 H",
    "GSTIN/TYPE 33AEPPM7308L3Z1/G",
    "BILL OF ENTRY FOR HOME CONSUMPTION PKG 3 G.WT (KGS) 83140 BE0201120261433",
    "9.SG 10.SAED 11.GSIA 12.TTA 13.HEALTH 14.TOTAL DUTY 15.INT 16.PNLTY 17.FINE 19.TOT. AMOUNT",
    "137482 0 0 0 137482",
    "1.WBE NO. 2.DATE 3.WBE SITE 4.WH CODE 1.S.NO 2.INVOICE NO 3.INV. AMT 4.CUR",
    "E 1 INV26-0183 8729.7 USD",
    "Submission 20-NOV-26 S14:31 INR=INR",
    "Assessment 20-NOV-26 14:33 1 USD=94.1INR Examination",
    "1 F N A NA CAIU8369229",
    "C 1.S.NO 2.INVOICE NO. & DT. 3.PURCHASE ORDER NO & DT 4.LC NO & DATE",
    "1 INV26-0183",
    "I 04-OCT-26",
    "4.THIRD PARTY NAME & ADDRESS",
    "INSPYRE TRADING FZE O",
    "1 40040000 USED RUBBER TYRE SCRAP BALES - 105.000000 83.140000 MTS 8729.70",
    "3.SUPPLIER NAME & ADDRESS",
    "6. AD CODE 6100001",
]


def test_bill_of_entry_is_read() -> None:
    assert is_bill_of_entry(_BOE_LINES)
    bill = parse_bill_of_entry(_BOE_LINES, [1.0] * len(_BOE_LINES))
    assert bill.origin == "import" and bill.currency == "USD"
    assert bill.be_no.value == "5189281" and str(bill.be_date.value) == "2026-11-20"
    assert bill.invoice_no.value == "INV26-0183" and str(bill.invoice_date.value) == "2026-10-04"
    assert bill.fx_rate.value == Decimal("94.1")
    assert bill.qty.value == Decimal("83140") and bill.unit_on_bill == "MT"
    assert bill.foreign_rate.value == Decimal("0.105")  # $105 a tonne
    assert bill.rate.value == Decimal("9.8805")
    assert bill.foreign_amount.value == Decimal("8729.7")
    assert bill.customs_duty.value == Decimal("137482")
    assert bill.buyer_gstin.value == "33AEPPM7308L3Z1" and bill.seller_gstin is None
    assert bill.party_name.value == "INSPYRE TRADING FZE"
    assert bill.containers == ["CAIU8369229"]
    assert bill.warnings == []
