"""The signed QR code printed on e-invoices.

It is a JWT issued by the government's e-invoice system (NIC). Its payload holds the invoice
number and date, total value and main HSN code, so when a bill carries one those fields are
exact. The signature is not checked here; the values are cross-checked against
the printed bill and the person confirms them.
"""

import base64
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from PIL import Image


@dataclass(frozen=True, slots=True)
class EInvoice:
    invoice_no: str | None
    invoice_date: date | None
    total: Decimal | None
    hsn: str | None
    irn: str | None


def _b64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def decode_einvoice(token: str) -> EInvoice | None:
    """Payload of an e-invoice JWT, or None if this is some other QR code."""
    parts = token.strip().split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(_b64(parts[1]))
        data = payload.get("data", payload)
        data = json.loads(data) if isinstance(data, str) else data
    except (ValueError, TypeError):
        return None
    # Recognised by the e-invoice payload's own field names.
    if not isinstance(data, dict) or not ({"Irn", "DocNo"} & data.keys()):
        return None

    def parse_date(v: object) -> date | None:
        try:
            return datetime.strptime(str(v), "%d/%m/%Y").date()
        except ValueError:
            return None

    total = data.get("TotInvVal")
    return EInvoice(
        invoice_no=str(data["DocNo"]) if data.get("DocNo") else None,
        invoice_date=parse_date(data.get("DocDt")),
        total=Decimal(str(total)) if total is not None else None,
        hsn=str(data["MainHsnCode"]) if data.get("MainHsnCode") else None,
        irn=str(data["Irn"]) if data.get("Irn") else None,
    )


# The detector is sensitive to how many pixels the code spans, so a few sizes are tried.
_SCALES = (1.0, 0.75, 0.5, 1.5)


def _decode_frame(detector, frame) -> list[str]:  # noqa: ANN001
    import cv2

    try:
        single = detector.detectAndDecode(frame)[0]
        if single:
            return [single]
        ok, values, _, _ = detector.detectAndDecodeMulti(frame)
    except cv2.error:
        return []
    return [v for v in values if v] if ok else []


def find_einvoice(images: Iterable[Image.Image]) -> EInvoice | None:
    import cv2
    import numpy as np

    detector = cv2.QRCodeDetector()
    for image in images:
        base = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
        for scale in _SCALES:
            frame = (
                base
                if scale == 1.0
                else cv2.resize(base, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            )
            for value in _decode_frame(detector, frame):
                if invoice := decode_einvoice(value):
                    return invoice
    return None
