"""The approval workflow shared by purchases, sales and production.

    Operator enters  → pending
    Admin            → approve (→ approved) or reject (→ rejected)
    Finance          → verify (→ verified, final) or hold (→ on_hold) with a comment
    On hold          → Finance verifies, or the Admin rejects or edits it (→ approved again)

A production run over the hard wastage limit cannot be approved or verified until the Admin
records a debit note. Finance can also escalate a mismatch to the operations team (a flag,
not a status); the Admin resolves it, or an edit clears it.

Every step, edit and comment is written to entry_events, which is the entry's history.
"""

from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import now
from app.core.errors import AppError, ConflictError, ForbiddenError
from app.models import EntryEvent, Production, Purchase, Sale, User
from app.models.enums import EntryStatus as S
from app.models.enums import EntryType, GlobalRole
from app.services import stock_service, wastage_service
from app.services.access_service import CompanyContext

Entry = Purchase | Sale | Production


@dataclass(frozen=True, slots=True)
class Transition:
    permission: P
    from_statuses: frozenset[S]
    to_status: S
    needs_comment: bool
    event: str


TRANSITIONS: dict[str, Transition] = {
    "approve": Transition(P.APPROVE_ENTRY, frozenset({S.PENDING}), S.APPROVED, False, "approved"),
    "reject": Transition(
        P.APPROVE_ENTRY, frozenset({S.PENDING, S.APPROVED, S.ON_HOLD}), S.REJECTED, True, "rejected"
    ),
    "verify": Transition(
        P.VERIFY_ENTRY, frozenset({S.APPROVED, S.ON_HOLD}), S.VERIFIED, False, "verified"
    ),
    "hold": Transition(P.VERIFY_ENTRY, frozenset({S.APPROVED}), S.ON_HOLD, True, "held"),
}

# Steps a run over the hard wastage limit cannot take without a debit note.
_NEEDS_NOTE_FOR = frozenset({S.APPROVED, S.VERIFIED})

# Once verified, only the Super Admin may still change or remove an entry.
_LOCKED = frozenset({S.VERIFIED})


def _is_super_admin(ctx: CompanyContext) -> bool:
    return ctx.user.global_role == GlobalRole.SUPER_ADMIN


def can_edit(ctx: CompanyContext, entry: Entry) -> bool:
    if not ctx.can(P.EDIT_ENTRY) or entry.status == S.REJECTED:
        return False
    return entry.status not in _LOCKED or _is_super_admin(ctx)


def can_delete(ctx: CompanyContext, entry: Entry) -> bool:
    if not ctx.can(P.DELETE_ENTRY):
        return False
    return entry.status not in _LOCKED or _is_super_admin(ctx)


_ESCALATABLE = frozenset({S.PENDING, S.APPROVED, S.ON_HOLD})


def can_escalate(ctx: CompanyContext, entry: Entry) -> bool:
    return ctx.can(P.VERIFY_ENTRY) and entry.escalated_at is None and entry.status in _ESCALATABLE


def can_resolve(ctx: CompanyContext, entry: Entry) -> bool:
    return entry.escalated_at is not None and (ctx.can(P.APPROVE_ENTRY) or ctx.can(P.EDIT_ENTRY))


def allowed_actions(ctx: CompanyContext, entry: Entry) -> list[str]:
    """The buttons the client should show. The same checks run again when one is pressed."""
    actions = [
        name
        for name, t in TRANSITIONS.items()
        if ctx.can(t.permission) and entry.status in t.from_statuses
    ]
    if can_escalate(ctx, entry):
        actions.append("escalate")
    if can_resolve(ctx, entry):
        actions.append("resolve")
    if ctx.can(P.COMMENT_ENTRY):
        actions.append("comment")
    if can_edit(ctx, entry):
        actions.append("edit")
    if can_delete(ctx, entry):
        actions.append("delete")
    return actions


def initial_status(ctx: CompanyContext, needs_debit_note: bool = False) -> S:
    """Entries made by someone who could approve them start approved; the rest wait. A run
    that needs a debit note always waits, so it cannot skip that step."""
    return S.APPROVED if ctx.can(P.APPROVE_ENTRY) and not needs_debit_note else S.PENDING


def stamp_approval(entry: Entry, actor: User) -> None:
    entry.approved_by_id, entry.approved_at = actor.id, now()


