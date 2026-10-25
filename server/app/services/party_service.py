from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, NotFoundError
from app.models import Party
from app.models.enums import PartyKind
from app.schemas.party import PartyInput
from app.services import audit_service
from app.services.access_service import CompanyContext


async def list_parties(db: AsyncSession, company_id: int, kind: PartyKind | None) -> list[Party]:
    query = select(Party).where(Party.company_id == company_id)
    if kind:
        query = query.where(Party.kind == kind)
    return list((await db.scalars(query.order_by(func.lower(Party.name)))).all())


async def get_party(db: AsyncSession, company_id: int, party_id: int) -> Party:
    party = await db.get(Party, party_id)
    if not party or party.company_id != company_id:
        raise NotFoundError("Supplier or buyer not found")
    return party


async def require_party(
    db: AsyncSession, company_id: int, party_id: int, kind: PartyKind, *, allow_inactive: bool
) -> Party:
    """The party an entry points at: same company, right kind, and active for new entries."""
    party = await db.get(Party, party_id)
    if not party or party.company_id != company_id or party.kind != kind:
        raise AppError(f"Choose a {kind} from this company's list", code="unknown_party")
    if not party.is_active and not allow_inactive:
        raise AppError(f"{party.name} is no longer active", code="inactive_party")
    return party


async def save(
    db: AsyncSession,
    ctx: CompanyContext,
    data: PartyInput,
    party_id: int | None = None,
    request: Request | None = None,
) -> Party:
    # One supplier / buyer per name in a company; uploaded bills are matched to parties by name.
    same_name = await db.scalar(
        select(Party.id).where(
            Party.company_id == ctx.company.id,
            Party.kind == data.kind,
            func.lower(func.trim(Party.name)) == data.name.strip().lower(),
            Party.id != (party_id or 0),
        )
    )
    if same_name:
        raise ConflictError(f"A {data.kind} called {data.name} already exists in this company")
    if party_id is None:
        party = Party(company_id=ctx.company.id, **data.model_dump())
        db.add(party)
        changes = data.model_dump()
    else:
        party = await get_party(db, ctx.company.id, party_id)
        if data.kind != party.kind:
            raise AppError("A supplier cannot be turned into a buyer, or the other way round")
        changes = {k: v for k, v in data.model_dump().items() if getattr(party, k) != v}
        for key, value in changes.items():
            setattr(party, key, value)
    await db.flush()
    if changes:
        audit_service.record(
            db,
            account_id=ctx.user.account_id,
            actor=ctx.user,
            action="party_created" if party_id is None else "party_updated",
            entity_type="party",
            entity_id=party.id,
            company_id=ctx.company.id,
            details={"changes": {k: str(v) for k, v in changes.items()}},
            request=request,
        )
    await db.commit()
    return party
