"""Uploaded bills: store safely, read them, and link each one to the entry made from it."""

import asyncio
import dataclasses
import hashlib
import logging

from fastapi import Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.models import Company, Document, Party, Purchase, Sale
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


async def _read(content: bytes, kind, entry_kind: str) -> BillReading | None:  # noqa: ANN001
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(read_bill, content, kind, entry_kind),
            _PARSE_TIMEOUT_SECONDS,
        )
    except UnsupportedFileError:
        raise
    except Exception:  # noqa: BLE001 - a bill we cannot read must never block typing it in
        logger.exception("Reading an uploaded bill failed")
        return None


async def _live_entry_ref(db: AsyncSession, doc: Document) -> str | None:
    """The entry already made from this bill: from this upload or an earlier upload of the very
    same file (same fingerprint). Rejected and deleted entries free the bill again."""
    linked = await db.scalars(
        select(Document.entry_id).where(
            Document.company_id == doc.company_id,
            Document.kind == doc.kind,
            Document.sha256 == doc.sha256,
            Document.entry_id.is_not(None),
        )
    )
    for entry_id in linked:
        entry = await db.get(_MODEL[doc.kind], entry_id)
        if entry and entry.deleted_at is None and entry.status != EntryStatus.REJECTED:
            return entry.ref_no
    return None


def gstins_on_bill(
    parsed: ParsedBillRead, kind: str, company_gstin: str | None
) -> tuple[str | None, str | None]:
    """(our GST number, the supplier's / buyer's) as the bill shows them. On a purchase we are
    the buyer; on a sale, the seller. When the bill does not say whose is whose, our saved
    number found anywhere on it counts as ours and the other one as theirs."""
    seller = parsed.seller_gstin.value if parsed.seller_gstin else None
    buyer = parsed.buyer_gstin.value if parsed.buyer_gstin else None
    ours, theirs = (buyer, seller) if kind == "purchase" else (seller, buyer)
    if ours is None and company_gstin in parsed.gstins:
        ours = company_gstin
    if theirs is None:
        theirs = next((g for g in parsed.gstins if g not in (ours, company_gstin)), None)
    return ours, theirs


async def to_read(db: AsyncSession, doc: Document) -> DocumentRead:
    parsed = ParsedBillRead.model_validate(doc.parsed.get("fields", {}))
    company = await db.get(Company, doc.company_id)
    ours, theirs = gstins_on_bill(parsed, doc.kind, company.gstin if company else None)
    kind = PartyKind.SUPPLIER if doc.kind == "purchase" else PartyKind.BUYER
    party_id = None
    # Pre-select the supplier / buyer by the GST number on the bill, or else by name.
    if theirs:
        party_id = await db.scalar(
            select(Party.id).where(
                Party.company_id == doc.company_id,
                Party.kind == kind,
                Party.gstin == theirs,
                Party.is_active,
            )
        )
    name = str(parsed.party_name.value).strip().lower() if parsed.party_name else ""
    if name and party_id is None:
        party_id = await db.scalar(
            select(Party.id)
            .where(
                Party.company_id == doc.company_id,
                Party.kind == (PartyKind.SUPPLIER if doc.kind == "purchase" else PartyKind.BUYER),
                func.lower(func.trim(Party.name)) == name,
                Party.is_active,
            )
            .limit(1)
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
        company_gstin_on_bill=ours,
        party_gstin_on_bill=theirs,
        duplicate_of=await _live_entry_ref(db, doc),
    )


