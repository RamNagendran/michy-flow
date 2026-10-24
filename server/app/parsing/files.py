"""Decide what an uploaded file really is from its first bytes, never from its name."""

from dataclasses import dataclass

from app.core.errors import AppError

MAX_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 5
# Refuse images that would expand to a huge bitmap in memory (decompression bombs).
MAX_IMAGE_PIXELS = 40_000_000


class UnsupportedFileError(AppError):
    status_code = 415
    code = "unsupported_file"


class FileTooLargeError(AppError):
    status_code = 413
    code = "file_too_large"


@dataclass(frozen=True, slots=True)
class FileKind:
    content_type: str
    extension: str


_SIGNATURES: list[tuple[bytes, FileKind]] = [
    (b"%PDF-", FileKind("application/pdf", "pdf")),
    (b"\x89PNG\r\n\x1a\n", FileKind("image/png", "png")),
    (b"\xff\xd8\xff", FileKind("image/jpeg", "jpg")),
]


def sniff(head: bytes) -> FileKind:
    for signature, kind in _SIGNATURES:
        if head.startswith(signature):
            return kind
    raise UnsupportedFileError("Upload a PDF, JPG or PNG file")


def safe_filename(name: str | None, kind: FileKind) -> str:
    """Keep a readable name for display, without path parts or odd characters."""
    base = (name or "bill").replace("\\", "/").rsplit("/", 1)[-1]
    stem = base.rsplit(".", 1)[0] if "." in base else base
    clean = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in stem).strip(" ._")[:80]
    return f"{clean or 'bill'}.{kind.extension}"
