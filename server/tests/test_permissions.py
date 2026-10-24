"""The permission table itself, checked against the client's requirements document."""

from app.auth.permissions import (
    CompanyPermission as P,
)
from app.auth.permissions import (
    SystemPermission,
    global_company_permissions,
    membership_permissions,
    system_permissions,
)


def test_super_admin_has_everything() -> None:
    assert system_permissions("super_admin") == frozenset(SystemPermission)
    assert global_company_permissions("super_admin") == frozenset(P)


def test_ceo_is_read_only_everywhere() -> None:
    assert system_permissions("ceo") == frozenset()
    perms = global_company_permissions("ceo")
    assert {P.VIEW, P.VIEW_ALL_ENTRIES, P.VIEW_FINANCE, P.VIEW_OIL_KPI} == perms
    assert P.COMMENT_ENTRY not in perms


def test_company_people_have_no_system_permissions() -> None:
    assert system_permissions(None) == frozenset()
    assert system_permissions("not-a-role") == frozenset()


def test_manager_edits_but_cannot_delete_or_verify() -> None:
    perms = membership_permissions("manager", [])
    assert {P.MANAGE_PARTIES, P.EDIT_ENTRY, P.VIEW_OIL_KPI} <= perms
    assert P.DELETE_ENTRY not in perms
    assert P.APPROVE_ENTRY not in perms
    assert P.VERIFY_ENTRY not in perms


def test_admin_approves_and_manages_wastage_and_grades() -> None:
    perms = membership_permissions("admin", [])
    assert {P.APPROVE_ENTRY, P.ADJUST_WASTAGE, P.MANAGE_GRADES, P.DELETE_ENTRY} <= perms
    assert P.VERIFY_ENTRY not in perms


def test_finance_verifies_but_cannot_enter_or_edit() -> None:
    perms = membership_permissions("finance", [])
    assert {P.VIEW, P.VIEW_ALL_ENTRIES, P.COMMENT_ENTRY, P.VERIFY_ENTRY, P.VIEW_FINANCE} == perms


def test_operator_gets_only_the_duties_ticked() -> None:
    base = {P.VIEW, P.COMMENT_ENTRY}
    assert membership_permissions("operator", []) == base
    assert membership_permissions("operator", ["purchase"]) == base | {P.ENTER_PURCHASE}
    perms = membership_permissions("operator", ["sales", "production", "bogus"])
    assert perms == base | {P.ENTER_SALES, P.ENTER_PRODUCTION}
    # Operators see only their own entries.
    assert P.VIEW_ALL_ENTRIES not in perms
    assert P.EDIT_ENTRY not in perms and P.DELETE_ENTRY not in perms


def test_duties_do_not_widen_other_roles() -> None:
    assert membership_permissions("finance", ["purchase"]) == membership_permissions("finance", [])


def test_unknown_role_grants_nothing() -> None:
    assert membership_permissions("owner", ["purchase"]) == frozenset()
