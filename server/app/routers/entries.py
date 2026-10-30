from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.models import User
from app.models.enums import EntryStatus, EntryType, Grade
from app.realtime import events
from app.schemas.common import Paginated
from app.schemas.entries import (
    Action,
    ActionRequest,
    CommentRequest,
    EntryDetail,
    EntryRow,
    ProductionInput,
    ProductionUpdate,
    PurchaseInput,
    PurchaseUpdate,
    SaleInput,
    SaleUpdate,
    StatusCount,
)
from app.services import entry_query, entry_service, workflow_service
from app.services.access_service import CompanyContext

router = APIRouter(tags=["entries"])

_EntryId = Path(gt=0)
_one = "/companies/{company_id}/entries/{entry_type}/{entry_id}"


def _filters(
    type: list[EntryType] = Query(default=[]),  # noqa: A002 - matches the query string
    status: list[EntryStatus] = Query(default=[]),
    grade: list[Grade] = Query(default=[]),
    company_id: list[int] = Query(default=[]),
    date_from: date | None = None,
    date_to: date | None = None,
    item: str | None = Query(None, max_length=20),
    q: str | None = Query(None, max_length=100),
    escalated: bool | None = None,
    escalated_to: Literal["incharge", "manager"] | None = None,
    party_id: int | None = Query(None, gt=0),
) -> entry_query.EntryFilters:
    return entry_query.EntryFilters(
        types=set(type),
        statuses=set(status),
        grades=set(grade),
        company_ids=set(company_id),
        date_from=date_from,
        date_to=date_to,
        item=item,
        q=q.strip() if q and q.strip() else None,
        escalated=escalated,
        escalated_to=escalated_to,
        party_id=party_id,
    )


@router.get("/entries", response_model=Paginated[EntryRow])
async def list_entries(
    filters: entry_query.EntryFilters = Depends(_filters),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Paginated[EntryRow]:
    """Purchases, sales and production in one list, newest first, across the companies the
    caller can see. Operators get only their own entries."""
    return await entry_query.list_entries(db, user, filters, page, page_size)


@router.get("/entries/status-summary", response_model=list[StatusCount])
async def entry_status_summary(
    filters: entry_query.EntryFilters = Depends(_filters),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[StatusCount]:
    """How many entries (and how much money) sit in each status, with the list's filters."""
    return await entry_query.status_summary(db, user, filters)


async def _created(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, data
) -> EntryDetail:  # noqa: ANN001
    entry = await entry_service.create(db, ctx, entry_type, data)
    detail = await entry_query.detail(db, ctx, entry_type, entry)
    await events.entry_changed(entry_type, entry, "created", ctx.user)
    return detail


async def _updated(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry_id: int, data
) -> EntryDetail:  # noqa: ANN001
    entry = await entry_service.update(db, ctx, entry_type, entry_id, data)
    detail = await entry_query.detail(db, ctx, entry_type, entry)
    await events.entry_changed(entry_type, entry, "edited", ctx.user)
    return detail


# Creating needs the matching "enter" permission; editing needs EDIT_ENTRY (Super Admin).


@router.post(
    "/companies/{company_id}/purchases",
    response_model=EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("120/minute")
async def create_purchase(
    request: Request,
    data: PurchaseInput,
    ctx: CompanyContext = Depends(require_company_permission(P.ENTER_PURCHASE)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _created(db, ctx, EntryType.PURCHASE, data)


@router.put("/companies/{company_id}/purchases/{entry_id}", response_model=EntryDetail)
async def update_purchase(
    data: PurchaseUpdate,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.EDIT_ENTRY)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _updated(db, ctx, EntryType.PURCHASE, entry_id, data)


@router.post(
    "/companies/{company_id}/sales", response_model=EntryDetail, status_code=status.HTTP_201_CREATED
)
@limiter.limit("120/minute")
async def create_sale(
    request: Request,
    data: SaleInput,
    ctx: CompanyContext = Depends(require_company_permission(P.ENTER_SALES)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _created(db, ctx, EntryType.SALE, data)


@router.put("/companies/{company_id}/sales/{entry_id}", response_model=EntryDetail)
async def update_sale(
    data: SaleUpdate,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.EDIT_ENTRY)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _updated(db, ctx, EntryType.SALE, entry_id, data)


@router.post(
    "/companies/{company_id}/production",
    response_model=EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("120/minute")
async def create_production(
    request: Request,
    data: ProductionInput,
    ctx: CompanyContext = Depends(require_company_permission(P.ENTER_PRODUCTION)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _created(db, ctx, EntryType.PRODUCTION, data)


@router.put("/companies/{company_id}/production/{entry_id}", response_model=EntryDetail)
async def update_production(
    data: ProductionUpdate,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.EDIT_ENTRY)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    return await _updated(db, ctx, EntryType.PRODUCTION, entry_id, data)


# One entry: detail, workflow steps and comments. Entries are never deleted.


@router.get(_one, response_model=EntryDetail)
async def get_entry(
    entry_type: EntryType,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    entry = await entry_service.get_entry(db, ctx, entry_type, entry_id)
    return await entry_query.detail(db, ctx, entry_type, entry, just_loaded=True)


@router.post(_one + "/actions/{action}", response_model=EntryDetail)
async def act_on_entry(
    request: Request,
    entry_type: EntryType,
    action: Action,
    data: ActionRequest,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.VIEW)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    """approve / request_change (Manager), verify (Finance), reject (Super Admin).
    request_change and reject need a comment."""
    entry = await entry_service.get_entry(db, ctx, entry_type, entry_id)
    await workflow_service.act(db, ctx, entry_type, entry, action, data.comment, request)
    detail = await entry_query.detail(db, ctx, entry_type, entry)
    await events.entry_changed(
        entry_type, entry, workflow_service.TRANSITIONS[action].event, ctx.user
    )
    return detail


@router.post(_one + "/comments", response_model=EntryDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
async def comment_on_entry(
    request: Request,
    entry_type: EntryType,
    data: CommentRequest,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.COMMENT_ENTRY)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    entry = await entry_service.get_entry(db, ctx, entry_type, entry_id)
    await workflow_service.comment(db, ctx, entry_type, entry, data.comment, request)
    detail = await entry_query.detail(db, ctx, entry_type, entry)
    await events.entry_changed(entry_type, entry, "commented", ctx.user)
    return detail


@router.post(_one + "/escalate", response_model=EntryDetail)
async def escalate_entry(
    request: Request,
    entry_type: EntryType,
    data: CommentRequest,
    entry_id: int = _EntryId,
    ctx: CompanyContext = Depends(require_company_permission(P.APPROVE_ENTRY, P.VERIFY_ENTRY)),
    db: AsyncSession = Depends(get_db),
) -> EntryDetail:
    """The Manager sends a pending entry back to the in-charge, or Finance sends an approved
    one back to the Manager, with a comment. They talk in the comments until the asker
    approves."""
    entry = await entry_service.get_entry(db, ctx, entry_type, entry_id)
    await workflow_service.escalate(db, ctx, entry_type, entry, data.comment, request)
    detail = await entry_query.detail(db, ctx, entry_type, entry)
    await events.entry_changed(entry_type, entry, "escalated", ctx.user, "escalated")
    return detail
