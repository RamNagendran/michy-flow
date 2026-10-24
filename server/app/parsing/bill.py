"""Read one uploaded bill end to end. CPU-bound: call it through `asyncio.to_thread`."""

from dataclasses import dataclass

from app.parsing import text as bill_text
from app.parsing.fields import ParsedBill, parse_lines
from app.parsing.files import FileKind
from app.parsing.qr import find_einvoice


@dataclass
class BillReading:
    parsed: ParsedBill
    method: str  # "pdf_text" | "ocr" | "none"
    pages: int
    lines: list[str]


def read_bill(
    content: bytes, kind: FileKind, entry_kind: str, own_gstin: str | None
) -> BillReading:
    extracted = bill_text.extract(content, kind)
    qr = find_einvoice(extracted.images)
    parsed = parse_lines(extracted.lines, extracted.confidence, entry_kind, own_gstin, qr)
    parsed.warnings = extracted.warnings + parsed.warnings
    return BillReading(
        parsed=parsed, method=extracted.method, pages=extracted.pages, lines=extracted.lines
    )
