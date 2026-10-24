import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.catalog import (
    INPUT_CHOICES,
    ITEMS,
    OIL_DENSITY_MAX,
    OIL_DENSITY_MIN,
    OUTPUT_CHOICES,
)
from app.models.enums import CompanyCategory

# GSTIN: 2-digit state code, 10-char PAN, entity number, 'Z', check character.
_GSTIN = re.compile(r"^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_CODE = re.compile(r"^[A-Z0-9]{1,10}$")


def _clean_code(value: str) -> str:
    value = value.strip().upper()
    if not _CODE.fullmatch(value):
        raise ValueError("code must be 1-10 letters or digits")
    return value


def _clean_gstin(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().upper()
    if not _GSTIN.fullmatch(value):
        raise ValueError("GSTIN is not in the right format")
    return value


class CompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


class CompanyRead(CompanyBrief):
    city: str
    gstin: str | None
    category: CompanyCategory
    # Inventory configuration: what this company processes and makes.
    input_items: list[str]
    output_items: list[str]
    oil_density: float  # kg per litre of oil
    stock_check_months: int
    is_active: bool


class CompanyConfig(BaseModel):
    """The Super Admin's inventory configuration for one company."""

    input_items: list[str] = Field(min_length=1, max_length=len(INPUT_CHOICES))
    output_items: list[str] = Field(min_length=1, max_length=len(OUTPUT_CHOICES))
    oil_density: Decimal = Field(ge=OIL_DENSITY_MIN, le=OIL_DENSITY_MAX, decimal_places=3)
    stock_check_months: Literal[1, 3] = 1

    @model_validator(mode="after")
    def _known_items(self) -> "CompanyConfig":
        for name, items, allowed in (
            ("input", self.input_items, INPUT_CHOICES),
            ("output", self.output_items, OUTPUT_CHOICES),
        ):
            if len(items) != len(set(items)):
                raise ValueError(f"each {name} item can appear only once")
            if unknown := [i for i in items if i not in allowed]:
                raise ValueError(f"unknown {name} items: {', '.join(unknown)}")
        if not any(ITEMS[o].stocked for o in self.output_items):
            raise ValueError("choose at least one output that goes into stock")
        return self


class CompanyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(default="", max_length=100)
    gstin: str | None = Field(default=None, max_length=15)
    category: CompanyCategory

    _code = field_validator("code")(_clean_code)
    _gstin = field_validator("gstin")(_clean_gstin)

    @field_validator("name", "city")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class CompanyUpdate(BaseModel):
    """Only the fields sent are changed."""

    code: str | None = Field(default=None, min_length=1, max_length=10)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=100)
    gstin: str | None = Field(default=None, max_length=15)
    # Can change only while the company has no entries.
    category: CompanyCategory | None = None
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, value: str | None) -> str | None:
        return None if value is None else _clean_code(value)

    _gstin = field_validator("gstin")(_clean_gstin)

    @field_validator("name", "city")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()