def _stored_reading(reading: BillReading | None) -> tuple[str, int, dict]:
    """(method, pages, parsed JSON) as kept on the document."""
    parsed = (
        reading.parsed
        if reading
        else ParsedBill(
            warnings=["This bill could not be read automatically; please type the details"]
        )
    )
    stored = {
        "fields": _serialise(parsed),
        "lines": (reading.lines if reading else [])[:_MAX_STORED_LINES],
    }
    return (reading.method if reading else "none"), (reading.pages if reading else 1), stored


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
    company_id = ctx.company.id
    content = await _read_limited(file)
    file_kind = sniff(content[:16])
    digest = hashlib.sha256(content).hexdigest()

    # Always read the bill now; nothing from an earlier upload is reused.
    reading = await _read(content, file_kind, kind)
    method, pages, stored = _stored_reading(reading)
    doc = Document(
        company_id=company_id,
        kind=kind,
        filename=safe_filename(file.filename, file_kind),
        content_type=file_kind.content_type,
        size_bytes=len(content),
        sha256=digest,
        content=content,
        method=method,
        pages=pages,
        parsed=stored,
        uploaded_by_id=ctx.user.id,
    )
    db.add(doc)
    await db.flush()
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


def check_gstins(
    company: Company, party: Party | None, ours: str | None, theirs: str | None, kind: str
) -> None:
    """The bill's GST numbers (as read, or as corrected by the person) must be the registered
    ones: ours, and the supplier's / buyer's."""
    who = "supplier" if kind == "purchase" else "buyer"
    if not company.gstin:
        raise AppError(
            f"Add the GST number for {company.name} first (Settings → Companies)",
            code="gstin_missing",
        )
    if party is not None and not party.gstin:
        raise AppError(
            f"Add the GST number for {party.name} first (Suppliers & buyers)", code="gstin_missing"
        )
    if ours != company.gstin:
        raise AppError(
            f"GST number mismatch for {company.name}: registered {company.gstin}, "
            f"on the bill {ours or 'not found'}. If the bill was read wrong, correct it.",
            code="gstin_mismatch",
        )
    if party is not None and theirs != party.gstin:
        raise AppError(
            f"GST number mismatch for the {who} {party.name}: registered {party.gstin}, "
            f"on the bill {theirs or 'not found'}. If the bill was read wrong, correct it.",
            code="gstin_mismatch",
        )


async def attach(
    db: AsyncSession,
    ctx: CompanyContext,
    kind: str,
    document_id: int,
    entry: Purchase | Sale,
    confirmed: tuple[str | None, str | None] = (None, None),
) -> dict:
    """Link an uploaded bill to the entry made from it, after checking its GST numbers. Call
    inside the company's stock lock. `confirmed` holds (ours, theirs) as the person typed them
    when the bill was read wrong; None keeps what was read. Returns the corrections made."""
    doc = await db.get(Document, document_id, with_for_update=True)
    if not doc or doc.company_id != ctx.company.id or doc.kind != kind:
        raise AppError("The attached bill is not from this company", code="unknown_document")
    if doc.uploaded_by_id != ctx.user.id and not ctx.can(P.VIEW_ALL_ENTRIES):
        raise AppError("The attached bill is not from this company", code="unknown_document")
    if ref := await _live_entry_ref(db, doc):
        raise ConflictError(f"This bill is already entered as {ref}", code="duplicate_entry")
    party_id = entry.supplier_id if isinstance(entry, Purchase) else entry.buyer_id
    parsed = ParsedBillRead.model_validate(doc.parsed.get("fields", {}))
    read = gstins_on_bill(parsed, kind, ctx.company.gstin)
    ours, theirs = (c or r for c, r in zip(confirmed, read, strict=True))
    check_gstins(ctx.company, await db.get(Party, party_id), ours, theirs, kind)
    corrected = {
        side: {"read": r, "entered": c}
        for side, c, r in zip(("company", "party"), confirmed, read, strict=True)
        if c and c != r
    }
    if corrected:
        # The person typed a GST number that differs from what was read: keep a record.
        audit_service.record(
            db,
            account_id=ctx.user.account_id,
            actor=ctx.user,
            action="bill_gstin_corrected",
            entity_type=kind,
            entity_id=entry.id,
            company_id=ctx.company.id,
            details={"document_id": doc.id, "ref_no": entry.ref_no, **corrected},
        )
    doc.entry_id = entry.id
    entry.document_id = doc.id
    return corrected
