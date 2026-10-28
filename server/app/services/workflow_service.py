"""The approval workflow shared by purchases, sales and production.

    In-charge enters      → pending (does not count in stock yet)
    Manager               → approve (→ approved; now it counts in stock)
                            or escalate to the in-charge (a flag; they talk in the comments)
                            or ask the Super Admin to change it (→ change_requested)
    Finance               → approve (→ verified, final)
                            or escalate to the Manager (a flag; they talk in the comments)
    Super Admin           → edit a change request (→ pending, back to the Manager) or reject

An escalation stays open through any number of comments; the side that raised it closes it by
approving. Nobody deletes entries.

Every step, edit and comment is written to entry_events (the entry's history) and to the
company audit log.
"""

from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import CompanyPermission as P
from app.core.clock import now
from app.core.errors import AppError, ForbiddenError
from app.models import EntryEvent, Production, Purchase, Sale, User
from app.models.enums import EntryStatus as S
from app.models.enums import EntryType
from app.services import audit_service, stock_service
from app.services.access_service import CompanyContext

Entry = Purchase | Sale | Production

# Who an open escalation is waiting on.
TO_INCHARGE = "incharge"  # raised by the Manager
TO_MANAGER = "manager"  # raised by Finance


@dataclass(frozen=True, slots=True)
class Transition:
    permission: P
    from_statuses: frozenset[S]
    to_status: S
    needs_comment: bool
    event: str


TRANSITIONS: dict[str, Transition] = {
    # Manager
    "approve": Transition(P.APPROVE_ENTRY, frozenset({S.PENDING}), S.APPROVED, False, "approved"),
    "request_change": Transition(
        P.APPROVE_ENTRY,
        frozenset({S.PENDING, S.APPROVED}),
        S.CHANGE_REQUESTED,
        True,
        "change_requested",
    ),
    # Finance
    "verify": Transition(P.VERIFY_ENTRY, frozenset({S.APPROVED}), S.VERIFIED, False, "verified"),
    # Super Admin
    "reject": Transition(
        P.REJECT_ENTRY,
        frozenset({S.PENDING, S.APPROVED, S.CHANGE_REQUESTED, S.VERIFIED}),
        S.REJECTED,
        True,
        "rejected",
    ),
}


def can_edit(ctx: CompanyContext, entry: Entry) -> bool:
    """Only the Super Admin edits, and never a rejected entry."""
    return ctx.can(P.EDIT_ENTRY) and entry.status != S.REJECTED


def escalation_target(ctx: CompanyContext, entry: Entry) -> str | None:
    """Who this person would escalate to now, if they may: the Manager sends a pending entry
    back to the in-charge, Finance sends an approved one back to the Manager."""
    if entry.escalated_at is not None:
        return None
    if entry.status == S.PENDING and ctx.can(P.APPROVE_ENTRY):
        return TO_INCHARGE
    if entry.status == S.APPROVED and ctx.can(P.VERIFY_ENTRY):
        return TO_MANAGER
    return None


def allowed_actions(ctx: CompanyContext, entry: Entry) -> list[str]:
    """The buttons the client should show. The same checks run again when one is pressed."""
    actions = [
        name
        for name, t in TRANSITIONS.items()
        if ctx.can(t.permission) and entry.status in t.from_statuses
    ]
    if escalation_target(ctx, entry):
        actions.append("escalate")
    if ctx.can(P.COMMENT_ENTRY):
        actions.append("comment")
    if can_edit(ctx, entry):
        actions.append("edit")
    return actions


def initial_status() -> S:
    """Every new entry waits for the Manager, whoever entered it."""
    return S.PENDING


def stamp_approval(entry: Entry, actor: User) -> None:
    entry.approved_by_id, entry.approved_at = actor.id, now()


def reset_after_edit(entry: Entry) -> None:
    """A Super Admin edit sends the entry back to the Manager, then Finance. approved_at is
    kept, so an entry that already counted in stock keeps counting (with its new values)."""
    entry.status = S.PENDING
    entry.verified_by_id = entry.verified_at = None
    entry.escalated_at = entry.escalated_to = None


def add_event(
    db: AsyncSession,
    *,
    entry_type: EntryType,
    entry: Entry,
    actor: User,
    action: str,
    comment: str = "",
    changes: dict | None = None,
    request: Request | None = None,
) -> None:
    """Write one step to the entry's history and to the company audit log."""
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
    details: dict = {"ref_no": entry.ref_no, "status": entry.status}
    if comment:
        details["comment"] = comment
    if changes:
        details["changes"] = changes
    if entry.escalated_to and action == "escalated":
        details["escalated_to"] = entry.escalated_to
    audit_service.record(
        db,
        account_id=actor.account_id,
        actor=actor,
        action=f"entry.{action}",
        entity_type=entry_type.value,
        entity_id=entry.id,
        company_id=entry.company_id,
        details=details,
        request=request,
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
        raise AppError("Please write the reason in the comment", code="comment_required")

    entry.status = transition.to_status
    if transition.to_status == S.APPROVED:
        # The first approval puts it in stock; after a Super Admin edit it is already there.
        if entry.approved_at is None:
            stamp_approval(entry, ctx.user)
        else:
            entry.approved_by_id = ctx.user.id
    elif transition.to_status == S.VERIFIED:
        entry.verified_by_id, entry.verified_at = ctx.user.id, now()
    # Approving closes the asker's own escalation; a change request or rejection ends it too.
    entry.escalated_at = entry.escalated_to = None
    add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action=transition.event,
        comment=comment,
        request=request,
    )
    if transition.to_status == S.REJECTED and isinstance(entry, Purchase):
        from app.services import debit_note_service  # local: it imports this module

        await debit_note_service.reopen_for(db, ctx, entry, f"{entry.ref_no} was rejected")
    if transition.to_status in (S.APPROVED, S.REJECTED):
        # Approving a sale must not sell more than is in stock; rejecting a purchase must not
        # leave processed tyres with no stock behind them.
        await stock_service.assert_stock_not_negative(db, entry.company_id)
    await db.commit()
    return entry


async def escalate(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    entry: Entry,
    text: str,
    request: Request | None = None,
) -> None:
    """The Manager asks the in-charge, or Finance asks the Manager, with a comment. The entry
    keeps its status; they talk in the comments until the asker approves."""
    target = escalation_target(ctx, entry)
    if target is None:
        raise ForbiddenError("This entry cannot be escalated now")
    if not text:
        raise AppError("Write what is wrong in the comment", code="comment_required")
    entry.escalated_at, entry.escalated_to = now(), target
    add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action="escalated",
        comment=text,
        request=request,
    )
    await db.commit()


async def comment(
    db: AsyncSession,
    ctx: CompanyContext,
    entry_type: EntryType,
    entry: Entry,
    text: str,
    request: Request | None = None,
) -> None:
    if not ctx.can(P.COMMENT_ENTRY):
        raise ForbiddenError("Not allowed")
    add_event(
        db,
        entry_type=entry_type,
        entry=entry,
        actor=ctx.user,
        action="commented",
        comment=text,
        request=request,
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
