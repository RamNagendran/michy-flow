import re
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core import gstin as gst
from app.models.catalog import OIL_DENSITY_MAX, OIL_DENSITY_MIN

_CODE = re.compile(r"^[A-Z0-9]{1,10}$")
# A company type's key (company_types.key); checked against the account's types by the service.
Category = Annotated[str, Field(min_length=1, max_length=20)]
ItemKey = Annotated[str, Field(min_length=1, max_length=20)]


def _clean_code(value: str) -> str:
    value = value.strip().upper()
    if not _CODE.fullmatch(value):
        raise ValueError("code must be 1-10 letters or digits")
    return value


class CompanyBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


class CompanyRead(CompanyBrief):
    city: str
    gstin: str | None
    category: str
    # Inventory configuration: what this company processes and makes.
    input_items: list[str]
    output_items: list[str]
    oil_density: float  # kg per litre of oil
    stock_check_months: int
    is_active: bool


class CompanyConfig(BaseModel):
    """The Super Admin's inventory configuration for one company."""

    # Checked against the account's items by the service (catalog_service.check_lists).
    input_items: list[ItemKey] = Field(min_length=1, max_length=100)
    output_items: list[ItemKey] = Field(min_length=1, max_length=100)
    # Left out (e.g. the company makes no oil): the current factor is kept.
    oil_density: Decimal | None = Field(
        default=None, ge=OIL_DENSITY_MIN, le=OIL_DENSITY_MAX, decimal_places=3
    )
    stock_check_months: Literal[1, 3] = 1

    @model_validator(mode="after")
    def _no_repeats(self) -> "CompanyConfig":
        for name, items in (("input", self.input_items), ("output", self.output_items)):
            if len(items) != len(set(items)):
                raise ValueError(f"each {name} item can appear only once")
        return self


class CompanyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(default="", max_length=100)
    gstin: str = Field(max_length=20)
    category: Category

    _code = field_validator("code")(_clean_code)

    @field_validator("gstin")
    @classmethod
    def _gstin(cls, value: str) -> str:
        cleaned = gst.clean(value)
        if cleaned is None:
            raise ValueError("enter the GST number")
        return cleaned

    @field_validator("name", "city")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class CompanyUpdate(BaseModel):
    """Only the fields sent are changed."""

    code: str | None = Field(default=None, min_length=1, max_length=10)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, max_length=100)
    gstin: str | None = Field(default=None, max_length=20)
    # Can change only while the company has no entries.
    category: Category | None = None
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, value: str | None) -> str | None:
        return None if value is None else _clean_code(value)

    @field_validator("gstin")
    @classmethod
    def _gstin(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = gst.clean(value)
        if cleaned is None:
            raise ValueError("enter the GST number")
        return cleaned

    @field_validator("name", "city")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()
