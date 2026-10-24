"""Get the text off a bill: the PDF's own text layer when it has one, OCR otherwise."""

import io
from dataclasses import dataclass, field

from PIL import Image, ImageOps

from app.parsing import ocr
from app.parsing.files import MAX_IMAGE_PIXELS, MAX_PDF_PAGES, FileKind, UnsupportedFileError

# A PDF with less real text than this is a scan, and gets OCR.
_MIN_TEXT_CHARS = 40
_RENDER_DPI = 200


@dataclass
class BillText:
    lines: list[str]
    method: str  # "pdf_text" | "ocr" | "none"
    # Lowest OCR confidence per line (1.0 for PDF text), aligned with `lines`.
    confidence: list[float]
    # Page pictures, used to look for the e-invoice QR code.
    images: list[Image.Image] = field(default_factory=list)
    pages: int = 1
    warnings: list[str] = field(default_factory=list)


def _open_image(content: bytes) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        image = Image.open(io.BytesIO(content))
        image.load()
    except (Image.DecompressionBombError, OSError) as exc:
        raise UnsupportedFileError("This image could not be opened") from exc
    # Phone photos are often stored sideways with an EXIF hint; apply it.
    return ImageOps.exif_transpose(image)


def _ocr(images: list[Image.Image]) -> tuple[list[str], list[float], list[str]]:
    lines: list[str] = []
    confidence: list[float] = []
    try:
        for image in images:
            for text, conf in ocr.read_lines(image):
                lines.append(text)
                confidence.append(conf)
    except ocr.OcrUnavailableError:
        return (
            [],
            [],
            ["Photos and scans cannot be read on this server; please type the details in"],
        )
    return lines, confidence, []


def extract(content: bytes, kind: FileKind) -> BillText:
    if kind.content_type != "application/pdf":
        image = _open_image(content)
        lines, conf, warnings = _ocr([image])
        return BillText(lines, "ocr" if lines else "none", conf, [image], 1, warnings)

    import pdfplumber

    try:
        pdf = pdfplumber.open(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001 - pdfminer raises many types for a broken file
        raise UnsupportedFileError("This PDF could not be opened") from exc
    with pdf:
        if not pdf.pages:
            raise UnsupportedFileError("This PDF has no pages")
        pages = pdf.pages[:MAX_PDF_PAGES]
        warnings = (
            [f"Only the first {MAX_PDF_PAGES} pages were read"]
            if len(pdf.pages) > MAX_PDF_PAGES
            else []
        )
        text = "\n".join(p.extract_text() or "" for p in pages)
        images = [p.to_image(resolution=_RENDER_DPI).original for p in pages]
        page_count = len(pdf.pages)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len("".join(lines)) >= _MIN_TEXT_CHARS:
        return BillText(lines, "pdf_text", [1.0] * len(lines), images, page_count, warnings)
    # A scanned PDF: the pages are pictures.
    lines, conf, ocr_warnings = _ocr(images)
    return BillText(
        lines, "ocr" if lines else "none", conf, images, page_count, warnings + ocr_warnings
    )
