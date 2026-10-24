"""Bill reading without AI: the building blocks, then whole files."""

from datetime import date
from decimal import Decimal

import pytest

from app.parsing.bill import read_bill
from app.parsing.fields import find_rate_and_amount, parse_lines
from app.parsing.files import UnsupportedFileError, safe_filename, sniff
from app.parsing.numbers import find_gstins, gstin_checksum_ok, numbers_in, repair_gstin
from app.parsing.ocr import Box, group_lines
from app.parsing.qr import decode_einvoice
from tests import bill_samples
from tests.bill_samples import OUR_GSTIN, SELLER_GSTIN


def test_indian_number_formats() -> None:
    assert numbers_in("1,20,132.00 and 14,200 and 8.460") == [
        Decimal("120132.00"),
        Decimal("14200"),
        Decimal("8.460"),
    ]
    # Not parts of codes like SBT/26-27/1418.
    assert numbers_in("SBT/26-27/1418") == []


def test_gstin_check_digit_and_ocr_repair() -> None:
    assert gstin_checksum_ok("27AAPFU0939F1ZV")
    assert not gstin_checksum_ok("27AAPFU0939F1ZW")
    # OCR read the letter O for zero and S for five in digit positions.
    assert repair_gstin("27AAPFUO939F1ZV") == "27AAPFU0939F1ZV"
    assert repair_gstin("27AAPFU0939F1Z") is None
    found = find_gstins(
        f"Seller GSTIN: 27AAPFU 0939F1ZV\nBuyer: {OUR_GSTIN}\nGSTIN: 27AAPFU0939F1ZV"
    )
    assert found == [("27AAPFU0939F1ZV", True), (OUR_GSTIN, True)]


def test_rate_and_amount_found_by_arithmetic() -> None:
    values = [Decimal(x) for x in ("40040000", "8.460", "14200.00", "120132.00")]
    assert find_rate_and_amount(Decimal("8.460"), values) == (
        Decimal("14200.00"),
        Decimal("120132.00"),
    )
    assert find_rate_and_amount(Decimal("5"), [Decimal("3"), Decimal("7")]) is None


def test_ocr_boxes_regrouped_into_lines() -> None:
    boxes = [
        Box("Amount", 400, 100, 120, 0.9),
        Box("Qty", 100, 102, 121, 0.95),
        Box("Total 500", 50, 200, 220, 0.8),
    ]
    assert group_lines(boxes) == [("Qty Amount", 0.9), ("Total 500", 0.8)]


def test_fields_from_a_typical_purchase_bill() -> None:
    lines = bill_samples.lines()
    bill = parse_lines(lines, [1.0] * len(lines), "purchase", OUR_GSTIN, None)
    assert bill.party_gstin.value == SELLER_GSTIN and bill.party_gstin.confidence >= 90
    assert bill.party_name.value == "Sri Balaji Tyre Traders"
    assert bill.invoice_no.value == "SBT/26-27/1418"
    assert bill.invoice_date.value == date(2026, 9, 26)
    assert bill.item.value == "truck"
    assert bill.unit_on_bill == "MT"
    assert bill.qty.value == Decimal("8460.000")
    assert bill.rate.value == Decimal("14.2000")
    assert bill.taxable_amount.value == Decimal("120132.00")
    assert bill.tax_amount.value == Decimal("6006.60")
    assert bill.total.value == Decimal("126139.00") and bill.total.confidence >= 95
    assert bill.addressed_to_us is True
    assert bill.warnings == []