def reset_after_edit(ctx: CompanyContext, entry: Entry, needs_debit_note: bool = False) -> None:
    """An edit sends the entry back through review: to Finance if the editor may approve,
    otherwise to the Admin. Any earlier verification, and any escalation, no longer applies."""
    entry.status = initial_status(ctx, needs_debit_note)
    entry.verified_by_id = entry.verified_at = None
    entry.escalated_at = None
    if entry.status == S.APPROVED:
        stamp_approval(entry, ctx.user)
    else:
        entry.approved_by_id = entry.approved_at = None


def add_event(
    db: AsyncSession,
    *,
    entry_type: EntryType,
    entry: Entry,
    actor: User,
    action: str,
    comment: str = "",
    changes: dict | None = None,
) -> None:
    db.add(
        EntryEvent(
            company_id=entry.company_id,
            entry_type=entry_type,
            entry_id=entry.id,
            actor_id=actor.id,
            action=action,
            comment=comment,
            changes=changes,
        )
    )


async def act(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    entry: Entry,
    action: str,
    comment: str,
    request: Request | None = None,
) -> Entry:
    transition = TRANSITIONS[action]
    if not ctx.can(transition.permission):
        raise ForbiddenError("Not allowed")
    # Locked first, so the status we check is the status we change.
    await stock_service.lock_company(db, entry.company_id)
    await db.refresh(entry, ["status"])
    if entry.status not in transition.from_statuses:
        raise AppError(
            f"This entry is {entry.status.replace('_', ' ')}; it cannot be {transition.event} now",
            code="invalid_status",
        )
    if transition.needs_comment and not comment:
        raise AppError("Please say why in the comment", code="comment_required")
    if (
        transition.to_status in _NEEDS_NOTE_FOR
        and isinstance(entry, Production)
        and wastage_service.needs_debit_note(entry.wastage_pct)
        and not await wastage_service.has_note(db, entry.id)
    ):
        raise ConflictError(
            f"Wastage is over {wastage_service.HARD_LIMIT}%: record a debit note first",
            code="debit_note_required",
        )

    entry.status = transition.to_status
    if transition.to_status == S.APPROVED:
        stamp_approval(entry, ctx.user)
    elif transition.to_status == S.VERIFIED:
        entry.verified_by_id, entry.verified_at = ctx.user.id, now()
    add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action=transition.event,
        comment=comment,
    )
    if transition.to_status == S.REJECTED:
        # Taking a purchase out could leave processed tyres with no stock behind them.
        await stock_service.assert_stock_not_negative(db, entry.company_id)
    await db.commit()
    return entry


async def escalate(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry: Entry, text: str
) -> None:
    """Finance raises a data mismatch with the operations team (Admin, Manager and whoever
    entered it). The entry keeps its status; the flag shows until it is resolved."""
    if not can_escalate(ctx, entry):
        raise ForbiddenError("This entry cannot be escalated")
    if not text:
        raise AppError("Describe the mismatch in the comment", code="comment_required")
    entry.escalated_at = now()
    add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="escalated", comment=text
    )
    await db.commit()


async def resolve(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry: Entry, text: str
) -> None:
    if not can_resolve(ctx, entry):
        raise ForbiddenError("Nothing to resolve")
    if not text:
        raise AppError("Say how it was resolved", code="comment_required")
    entry.escalated_at = None
    add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="resolved", comment=text
    )
    await db.commit()


async def comment(
    db: AsyncSession, ctx: CompanyContext, entry_type: EntryType, entry: Entry, text: str
) -> None:
    if not ctx.can(P.COMMENT_ENTRY):
        raise ForbiddenError("Not allowed")
    add_event(
        db, entry_type=entry_type, entry=entry, actor=ctx.user, action="commented", comment=text
    )
    await db.commit()


async def events_for(db: AsyncSession, entry_type: EntryType, entry_id: int) -> list[tuple]:
    rows = await db.execute(
        select(EntryEvent, User.full_name)
        .outerjoin(User, User.id == EntryEvent.actor_id)
        .where(EntryEvent.entry_type == entry_type, EntryEvent.entry_id == entry_id)
        .order_by(EntryEvent.created_at, EntryEvent.id)
    )
    return list(rows.all())
