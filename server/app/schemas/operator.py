from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _one_line(value: str) -> str:
    return " ".join(value.split())


class OperatorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str | None
    email: str | None
    shift: int | None
    is_active: bool


class OperatorInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=30, pattern=r"^[0-9+()\- ]*$")
    email: EmailStr | None = None
    shift: int | None = Field(default=None, ge=1, le=3)
    is_active: bool = True

    @field_validator("name", "phone")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = _one_line(value)
        if not value:
            raise ValueError("this is required")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def _blank_email(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class MachineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    is_active: bool


class MachineInput(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    is_active: bool = True

    @field_validator("code", "name")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = _one_line(value)
        if not value:
            raise ValueError("this is required")
        return value