def test_sale_bill_picks_the_buyer_not_us() -> None:
    lines = [
        "Michy Rubbers",
        f"GSTIN: {OUR_GSTIN}",
        "Invoice No: MR/26-27/0429 Date: 01-Sep-2026",
        f"Bill To: Apex Mouldings GSTIN: {SELLER_GSTIN}",
        "Crumb Rubber 30 Mesh 4,250 Kg 31.20 1,32,600.00",
        "Grand Total 1,39,230.00",
    ]
    bill = parse_lines(lines, [1.0] * len(lines), "sale", OUR_GSTIN, None)
    assert bill.party_gstin.value == SELLER_GSTIN
    assert bill.party_name.value == "Apex Mouldings"
    assert bill.item.value == "rubber" and bill.grade == "A"
    assert bill.invoice_date.value == date(2026, 9, 1)
    assert bill.qty.value == Decimal("4250") and bill.unit_on_bill == "KG"
    assert bill.rate.value == Decimal("31.2000")
    assert "Amount + GST does not add up" in " ".join(bill.warnings)


def test_sale_of_tyres_is_suggested_as_a_resell() -> None:
    lines = [
        "Michy Rubbers",
        f"GSTIN: {OUR_GSTIN}",
        "Invoice No: MR/26-27/0430 Date: 02-Sep-2026",
        f"Bill To: Apex Mouldings GSTIN: {SELLER_GSTIN}",
        "TBR Scrap Tyres 40040000 2,000 Kg 15.00 30,000.00",
    ]
    bill = parse_lines(lines, [1.0] * len(lines), "sale", OUR_GSTIN, None)
    assert bill.item.value == "truck" and bill.grade == "B"


def test_bill_for_someone_else_is_flagged() -> None:
    lines = bill_samples.lines(buyer="27AAPFU0939F1ZV")
    bill = parse_lines(lines, [1.0] * len(lines), "purchase", OUR_GSTIN, None)
    assert bill.addressed_to_us is False
    assert any("not on this bill" in w for w in bill.warnings)


def test_einvoice_qr_payload() -> None:
    qr = decode_einvoice(bill_samples.einvoice_token())
    assert qr.seller_gstin == SELLER_GSTIN and qr.buyer_gstin == OUR_GSTIN
    assert qr.invoice_no == "SBT/26-27/1418" and qr.invoice_date == date(2026, 9, 26)
    assert qr.total == Decimal("126139")
    assert decode_einvoice("https://example.com") is None
    assert decode_einvoice("a.b.c") is None


def test_files_are_identified_by_content() -> None:
    assert sniff(b"%PDF-1.7 ...").content_type == "application/pdf"
    assert sniff(b"\x89PNG\r\n\x1a\n...").extension == "png"
    with pytest.raises(UnsupportedFileError):
        sniff(b"<html><script>")
    assert safe_filename("../../etc/passwd.pdf", sniff(b"%PDF-")) == "passwd.pdf"
    assert safe_filename("bill <1>.exe", sniff(b"\xff\xd8\xff")) == "bill _1.jpg"


def test_read_text_pdf_with_einvoice_qr() -> None:
    data = bill_samples.pdf(with_qr=True)
    reading = read_bill(data, sniff(data[:16]), "purchase", OUR_GSTIN)
    assert reading.method == "pdf_text"
    assert reading.parsed.einvoice is True
    assert reading.parsed.invoice_no.source == "qr"
    assert reading.parsed.qty.value == Decimal("8460.000")


def test_read_photo_with_ocr() -> None:
    data = bill_samples.png()
    reading = read_bill(data, sniff(data[:16]), "purchase", OUR_GSTIN)
    assert reading.method == "ocr"
    p = reading.parsed
    assert p.party_gstin.value == SELLER_GSTIN
    assert p.invoice_no.value == "SBT/26-27/1418"
    assert p.qty.value == Decimal("8460.000")
    assert p.total.value == Decimal("126139.00")
    # OCR confidence lowers every field's confidence a little.
    assert p.invoice_no.confidence < 88


def test_broken_files_are_refused() -> None:
    with pytest.raises(UnsupportedFileError):
        read_bill(b"%PDF-1.4 not really a pdf", sniff(b"%PDF-"), "purchase", None)
    with pytest.raises(UnsupportedFileError):
        read_bill(b"\x89PNG\r\n\x1a\nbroken", sniff(b"\x89PNG\r\n\x1a\n"), "purchase", None)
