from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
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
    SignupOtpRequest,
    SignupOtpResponse,
    SignupRequest,
    TokenResponse,
    UserRead,
)
from app.services import auth_service, email_service, email_templates, otp_service
from app.services.access_service import build_user_read

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
)
_SIGNUP_CONFLICT = HTTPException(
    status_code=status.HTTP_409_CONFLICT, detail="Could not create an account with these details"
)


def _check_signup_open() -> None:
    if not settings.ALLOW_SIGNUP:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sign-up is closed")


@router.post("/signup/otp", response_model=SignupOtpResponse, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def signup_otp(
    request: Request,
    data: SignupOtpRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SignupOtpResponse:
    """Mail a 6-digit code to the email. The mail goes out after the response, so this is fast."""
    _check_signup_open()
    try:
        code = await auth_service.request_signup_otp(db, data.email)
    except auth_service.EmailAlreadyRegisteredError as exc:
        raise _SIGNUP_CONFLICT from exc
    except otp_service.OtpCooldownError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Please wait {exc.wait_seconds} seconds before asking for a new code",
        ) from exc
    subject, html, text = email_templates.signup_otp(data.full_name, code, otp_service.OTP_MINUTES)
    background.add_task(email_service.deliver, data.email, subject, html, text)
    return SignupOtpResponse(
        expires_in_minutes=otp_service.OTP_MINUTES,
        resend_after_seconds=otp_service.RESEND_SECONDS,
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def signup(
    request: Request,
    data: SignupRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    _check_signup_open()
    try:
        user = await auth_service.signup(db, data, request)
    except auth_service.EmailAlreadyRegisteredError as exc:
        raise _SIGNUP_CONFLICT from exc
    except otp_service.InvalidOtpError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Wrong or expired code. Check the mail or ask for a new code.",
        ) from exc
    subject, html, text = email_templates.welcome(user.full_name, user.account.name)
    background.add_task(email_service.deliver, user.email, subject, html, text)
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
