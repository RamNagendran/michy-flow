from fastapi import Request, status
from fastapi.responses import JSONResponse


class AppError(Exception):
    """A failure the client should see as-is. Services raise it; one handler turns it into JSON."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class InvalidError(AppError):
    """Well-formed input that breaks a business rule (e.g. an item this company never makes)."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "invalid"


async def app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code}
    )
