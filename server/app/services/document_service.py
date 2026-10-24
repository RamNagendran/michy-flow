"""Uploaded bills: store safely, read them, and link each one to the entry made from it."""

import asyncio
import dataclasses
import hashlib
import logging

from fastapi import Request, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.models import Document, Party, Purchase, Sale
from app.models.enums import EntryStatus, PartyKind
from app.parsing.bill import BillReading, read_bill
from app.parsing.fields import Found, ParsedBill
from app.parsing.files import (
    MAX_BYTES,
    FileTooLargeError,
    UnsupportedFileError,
    safe_filename,
    sniff,
)
from app.schemas.document import DocumentRead, ParsedBillRead, to_json
from app.services import audit_service
from app.services.access_service import CompanyContext

logger = logging.getLogger(__name__)

_PARSE_TIMEOUT_SECONDS = 90
_MAX_STORED_LINES = 300
_CHUNK = 1024 * 1024
_ENTER = {"purchase": P.ENTER_PURCHASE, "sale": P.ENTER_SALES}
_MODEL = {"purchase": Purchase, "sale": Sale}


async def _read_limited(upload: UploadFile) -> bytes:
    """Read at most MAX_BYTES, without ever holding more than that in memory."""
    chunks, size = [], 0
    while chunk := await upload.read(_CHUNK):
        size += len(chunk)
        if size > MAX_BYTES:
            raise FileTooLargeError(f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB")
        chunks.append(chunk)
    if not size:
        raise UnsupportedFileError("The file is empty")
    return b"".join(chunks)


def _serialise(parsed: ParsedBill) -> dict:
    out = {}
    for f in dataclasses.fields(parsed):
        value = getattr(parsed, f.name)
        out[f.name] = (
            {"value": to_json(value.value), "confidence": value.confidence, "source": value.source}
            if isinstance(value, Found)
            else value
        )
    return out


async def _read(content: bytes, kind, entry_kind: str, own_gstin: str | None) -> BillReading | None:  # noqa: ANN001
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(read_bill, content, kind, entry_kind, own_gstin),
            _PARSE_TIMEOUT_SECONDS,
        )
    except UnsupportedFileError:
        raise
    except Exception:  # noqa: BLE001 - a bill we cannot read must never block typing it in
        logger.exception("Reading an uploaded bill failed")
        return None


async def _live_entry_ref(db: AsyncSession, doc: Document) -> str | None:
    if not doc.entry_id:
        return None
    entry = await db.get(_MODEL[doc.kind], doc.entry_id)
    if entry and entry.deleted_at is None and entry.status != EntryStatus.REJECTED:
        return entry.ref_no
    return None


async def to_read(db: AsyncSession, doc: Document) -> DocumentRead:
    parsed = ParsedBillRead.model_validate(doc.parsed.get("fields", {}))
    party_id = None
    if parsed.party_gstin:
        party_id = await db.scalar(
            select(Party.id).where(
                Party.company_id == doc.company_id,
                Party.kind == (PartyKind.SUPPLIER if doc.kind == "purchase" else PartyKind.BUYER),
                Party.gstin == str(parsed.party_gstin.value),
                Party.is_active,
            )
        )
    return DocumentRead(
        id=doc.id,
        company_id=doc.company_id,
        kind=doc.kind,
        filename=doc.filename,
        content_type=doc.content_type,
        size_bytes=doc.size_bytes,
        pages=doc.pages,
        method=doc.method,
        created_at=doc.created_at,
        parsed=parsed,
        lines=doc.parsed.get("lines", []),
        party_id=party_id,
        duplicate_of=await _live_entry_ref(db, doc),
    )


async def upload(
    db: AsyncSession,
    ctx: CompanyContext,
    kind: str,
    file: UploadFile,
    request: Request | None = None,
) -> Document:
    if not ctx.can(_ENTER[kind]):
        raise ForbiddenError("Not allowed")
    # Plain values: a rollback below expires ORM objects, and re-loading them is not allowed here.
    company_id, own_gstin = ctx.company.id, ctx.company.gstin
    content = await _read_limited(file)
    file_kind = sniff(content[:16])
    digest = hashlib.sha256(content).hexdigest()

    existing = await db.scalar(
        select(Document).where(Document.company_id == company_id, Document.sha256 == digest)
    )
    if existing:
        if existing.kind != kind:
            raise ConflictError(f"This file was already uploaded as a {existing.kind} bill")
        return existing

    reading = await _read(content, file_kind, kind, own_gstin)
    parsed = (
        reading.parsed
        if reading
        else ParsedBill(
            warnings=["This bill could not be read automatically; please type the details"]
        )
    )
    doc = Document(
        company_id=company_id,
        kind=kind,
        filename=safe_filename(file.filename, file_kind),
        content_type=file_kind.content_type,
        size_bytes=len(content),
        sha256=digest,
        content=content,
        method=reading.method if reading else "none",
        pages=reading.pages if reading else 1,
        parsed={
            "fields": _serialise(parsed),
            "lines": (reading.lines if reading else [])[:_MAX_STORED_LINES],
        },
        uploaded_by_id=ctx.user.id,
    )
    db.add(doc)
    try:
        await db.flush()
    except IntegrityError:
        # Someone uploaded the very same file a moment ago.
        await db.rollback()
        return await db.scalar(
            select(Document).where(Document.company_id == company_id, Document.sha256 == digest)
        )
    audit_service.record(
        db,
        account_id=ctx.user.account_id,
        actor=ctx.user,
        action="document_uploaded",
        entity_type="document",
        entity_id=doc.id,
        company_id=company_id,
        details={
            "filename": doc.filename,
            "kind": kind,
            "size": doc.size_bytes,
            "method": doc.method,
        },
        request=request,
    )
    await db.commit()
    return doc


async def get_visible(db: AsyncSession, ctx: CompanyContext, document_id: int) -> Document:
    """A document the caller may see: in this company, and their own unless they see all entries."""
    doc = await db.get(Document, document_id)
    if (
        not doc
        or doc.company_id != ctx.company.id
        or (not ctx.can(P.VIEW_ALL_ENTRIES) and doc.uploaded_by_id != ctx.user.id)
    ):
        raise NotFoundError("Document not found")
    return doc


async def attach(
    db: AsyncSession, ctx: CompanyContext, kind: str, document_id: int, entry: Purchase | Sale
) -> None:
    """Link an uploaded bill to the entry made from it. Call inside the company's stock lock."""
    doc = await db.get(Document, document_id, with_for_update=True)
    if not doc or doc.company_id != ctx.company.id or doc.kind != kind:
        raise AppError("The attached bill is not from this company", code="unknown_document")
    if doc.uploaded_by_id != ctx.user.id and not ctx.can(P.VIEW_ALL_ENTRIES):
        raise AppError("The attached bill is not from this company", code="unknown_document")
    if ref := await _live_entry_ref(db, doc):
        raise ConflictError(f"This bill is already entered as {ref}", code="duplicate_entry")
    doc.entry_id = entry.id
    entry.document_id = doc.id
