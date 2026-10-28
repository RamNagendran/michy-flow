from enum import StrEnum


class GlobalRole(StrEnum):
    """System-wide roles. Stored as a plain string column, so adding a role needs no migration."""

    SUPER_ADMIN = "super_admin"
    CEO = "ceo"


class CompanyRole(StrEnum):
    """The role a person holds inside one company (entity)."""

    MANAGER = "manager"
    FINANCE = "finance"
    OPERATOR = "operator"


class Duty(StrEnum):
    """What an operator is allowed to enter. Only meaningful for CompanyRole.OPERATOR."""

    PURCHASE = "purchase"
    SALES = "sales"
    PRODUCTION = "production"
    # Works in the plant on production shifts. Enters nothing; can be put on a shift's crew.
    SHIFT = "shift"


class EntryType(StrEnum):
    PURCHASE = "purchase"
    SALE = "sale"
    PRODUCTION = "production"


class EntryStatus(StrEnum):
    """Where an entry is in the approval workflow (see services/workflow_service.py).

    - pending           → approved (Manager) or change_requested (Manager asks the Super Admin)
    - approved          → verified (Finance) or change_requested (Manager)
    - change_requested  → pending (Super Admin edits it) or rejected (Super Admin)
    - Only the Super Admin rejects. verified and rejected are final.
    Escalations are a flag on the entry, not a status (see workflow_service).
    """

    PENDING = "pending"  # entered (or edited by the Super Admin), waiting for the Manager
    APPROVED = "approved"  # Manager approved, waiting for Finance
    CHANGE_REQUESTED = "change_requested"  # Manager asked the Super Admin to edit or reject
    VERIFIED = "verified"  # Finance approved: final
    REJECTED = "rejected"  # thrown out by the Super Admin; never counts in stock


class EntrySource(StrEnum):
    MANUAL = "manual"
    AI = "ai"  # read from an uploaded bill, then checked by a person


class PartyKind(StrEnum):
    SUPPLIER = "supplier"
    BUYER = "buyer"


class Material(StrEnum):
    """What goes into production (see models/catalog.py for which company type uses which)."""

    TRUCK = "truck"
    CAR = "car"
    TWO_WHEELER = "twowheeler"
    OTR = "otr"
    TRACTOR = "tractor"
    SCRAP_STEEL = "scrap_steel"


class OutputProduct(StrEnum):
    """What production yields. Oil is measured in litres, everything else in kg."""

    RUBBER = "rubber"  # rubber crumbs
    STEEL = "steel"
    OIL = "oil"
    CARBON = "carbon"  # carbon powder
    OTHER = "other"  # fibre / fluff
    WASTE_WATER = "waste_water"
    WASTE = "waste"  # weighed waste; not stock, never sold


class CompanyCategory(StrEnum):
    """What kind of plant a company runs. Decides its inputs and outputs (models/catalog.py)."""

    PYROLYSIS = "pyrolysis"  # tyres → oil, carbon powder, steel, waste water
    CRUMB = "crumb"  # tyres → rubber crumbs, steel, fibre
    STEEL = "steel"  # scrap steel → steel


class Grade(StrEnum):
    """How a purchase or sale moves goods (see models/grades.py for the rules).

    - A: physical, through the plant. Tyres bought for production; products made and sold.
    - B: physical, re-sold as bought. Tyres bought and sold on without processing.
    - C: invoice / financial record only. No goods move; kept in a separate book stock.
    """

    A = "A"
    B = "B"
    C = "C"
