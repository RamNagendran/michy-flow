from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_company_permission
from app.auth.permissions import CompanyPermission as P
from app.core.db import get_db
from app.core.errors import ForbiddenError
from app.models import Party
from app.models.enums import PartyKind
from app.realtime import events
from app.schemas.party import PartyInput, PartyRead
from app.services import party_service
from app.services.access_service import CompanyContext

router = APIRouter(prefix="/companies/{company_id}/parties", tags=["parties"])


# Operators see only the list their entry form needs: suppliers to record a purchase,
# buyers to record a sale.
_KIND_FOR_ENTRY = {PartyKind.SUPPLIER: P.ENTER_PURCHASE, PartyKind.BUYER: P.ENTER_SALES}


@router.get("", response_model=list[PartyRead])
async def list_parties(
    kind: PartyKind | None = None,
    ctx: CompanyContext = Depends(
        require_company_permission(
            P.VIEW_ALL_ENTRIES, P.MANAGE_PARTIES, P.ENTER_PURCHASE, P.ENTER_SALES
        )
    ),
    db: AsyncSession = Depends(get_db),
) -> list[Party]:
    """Suppliers and buyers."""
    if ctx.can(P.VIEW_ALL_ENTRIES) or ctx.can(P.MANAGE_PARTIES):
        return await party_service.list_parties(db, ctx.company.id, kind)
    allowed = {k for k, perm in _KIND_FOR_ENTRY.items() if ctx.can(perm)}
    if kind:
        if kind not in allowed:
            raise ForbiddenError("Not allowed")
        return await party_service.list_parties(db, ctx.company.id, kind)
    if len(allowed) == 1:
        return await party_service.list_parties(db, ctx.company.id, allowed.pop())
    return await party_service.list_parties(db, ctx.company.id, None)


@router.post("", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
async def create_party(
    request: Request,
    data: PartyInput,
    ctx: CompanyContext = Depends(require_company_permission(P.MANAGE_PARTIES)),
    db: AsyncSession = Depends(get_db),
) -> Party:
    party = await party_service.save(db, ctx, data, request=request)
    await events.party_changed(party, ctx.user)
    return party


@router.put("/{party_id}", response_model=PartyRead)
async def update_party(
    request: Request,
    data: PartyInput,
    party_id: int = Path(gt=0),
    ctx: CompanyContext = Depends(require_company_permission(P.MANAGE_PARTIES)),
    db: AsyncSession = Depends(get_db),
) -> Party:
    party = await party_service.save(db, ctx, data, party_id, request)
    await events.party_changed(party, ctx.user)
    return party
