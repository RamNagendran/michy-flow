from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.catalog import KG_PER_LITRE_MAX, KG_PER_LITRE_MIN

Name = Annotated[str, Field(min_length=1, max_length=60)]
ItemKey = Annotated[str, Field(min_length=1, max_length=20)]
Color = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
Kind = Literal["material", "product"]
Unit = Literal["kg", "L"]
KgPerLitre = Annotated[Decimal, Field(ge=KG_PER_LITRE_MIN, le=KG_PER_LITRE_MAX, decimal_places=3)]


def _clean(value: object) -> object:
    # Before the length checks, so a name of only spaces is refused.
    return " ".join(value.split()) if isinstance(value, str) else value


class ItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    description: str
    kind: Kind
    unit: Unit
    stocked: bool
    kg_per_litre: float | None
    color: str


class ItemCreate(BaseModel):
    name: Name
    description: str = Field(default="", max_length=200)
    kind: Kind
    unit: Unit = "kg"
    # Only products may be left out of stock (e.g. weighed waste).
    stocked: bool = True
    # Needed when the item is measured in litres; ignored for kg.
    kg_per_litre: KgPerLitre | None = None
    color: Color = "#8A919E"

    _strip = field_validator("name", "description", mode="before")(_clean)

    @model_validator(mode="after")
    def _materials_stocked(self) -> "ItemCreate":
        if self.kind == "material" and not self.stocked:
            raise ValueError("raw material always goes into stock")
        if self.unit == "L" and self.kg_per_litre is None:
            raise ValueError("enter how many kg one litre weighs")
        if self.unit == "kg":
            self.kg_per_litre = None
        return self


class ItemUpdate(BaseModel):
    """Only the fields sent are changed. Kind, unit and stock can change only while no entry,
    company or count uses the item."""

    name: Name | None = None
    description: str | None = Field(default=None, max_length=200)
    kind: Kind | None = None
    unit: Unit | None = None
    stocked: bool | None = None
    # Can change at any time: only new entries use it.
    kg_per_litre: KgPerLitre | None = None
    color: Color | None = None

    _strip = field_validator("name", "description", mode="before")(_clean)


class TypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    example: str
    input_items: list[str]
    output_items: list[str]
    companies: int = 0  # companies of this type


class TypeCreate(BaseModel):
    name: Name
    example: str = Field(default="", max_length=100)
    input_items: list[ItemKey] = Field(min_length=1, max_length=100)
    output_items: list[ItemKey] = Field(min_length=1, max_length=100)

    _strip = field_validator("name", "example", mode="before")(_clean)

    @model_validator(mode="after")
    def _no_repeats(self) -> "TypeCreate":
        for name, items in (("input", self.input_items), ("output", self.output_items)):
            if len(items) != len(set(items)):
                raise ValueError(f"each {name} item can appear only once")
        return self


class TypeUpdate(BaseModel):
    """Only the fields sent are changed. Companies already made keep their own lists."""

    name: Name | None = None
    example: str | None = Field(default=None, max_length=100)
    input_items: list[ItemKey] | None = Field(default=None, min_length=1, max_length=100)
    output_items: list[ItemKey] | None = Field(default=None, min_length=1, max_length=100)

    _strip = field_validator("name", "example", mode="before")(_clean)

    @model_validator(mode="after")
    def _no_repeats(self) -> "TypeUpdate":
        for name, items in (("input", self.input_items), ("output", self.output_items)):
            if items and len(items) != len(set(items)):
                raise ValueError(f"each {name} item can appear only once")
        return self


class CatalogRead(BaseModel):
    """The account's items (in display order) and company types."""

    version: str
    items: list[ItemRead]
    types: list[TypeRead]
