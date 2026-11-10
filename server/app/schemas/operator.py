from pydantic import BaseModel, ConfigDict, Field, field_validator


class OperatorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    shift: int | None


class OperatorInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    shift: int = Field(ge=1, le=3)

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("enter the name")
        return value
