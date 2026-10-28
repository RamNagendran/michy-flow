from fastapi import APIRouter, Depends, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.models.enums import EntryType
from app.realtime import events
from app.schemas.entries import DebitNoteInput, DebitNoteRead, EntryDetail
from app.services import debit_note_service, entry_query, entry_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}", tags=["debit notes"])

# The purchase in-charge or the Manager (and the Super Admin, who has every permission).
_purchase_side = require_company_permission(P.ENTER_PURCHASE, P.APPROVE_ENTRY)
_see = require_company_permission(P.VIEW_ALL_ENTRIES, P.ENTER_PURCHASE)


class AdjustRequest(BaseModel):
    note_ids: list[int] = Field(min_length=1, max_length=50)


@router.get("/debit-notes", response_model=list[DebitNoteRead])
async def list_debit_notes(
    supplier_id: int | None = Query(None, gt=0),
    open: bool = False,  # noqa: A002 - matches the query string
    ctx: CompanyContext = Depends(_see),
    db: AsyncSession = Depends(get_db),
) -> list[DebitNoteRead]:
    """Debit notes against suppliers, oldest first. `open=true`: only those not yet settled
    (shown while a purchase from that supplier is entered)."""
    return await debit_note_service.list_notes(db, ctx.company.id, supplier_id, open)


@router.post(
    "/purchases/{purchase_id}/debit-notes",
    response_model=EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
async def raise_debit_note(
    request: Request,
    data: DebitNoteInput,
    purchase_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(_purchase_side),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    """Flag an issue with this purchase for the team; shown on the supplier's next purchases."""
    purchase = await entry_service.get_entry(db, ctx, EntryType.PURCHASE, purchase_id)
    await debit_note_service.raise_note(db, ctx, purchase, data, request)
    detail = await entry_query.detail(db, ctx, EntryType.PURCHASE, purchase)
    await events.entry_changed(EntryType.PURCHASE, purchase, "debit_note", ctx.user)
    return detail


@router.post("/purchases/{purchase_id}/debit-notes/adjust", response_model=EntryDetail)
async def adjust_debit_notes(
    request: Request,
    data: AdjustRequest,
    purchase_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(_purchase_side),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    """These open debit notes of the supplier are settled on this purchase."""
    purchase = await entry_service.get_entry(db, ctx, EntryType.PURCHASE, purchase_id)
    await debit_note_service.adjust(db, ctx, purchase, data.note_ids, request=request)
    detail = await entry_query.detail(db, ctx, EntryType.PURCHASE, purchase)
    await events.entry_changed(EntryType.PURCHASE, purchase, "debit_note_adjusted", ctx.user)
    return detail
