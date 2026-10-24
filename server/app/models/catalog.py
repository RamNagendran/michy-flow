"""Items, their units, and what each company puts in and gets out of production.

Quantities are stored in each item's own unit: litres for oil, kg for everything else.
Production balances by weight, so litres are turned into kg with the company's oil density.

Each company type has default inputs and outputs (PROCESSES); the Super Admin can then set a
company's own lists (its inventory configuration, stored on the company).
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from app.models.enums import CompanyCategory, Material, OutputProduct

KG = "kg"
LITRE = "L"


# kg per litre of oil: the allowed range, and the default for a new company.
OIL_DENSITY_MIN = Decimal("1.030")
OIL_DENSITY_MAX = Decimal("1.050")
OIL_DENSITY_DEFAULT = Decimal("1.040")


@dataclass(frozen=True, slots=True)
class ItemSpec:
    unit: str
    # Kept in stock and can be sold. Weighed waste is recorded but never stocked.
    stocked: bool = True


ITEMS: dict[str, ItemSpec] = {
    **{m.value: ItemSpec(KG) for m in Material},
    **{p.value: ItemSpec(KG) for p in OutputProduct},
    OutputProduct.OIL.value: ItemSpec(LITRE),
    OutputProduct.WASTE.value: ItemSpec(KG, stocked=False),
}

_TYRES = (
    Material.TRUCK,
    Material.CAR,
    Material.TRACTOR,
    Material.TWO_WHEELER,
    Material.OTR,
)


@dataclass(frozen=True, slots=True)
class Process:
    inputs: tuple[str, ...]
    # In the order they are shown. Every process may also record weighed waste.
    outputs: tuple[str, ...]

    @property
    def products(self) -> tuple[str, ...]:
        """Outputs that go into stock and can be sold."""
        return tuple(o for o in self.outputs if ITEMS[o].stocked)


PROCESSES: dict[CompanyCategory, Process] = {
    CompanyCategory.PYROLYSIS: Process(
        inputs=_TYRES,
        outputs=(
            OutputProduct.OIL,
            OutputProduct.CARBON,
            OutputProduct.STEEL,
            OutputProduct.WASTE_WATER,
            OutputProduct.WASTE,
        ),
    ),
    CompanyCategory.CRUMB: Process(
        inputs=_TYRES,
        outputs=(
            OutputProduct.RUBBER,
            OutputProduct.STEEL,
            OutputProduct.OTHER,
            OutputProduct.WASTE,
        ),
    ),
    CompanyCategory.STEEL: Process(
        inputs=(Material.SCRAP_STEEL,),
        outputs=(OutputProduct.STEEL, OutputProduct.WASTE),
    ),
}

ALL_ITEMS = tuple(ITEMS)
STOCKED_ITEMS = tuple(i for i, spec in ITEMS.items() if spec.stocked)
# What a company may be configured to process, and to make.
INPUT_CHOICES = frozenset(STOCKED_ITEMS)
OUTPUT_CHOICES = frozenset(p.value for p in OutputProduct)


class _Configured(Protocol):
    category: str
    input_items: list[str]
    output_items: list[str]


def defaults_for(category: str) -> Process:
    return PROCESSES[CompanyCategory(category)]


def process_of(company: _Configured) -> Process:
    """The company's own inputs and outputs, or its type's defaults if none are set."""
    default = defaults_for(company.category)
    return Process(
        inputs=tuple(company.input_items) or default.inputs,
        outputs=tuple(company.output_items) or default.outputs,
    )


def unit_of(item: str) -> str:
    return ITEMS[item].unit


def to_kg(item: str, qty: Decimal, oil_density: Decimal) -> Decimal:
    """Weight of `qty` of `item` (in its own unit). Litres are weighed with the density."""
    return qty * oil_density if ITEMS[item].unit == LITRE else qty
