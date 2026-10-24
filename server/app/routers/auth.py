from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_user_allow_password_change
from app.core.config import settings
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.models import User
from app.schemas.user import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserRead,
)
from app.services import auth_service
from app.services.access_service import build_user_read

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def signup(
    request: Request, data: SignupRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    if not settings.ALLOW_SIGNUP:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign-up is closed")
    try:
        user = await auth_service.signup(db, data, request)
    except auth_service.EmailAlreadyRegisteredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create an account with these details",
        ) from exc
    return await auth_service.issue_tokens(db, user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(
    request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    try:
        user = await auth_service.authenticate(db, data.email, data.password, request)
    except auth_service.InvalidCredentialsError as exc:
        raise _INVALID_CREDENTIALS from exc
    return await auth_service.issue_tokens(db, user)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(
    request: Request, data: RefreshRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    try:
        user = await auth_service.user_from_refresh_token(db, data.refresh_token)
    except auth_service.InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please sign in"
        ) from exc
    return await auth_service.issue_tokens(db, user)


@router.get("/me", response_model=UserRead)
async def me(
    user: User = Depends(get_user_allow_password_change), db: AsyncSession = Depends(get_db)
) -> UserRead:
    return await build_user_read(db, user)


@router.post("/change-password", response_model=TokenResponse)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    data: ChangePasswordRequest,
    user: User = Depends(get_user_allow_password_change),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Changing the password signs out every other session; this one gets fresh tokens."""
    try:
        user = await auth_service.change_password(
            db, user, data.current_password, data.new_password, request
        )
    except auth_service.InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        ) from exc
    return await auth_service.issue_tokens(db, user)
