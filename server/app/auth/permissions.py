"""Who may do what. This module is the single source of truth for access control.

There are two levels:
- System permissions (manage companies, users, configuration) come only from a global role.
- Company permissions come from the person's role in that company, or from a global role,
  which applies to every company in the account.

The client never decides access on its own: /auth/me sends the resolved permission lists.
"""

from collections.abc import Iterable
from enum import StrEnum

from app.models.enums import CompanyRole, Duty, EntryType, GlobalRole


class SystemPermission(StrEnum):
    MANAGE_COMPANIES = "manage_companies"
    MANAGE_USERS = "manage_users"
    MANAGE_CONFIG = "manage_config"  # product / material lists, conversion factors
    VIEW_AUDIT = "view_audit"


class CompanyPermission(StrEnum):
    VIEW = "view"  # open the company at all; on its own it shows nothing else
    VIEW_STOCK = "view_stock"  # stock screens; operators get stock only through their entry forms
    VIEW_ALL_ENTRIES = "view_all_entries"  # without it, only the entries you made yourself
    COMMENT_ENTRY = "comment_entry"
    ENTER_PURCHASE = "enter_purchase"
    ENTER_SALES = "enter_sales"
    ENTER_PRODUCTION = "enter_production"
    EDIT_ENTRY = "edit_entry"  # Super Admin only, after the Manager asks for a change
    REJECT_ENTRY = "reject_entry"  # Super Admin only
    APPROVE_ENTRY = "approve_entry"  # Manager: approve, escalate to the in-charge, ask for a change
    VERIFY_ENTRY = "verify_entry"  # Finance: final approve, escalate to the Manager
    MANAGE_PARTIES = "manage_parties"  # suppliers and buyers
    ADJUST_WASTAGE = "adjust_wastage"  # Manager: stock checks; answers wastage escalations
    APPROVE_WASTAGE = "approve_wastage"  # Super Admin only: approve, change or escalate a month
    MANAGE_GRADES = "manage_grades"
    VIEW_FINANCE = "view_finance"
    VIEW_OIL_KPI = "view_oil_kpi"
    VIEW_AUDIT = "view_audit"


_CP = CompanyPermission
_SEE_AND_DISCUSS = frozenset({_CP.VIEW, _CP.VIEW_ALL_ENTRIES, _CP.VIEW_STOCK, _CP.COMMENT_ENTRY})

SYSTEM_PERMISSIONS: dict[GlobalRole, frozenset[SystemPermission]] = {
    GlobalRole.SUPER_ADMIN: frozenset(SystemPermission),
    GlobalRole.CEO: frozenset(),
}

GLOBAL_COMPANY_PERMISSIONS: dict[GlobalRole, frozenset[CompanyPermission]] = {
    GlobalRole.SUPER_ADMIN: frozenset(CompanyPermission),
    # Read-only across every company.
    GlobalRole.CEO: frozenset(
        {_CP.VIEW, _CP.VIEW_ALL_ENTRIES, _CP.VIEW_STOCK, _CP.VIEW_FINANCE, _CP.VIEW_OIL_KPI}
    ),
}

COMPANY_ROLE_PERMISSIONS: dict[CompanyRole, frozenset[CompanyPermission]] = {
    # Checks every in-charge entry first: approves, escalates to the in-charge, or asks the
    # Super Admin to change it. Runs the company: suppliers and buyers, stock checks, and
    # answers the Super Admin's questions on a month's wastage.
    # Never enters, edits or rejects an entry.
    CompanyRole.MANAGER: _SEE_AND_DISCUSS
    | {
        _CP.APPROVE_ENTRY,
        _CP.MANAGE_PARTIES,
        _CP.ADJUST_WASTAGE,
        _CP.MANAGE_GRADES,
        _CP.VIEW_FINANCE,
        _CP.VIEW_OIL_KPI,
        _CP.VIEW_AUDIT,
    },
    # Final approval after the Manager, or escalates back to the Manager. Cannot edit.
    CompanyRole.FINANCE: _SEE_AND_DISCUSS | {_CP.VERIFY_ENTRY, _CP.VIEW_FINANCE},
    # In-charges: enter the kinds ticked for them, see their own entries and the stock, and
    # talk in the comments when the Manager escalates.
    CompanyRole.OPERATOR: frozenset({_CP.VIEW, _CP.VIEW_STOCK, _CP.COMMENT_ENTRY}),
}

# Duty.SHIFT grants no permission; it only puts the person in the shift crew list.
DUTY_PERMISSIONS: dict[Duty, CompanyPermission] = {
    Duty.PURCHASE: _CP.ENTER_PURCHASE,
    Duty.SALES: _CP.ENTER_SALES,
    Duty.PRODUCTION: _CP.ENTER_PRODUCTION,
}


# Which "enter" permission goes with each kind of entry.
ENTER_PERMISSION: dict[EntryType, CompanyPermission] = {
    EntryType.PURCHASE: _CP.ENTER_PURCHASE,
    EntryType.SALE: _CP.ENTER_SALES,
    EntryType.PRODUCTION: _CP.ENTER_PRODUCTION,
}


def visible_entry_types(perms: frozenset[CompanyPermission]) -> frozenset[EntryType]:
    """Kinds of entry someone may read in a company: every kind with VIEW_ALL_ENTRIES,
    otherwise only the kinds they may enter (an operator ticked for purchases sees only
    purchases, even ones they made before a duty was taken away)."""
    if _CP.VIEW_ALL_ENTRIES in perms:
        return frozenset(EntryType)
    return frozenset(t for t, p in ENTER_PERMISSION.items() if p in perms)


def _global_role(value: str | None) -> GlobalRole | None:
    return GlobalRole(value) if value in GlobalRole._value2member_map_ else None


def system_permissions(global_role: str | None) -> frozenset[SystemPermission]:
    role = _global_role(global_role)
    return SYSTEM_PERMISSIONS[role] if role else frozenset()


def global_company_permissions(global_role: str | None) -> frozenset[CompanyPermission]:
    role = _global_role(global_role)
    return GLOBAL_COMPANY_PERMISSIONS[role] if role else frozenset()


def membership_permissions(role: str, duties: Iterable[str]) -> frozenset[CompanyPermission]:
    """Permissions for one company membership. Unknown roles or duties grant nothing."""
    if role not in CompanyRole._value2member_map_:
        return frozenset()
    base = COMPANY_ROLE_PERMISSIONS[CompanyRole(role)]
    if role != CompanyRole.OPERATOR:
        return base
    extra = {DUTY_PERMISSIONS[d] for d in duties if d in DUTY_PERMISSIONS}
    return base | extra
