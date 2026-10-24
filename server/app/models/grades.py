"""Which items each grade may carry in a company, and the grade a sale gets when none is given.

Stock is kept separately per grade, so the three never mix:
- Grade A raw material comes in by Grade A purchases and goes out only into production;
  Grade A products come out of production and go out by Grade A sales.
- Grade B raw material comes in by Grade B purchases and goes out by Grade B sales (re-sell).
- Grade C is a book stock of any item: Grade C purchases in, Grade C sales out.

What counts as raw material and product comes from the company's process (models/catalog.py).
"""

from app.core.errors import InvalidError
from app.models.catalog import STOCKED_ITEMS, Process
from app.models.enums import EntryType, Grade, Material

_MATERIALS = frozenset(m.value for m in Material)

_RULES = {
    (EntryType.PURCHASE, Grade.A): "Grade A purchases are raw material this company processes",
    (EntryType.PURCHASE, Grade.B): "Grade B purchases are raw material bought to re-sell",
    (EntryType.SALE, Grade.A): "Grade A sales are products this company makes",
    (EntryType.SALE, Grade.B): "Grade B sales are raw material re-sold as bought",
}


def allowed_items(entry_type: EntryType, grade: Grade, process: Process) -> frozenset[str]:
    if grade == Grade.C:
        return frozenset(STOCKED_ITEMS)
    if entry_type == EntryType.SALE and grade == Grade.A:
        return frozenset(process.products)
    return frozenset(process.inputs)


def check_item(entry_type: EntryType, grade: Grade, item: str, process: Process) -> None:
    """Refuse an item the grade cannot carry in this company."""
    if item not in allowed_items(entry_type, grade, process):
        rule = _RULES.get((entry_type, grade), "Weighed waste cannot be bought or sold")
        raise InvalidError(rule, code="item_not_allowed")


def default_sale_grade(item: str) -> Grade:
    """Selling a product means it was made here (A); selling raw material is a re-sell (B)."""
    return Grade.B if item in _MATERIALS else Grade.A


def check_production(process: Process, material: str, outputs: list[str]) -> None:
    if material not in process.inputs:
        raise InvalidError("This company does not process that material", code="item_not_allowed")
    if wrong := [o for o in outputs if o not in process.outputs]:
        raise InvalidError(
            f"This company does not produce {', '.join(wrong)}", code="item_not_allowed"
        )
