"""Who may do what. This module is the single source of truth for access control.

There are two levels:
- System permissions (manage companies, users, configuration) come only from a global role.
- Company permissions come from the person's role in that company, or from a global role,
  which applies to every company in the account.

The client never decides access on its own: /auth/me sends the resolved permission lists.
"""

from collections.abc import Iterable
from enum import StrEnum

from app.models.enums import CompanyRole, Duty, GlobalRole


class SystemPermission(StrEnum):
    MANAGE_COMPANIES = "manage_companies"
    MANAGE_USERS = "manage_users"
    MANAGE_CONFIG = "manage_config"  # product / material lists, conversion factors
    VIEW_AUDIT = "view_audit"


class CompanyPermission(StrEnum):
    VIEW = "view"
    VIEW_ALL_ENTRIES = "view_all_entries"  # without it, only the entries you made yourself
    COMMENT_ENTRY = "comment_entry"
    ENTER_PURCHASE = "enter_purchase"
    ENTER_SALES = "enter_sales"
    ENTER_PRODUCTION = "enter_production"
    EDIT_ENTRY = "edit_entry"
    DELETE_ENTRY = "delete_entry"
    APPROVE_ENTRY = "approve_entry"  # admin review step
    VERIFY_ENTRY = "verify_entry"  # finance approve / hold / comment
    MANAGE_PARTIES = "manage_parties"  # suppliers and buyers
    ADJUST_WASTAGE = "adjust_wastage"
    MANAGE_GRADES = "manage_grades"
    VIEW_FINANCE = "view_finance"
    VIEW_OIL_KPI = "view_oil_kpi"
    VIEW_AUDIT = "view_audit"


_CP = CompanyPermission
_ENTER_ALL = frozenset({_CP.ENTER_PURCHASE, _CP.ENTER_SALES, _CP.ENTER_PRODUCTION})
_SEE_AND_DISCUSS = frozenset({_CP.VIEW, _CP.VIEW_ALL_ENTRIES, _CP.COMMENT_ENTRY})

SYSTEM_PERMISSIONS: dict[GlobalRole, frozenset[SystemPermission]] = {
    GlobalRole.SUPER_ADMIN: frozenset(SystemPermission),
    GlobalRole.CEO: frozenset(),
}

GLOBAL_COMPANY_PERMISSIONS: dict[GlobalRole, frozenset[CompanyPermission]] = {
    GlobalRole.SUPER_ADMIN: frozenset(CompanyPermission),
    # Read-only across every company.
    GlobalRole.CEO: frozenset({_CP.VIEW, _CP.VIEW_ALL_ENTRIES, _CP.VIEW_FINANCE, _CP.VIEW_OIL_KPI}),
}

COMPANY_ROLE_PERMISSIONS: dict[CompanyRole, frozenset[CompanyPermission]] = {
    # Runs the entity: enters and edits data, manages suppliers and buyers.
    # No financial edits and no deleting (that needs the Admin).
    CompanyRole.MANAGER: _ENTER_ALL
    | _SEE_AND_DISCUSS
    | {_CP.EDIT_ENTRY, _CP.MANAGE_PARTIES, _CP.VIEW_FINANCE, _CP.VIEW_OIL_KPI},
    # Primary data verifier: approves operator entries, wastage and grade stock.
    CompanyRole.ADMIN: _ENTER_ALL
    | _SEE_AND_DISCUSS
    | {
        _CP.EDIT_ENTRY,
        _CP.DELETE_ENTRY,
        _CP.APPROVE_ENTRY,
        _CP.MANAGE_PARTIES,
        _CP.ADJUST_WASTAGE,
        _CP.MANAGE_GRADES,
        _CP.VIEW_FINANCE,
        _CP.VIEW_AUDIT,
    },
    # Cross-verifies and approves or holds. Cannot edit raw data.
    CompanyRole.FINANCE: _SEE_AND_DISCUSS | {_CP.VERIFY_ENTRY, _CP.VIEW_FINANCE},
    # Input only, and sees only their own entries. They can reply when Finance raises a query.
    # Which inputs they may make depends on the duties ticked for them.
    CompanyRole.OPERATOR: frozenset({_CP.VIEW, _CP.COMMENT_ENTRY}),
}

DUTY_PERMISSIONS: dict[Duty, CompanyPermission] = {
    Duty.PURCHASE: _CP.ENTER_PURCHASE,
    Duty.SALES: _CP.ENTER_SALES,
    Duty.PRODUCTION: _CP.ENTER_PRODUCTION,
}


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
    extra = {DUTY_PERMISSIONS[Duty(d)] for d in duties if d in Duty._value2member_map_}
    return base | extra
