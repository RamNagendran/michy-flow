from fastapi import APIRouter, Depends, Path

from app.auth.dependencies import get_current_user
from app.models import User
from app.schemas.fx import FxRateRead
from app.services import fx_service

router = APIRouter(prefix="/fx-rates", tags=["fx"])


@router.get("/{currency}", response_model=FxRateRead)
async def rate(
    currency: str = Path(pattern=r"^[A-Za-z]{3}$"), user: User = Depends(get_current_user)
) -> FxRateRead:
    """Today's rupees for one unit of `currency`, to fill in an import purchase."""
    code = currency.upper()
    value, as_of = await fx_service.rate_to_inr(code)
    return FxRateRead(currency=code, rate=value, as_of=as_of)
