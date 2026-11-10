# ruff: noqa: E501  (the default tables read best one row per line)
"""Items, their units, and what each company puts in and gets out of production.

The Super Admin sets the items and company types for the account (models/catalog_tables.py,
services/catalog_service.py). The signed-in request loads them once into `Catalog`, kept for
the rest of the request, so these lookups stay plain function calls.

Quantities are stored in each item's own unit: litres or kg.
Production balances by weight, so litres are turned into kg with the company's oil density.

Each company type has default inputs and outputs; the Super Admin can then set a company's own
lists (its inventory configuration, stored on the company).
"""

from contextvars import ContextVar
from dataclasses import dataclass
from decimal import Decimal
from functools import cached_property
from typing import Protocol

KG = "kg"
LITRE = "L"
UNITS = (KG, LITRE)
MATERIAL = "material"
PRODUCT = "product"
KINDS = (MATERIAL, PRODUCT)
# The oil KPI (litres per kg of tyres) follows the item with this key.
OIL = "oil"

# kg per litre of oil: the allowed range, and the default for a new company.
OIL_DENSITY_MIN = Decimal("1.030")
OIL_DENSITY_MAX = Decimal("1.050")
OIL_DENSITY_DEFAULT = Decimal("1.040")


@dataclass(frozen=True, slots=True)
class ItemSpec:
    unit: str
    kind: str = PRODUCT
    # Kept in stock and can be sold. Weighed waste is recorded but never stocked.
    stocked: bool = True


@dataclass(frozen=True, slots=True)
class Process:
    inputs: tuple[str, ...]
    # In the order they are shown.
    outputs: tuple[str, ...]

    @property
    def products(self) -> tuple[str, ...]:
        """Outputs that go into stock and can be sold."""
        return tuple(o for o in self.outputs if _spec(o).stocked)


@dataclass(frozen=True)
class Catalog:
    """One account's items (in display order) and company types."""

    items: dict[str, ItemSpec]
    types: dict[str, Process]
    version: str = ""

    @cached_property
    def stocked(self) -> tuple[str, ...]:
        return tuple(i for i, s in self.items.items() if s.stocked)

    @cached_property
    def outputs(self) -> frozenset[str]:
        return frozenset(i for i, s in self.items.items() if s.kind == PRODUCT)


# What a new account starts with. Keys are the ones entries saved before items were editable.
DEFAULT_ITEMS: tuple[tuple[str, str, str, str, str, bool, str], ...] = (
    # key, name, description, kind, unit, stocked, colour
    ("truck", "Truck tyres", "TBR / bus & truck scrap tyres, whole or cut", MATERIAL, KG, True, "#2F6FEB"),
    ("car", "Car tyres", "PCR / passenger car scrap tyres", MATERIAL, KG, True, "#0F9D8A"),
    ("tractor", "Tractor tyres", "Agricultural / tractor scrap tyres", MATERIAL, KG, True, "#5E8C31"),
    ("twowheeler", "Two-wheeler tyres", "Bike & scooter scrap tyres", MATERIAL, KG, True, "#B8860B"),
    ("otr", "OTR tyres", "Off-the-road / earthmover tyres", MATERIAL, KG, True, "#7A5AF8"),
    ("scrap_steel", "Scrap steel", "Tyre steel wire and scrap steel for recovery", MATERIAL, KG, True, "#6B7280"),
    ("oil", "Oil", "Tyre pyrolysis oil, measured in litres", PRODUCT, LITRE, True, "#C2410C"),
    ("carbon", "Carbon powder", "Recovered carbon black / carbon powder", PRODUCT, KG, True, "#7A5AF8"),
    ("rubber", "Rubber crumbs", "Crumb rubber / rubber granules", PRODUCT, KG, True, "#D82E54"),
    ("steel", "Steel", "Recovered steel wire", PRODUCT, KG, True, "#4A7FC1"),
    ("other", "Fibre & other", "Fabric / fluff and other by-products", PRODUCT, KG, True, "#B8860B"),
    ("waste_water", "Waste water", "Water separated in the process", PRODUCT, KG, True, "#1BAF7A"),
    ("waste", "Waste", "Weighed waste for disposal: recorded, never stocked or sold", PRODUCT, KG, False, "#A1A1AA"),
)  # fmt: skip

_TYRES = ("truck", "car", "tractor", "twowheeler", "otr")
DEFAULT_TYPES: tuple[tuple[str, str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    # key, name, example, inputs, outputs
    ("pyrolysis", "Tyre pyrolysis", "e.g. Jack's Green Tech", _TYRES, ("oil", "carbon", "steel", "waste_water", "waste")),
    ("crumb", "Crumb rubber", "e.g. Chennai Crumb Industries", _TYRES, ("rubber", "steel", "other", "waste")),
    ("steel", "Steel recovery", "e.g. Michy Metal and Alloys", ("scrap_steel",), ("steel", "waste")),
)  # fmt: skip

DEFAULT_CATALOG = Catalog(
    items={k: ItemSpec(unit, kind, stocked) for k, _, _, kind, unit, stocked, _ in DEFAULT_ITEMS},
    types={k: Process(i, o) for k, _, _, i, o in DEFAULT_TYPES},
)

# Set once per request by the auth dependency; work outside a request sees the defaults.
_current: ContextVar[Catalog] = ContextVar("catalog", default=DEFAULT_CATALOG)


def use(catalog: Catalog) -> None:
    _current.set(catalog)


def current() -> Catalog:
    return _current.get()


# An item no longer in the catalogue (never the case for items with entries) counts as kg.
_UNKNOWN = ItemSpec(KG)


def _spec(item: str) -> ItemSpec:
    return _current.get().items.get(item, _UNKNOWN)


class _Configured(Protocol):
    category: str
    input_items: list[str]
    output_items: list[str]


def defaults_for(category: str) -> Process:
    return _current.get().types.get(category) or Process((), ())


def process_of(company: _Configured) -> Process:
    """The company's own inputs and outputs, or its type's defaults if none are set."""
    default = defaults_for(company.category)
    return Process(
        inputs=tuple(company.input_items) or default.inputs,
        outputs=tuple(company.output_items) or default.outputs,
    )


def is_item(item: str) -> bool:
    return item in _current.get().items


def is_material(item: str) -> bool:
    return _spec(item).kind == MATERIAL


def stocked_items() -> tuple[str, ...]:
    """Every item that can be stocked, bought or sold (everything but weighed waste)."""
    return _current.get().stocked


def input_choices() -> frozenset[str]:
    """What a company may be configured to process: anything stocked."""
    return frozenset(_current.get().stocked)


def output_choices() -> frozenset[str]:
    """What a company may be configured to make."""
    return _current.get().outputs


def unit_of(item: str) -> str:
    return _spec(item).unit


def is_stocked(item: str) -> bool:
    return _spec(item).stocked


def to_kg(item: str, qty: Decimal, oil_density: Decimal) -> Decimal:
    """Weight of `qty` of `item` (in its own unit). Litres are weighed with the density."""
    return qty * oil_density if _spec(item).unit == LITRE else qty
