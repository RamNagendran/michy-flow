"""The permission table itself, checked against the client's requirements document."""

from app.auth.permissions import (
    CompanyPermission as P,
)
from app.auth.permissions import (
    SystemPermission,
    global_company_permissions,
    membership_permissions,
    system_permissions,
    visible_entry_types,
)


def test_super_admin_has_everything() -> None:
    assert system_permissions("super_admin") == frozenset(SystemPermission)
    assert global_company_permissions("super_admin") == frozenset(P)


def test_ceo_is_read_only_everywhere() -> None:
    assert system_permissions("ceo") == frozenset()
    perms = global_company_permissions("ceo")
    assert {P.VIEW, P.VIEW_ALL_ENTRIES, P.VIEW_STOCK, P.VIEW_FINANCE, P.VIEW_OIL_KPI} == perms
    assert P.COMMENT_ENTRY not in perms


def test_company_people_have_no_system_permissions() -> None:
    assert system_permissions(None) == frozenset()
    assert system_permissions("not-a-role") == frozenset()


def test_manager_checks_entries_and_runs_the_company() -> None:
    perms = membership_permissions("manager", [])
    assert {P.VIEW_ALL_ENTRIES, P.VIEW_STOCK, P.APPROVE_ENTRY, P.MANAGE_PARTIES} <= perms
    assert {P.ADJUST_WASTAGE, P.MANAGE_GRADES, P.VIEW_OIL_KPI, P.VIEW_AUDIT} <= perms
    # Never enters, edits, rejects or gives Finance's approval.
    assert not {P.ENTER_PURCHASE, P.ENTER_SALES, P.ENTER_PRODUCTION} & perms
    assert not {P.EDIT_ENTRY, P.REJECT_ENTRY, P.VERIFY_ENTRY} & perms


def test_the_admin_role_is_gone() -> None:
    assert membership_permissions("admin", []) == frozenset()


def test_only_the_super_admin_edits_or_rejects() -> None:
    for role in ("manager", "finance", "operator"):
        perms = membership_permissions(role, ["purchase", "sales", "production"])
        assert not {P.EDIT_ENTRY, P.REJECT_ENTRY} & perms
    assert {P.EDIT_ENTRY, P.REJECT_ENTRY} <= global_company_permissions("super_admin")


def test_finance_verifies_but_cannot_enter_or_edit() -> None:
    perms = membership_permissions("finance", [])
    expected = {P.VIEW, P.VIEW_ALL_ENTRIES, P.VIEW_STOCK, P.COMMENT_ENTRY, P.VERIFY_ENTRY}
    assert expected | {P.VIEW_FINANCE} == perms


def test_operator_gets_only_the_duties_ticked() -> None:
    base = {P.VIEW, P.VIEW_STOCK, P.COMMENT_ENTRY}
    assert membership_permissions("operator", []) == base
    assert membership_permissions("operator", ["purchase"]) == base | {P.ENTER_PURCHASE}
    perms = membership_permissions("operator", ["sales", "production", "bogus"])
    assert perms == base | {P.ENTER_SALES, P.ENTER_PRODUCTION}
    # In-charges see only their own entries, plus the stock.
    assert P.VIEW_ALL_ENTRIES not in perms
    assert P.EDIT_ENTRY not in perms and P.APPROVE_ENTRY not in perms
    # A shift worker enters nothing; the duty only puts them in the shift crew list.
    assert membership_permissions("operator", ["shift"]) == base


def test_duties_do_not_widen_other_roles() -> None:
    assert membership_permissions("finance", ["purchase"]) == membership_permissions("finance", [])


def test_unknown_role_grants_nothing() -> None:
    assert membership_permissions("owner", ["purchase"]) == frozenset()


def test_operators_see_only_the_entry_kinds_they_enter() -> None:
    assert visible_entry_types(membership_permissions("operator", ["purchase"])) == {"purchase"}
    assert visible_entry_types(membership_permissions("operator", [])) == frozenset()
    assert visible_entry_types(membership_permissions("finance", [])) == {
        "purchase",
        "sale",
        "production",
    }
