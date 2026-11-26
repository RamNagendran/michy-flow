"""Which items each grade may carry in a company, and the grade a sale gets when none is given.

- Grade A raw material comes in by Grade A purchases and goes out into production, or by
  Grade B sales; Grade A products come out of production and go out by Grade A sales.
- Grade B is only a sale: raw material sold as bought, without production. It comes out of the
  Grade A raw material stock. New purchases are never Grade B (older ones count as Grade A).
- Grade C is a separate book stock of any item: Grade C purchases in, Grade C sales out.

What counts as raw material and product comes from the company's process (models/catalog.py).
"""

from app.core.errors import InvalidError
from app.models import catalog
from app.models.catalog import Process
from app.models.enums import EntryType, Grade

_RULES = {
    (EntryType.PURCHASE, Grade.A): "Grade A purchases are raw material this company processes",
    (EntryType.PURCHASE, Grade.B): "Grade B purchases are raw material bought to re-sell",
    (EntryType.SALE, Grade.A): "Grade A sales are products this company makes",
    (EntryType.SALE, Grade.B): "Grade B sales are raw material re-sold as bought",
}


def allowed_items(entry_type: EntryType, grade: Grade, process: Process) -> frozenset[str]:
    if grade == Grade.C:
        return frozenset(catalog.stocked_items())
    if entry_type == EntryType.SALE and grade == Grade.A:
        return frozenset(process.products)
    return frozenset(process.inputs)


def check_item(entry_type: EntryType, grade: Grade, item: str, process: Process) -> None:
    """Refuse an item the grade cannot carry in this company."""
    if item not in allowed_items(entry_type, grade, process):
        rule = _RULES.get((entry_type, grade), "Weighed waste cannot be bought or sold")
        raise InvalidError(rule, code="item_not_allowed")


def check_purchase_grade(grade: Grade, current: Grade | None) -> None:
    """New purchases are Grade A or C. An older Grade B purchase may keep its grade on an edit."""
    if grade == Grade.B and current != Grade.B:
        raise InvalidError(
            "Purchases are Grade A or Grade C. Grade B is only for selling raw material as bought.",
            code="item_not_allowed",
        )


def default_sale_grade(item: str) -> Grade:
    """Selling a product means it was made here (A); selling raw material is a re-sell (B)."""
    return Grade.B if catalog.is_material(item) else Grade.A


def check_production(process: Process, material: str, outputs: list[str]) -> None:
    if material not in process.inputs:
        raise InvalidError("This company does not process that material", code="item_not_allowed")
    if wrong := [o for o in outputs if o not in process.outputs]:
        raise InvalidError(
            f"This company does not produce {', '.join(wrong)}", code="item_not_allowed"
        )
