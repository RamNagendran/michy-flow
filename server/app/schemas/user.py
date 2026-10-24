from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.auth.permissions import CompanyPermission, SystemPermission
from app.models.enums import CompanyRole, Duty, GlobalRole
from app.schemas.company import CompanyBrief, CompanyRead


def _check_password(value: str) -> str:
    # bcrypt only uses the first 72 bytes; reject longer instead of silently truncating.
    if len(value.encode()) > 72:
        raise ValueError("password must be at most 72 bytes")
    return value


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


class CompanyAccess(BaseModel):
    """What the signed-in person may do in one company, already resolved by the server."""

    company: CompanyRead
    # None when access comes from a global role (Super Admin / CEO).
    role: CompanyRole | None
    duties: list[Duty]
    permissions: list[CompanyPermission]


class MembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company: CompanyBrief
    role: CompanyRole
    duties: list[Duty]


class MembershipInput(BaseModel):
    company_id: int
    role: CompanyRole
    duties: list[Duty] = Field(default_factory=list, max_length=len(Duty))

    @model_validator(mode="after")
    def _duties_match_role(self) -> "MembershipInput":
        unique = list(dict.fromkeys(self.duties))
        if self.role == CompanyRole.OPERATOR:
            if not unique:
                raise ValueError("an operator needs at least one duty")
            self.duties = unique
        else:
            # Duties only narrow what an operator may enter; other roles ignore them.
            self.duties = []
        return self


class AccessInput(BaseModel):
    """Either a global role, or one or more company memberships, never both."""

    global_role: GlobalRole | None = None
    memberships: list[MembershipInput] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _one_kind_of_access(self) -> "AccessInput":
        if self.global_role and self.memberships:
            raise ValueError("a global role already covers every company; remove the memberships")
        if not self.global_role and not self.memberships:
            raise ValueError("choose a global role or at least one company")
        ids = [m.company_id for m in self.memberships]
        if len(ids) != len(set(ids)):
            raise ValueError("each company can appear only once")
        return self


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UserBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    global_role: GlobalRole | None
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime


class UserRead(UserBase):
    """The signed-in person, with everything the client needs to decide what to show."""

    account_id: int
    account: AccountRead
    system_permissions: list[SystemPermission]
    companies: list[CompanyAccess]


class UserAdminRead(UserBase):
    """A person as listed in Settings → Users."""

    memberships: list[MembershipRead]


class UserCreate(AccessInput):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)

    @field_validator("full_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None


class UserWithPassword(BaseModel):
    """Returned once when a user is created or their password is reset. Never stored in plain."""

    user: UserAdminRead
    temporary_password: str


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    account_name: str = Field(min_length=1, max_length=200)
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8)

    _password = field_validator("password")(_check_password)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(max_length=4096)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8)

    _password = field_validator("new_password")(_check_password)

    @model_validator(mode="after")
    def _must_differ(self) -> "ChangePasswordRequest":
        if self.current_password == self.new_password:
            raise ValueError("the new password must be different from the current one")
        return self


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token lifetime in seconds")
    user: UserRead
