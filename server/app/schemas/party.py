from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core import gstin as gst
from app.models.enums import PartyKind


class PartyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    kind: PartyKind
    name: str
    gstin: str | None
    city: str
    contact_name: str
    phone: str
    is_active: bool


class PartyInput(BaseModel):
    kind: PartyKind
    name: str = Field(min_length=1, max_length=200)
    gstin: str = Field(max_length=20)
    city: str = Field(default="", max_length=100)
    contact_name: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30, pattern=r"^[0-9+()\- ]*$")
    is_active: bool = True

    @field_validator("gstin")
    @classmethod
    def _gstin(cls, value: str) -> str:
        cleaned = gst.clean(value)
        if cleaned is None:
            raise ValueError("enter the GST number")
        return cleaned

    @field_validator("name", "city", "contact_name", "phone")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()
