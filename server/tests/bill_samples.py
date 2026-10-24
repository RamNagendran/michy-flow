"""Build sample bills (PDF and PNG) the way a supplier's billing software would."""

import base64
import io
import json

SELLER_GSTIN = "27AAPFU0939F1ZV"  # a real-format GSTIN with a valid check digit
OUR_GSTIN = "29AAGCB7383J1Z4"


def lines(
    seller: str = SELLER_GSTIN, buyer: str = OUR_GSTIN, invoice: str = "SBT/26-27/1418"
) -> list[str]:
    return [
        "Sri Balaji Tyre Traders",
        f"GSTIN: {seller}",
        "TAX INVOICE",
        f"Invoice No: {invoice}   Date: 26/09/2026",
        f"Bill To: Michy Rubbers  GSTIN: {buyer}",
        "Description          HSN      Qty      Rate     Amount",
        "TBR Scrap Tyres     40040000  8.460 MT  14,200.00  1,20,132.00",
        "CGST 2.5%  3,003.30",
        "SGST 2.5%  3,003.30",
        "Grand Total  1,26,139.00",
    ]


def einvoice_token(
    seller: str = SELLER_GSTIN, buyer: str = OUR_GSTIN, invoice: str = "SBT/26-27/1418"
) -> str:
    data = {
        "SellerGstin": seller,
        "BuyerGstin": buyer,
        "DocNo": invoice,
        "DocTyp": "INV",
        "DocDt": "26/09/2026",
        "TotInvVal": 126139,
        "MainHsnCode": "4004",
        "Irn": "x",
    }
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    return f"{part({'alg': 'RS256'})}.{part({'data': json.dumps(data), 'iss': 'NIC'})}.signature"


def pdf(with_qr: bool = False, **kw: str) -> bytes:
    from fpdf import FPDF

    doc = FPDF()
    doc.add_page()
    doc.set_font("Helvetica", size=11)
    for line in lines(**kw):
        doc.cell(0, 8, line, new_x="LMARGIN", new_y="NEXT")
    if with_qr:
        import qrcode

        buf = io.BytesIO()
        qrcode.make(einvoice_token(**kw)).save(buf, format="PNG")
        buf.seek(0)
        doc.image(buf, x=150, y=10, w=45)
    return bytes(doc.output())


def png(**kw: str) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1240, 700), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=26)
    for i, line in enumerate(lines(**kw)):
        draw.text((40, 30 + i * 60), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
