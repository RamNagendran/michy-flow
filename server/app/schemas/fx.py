from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class FxRateRead(BaseModel):
    currency: str
    rate: Decimal  # rupees for one unit of the currency
    as_of: datetime  # when the rate site last updated it
