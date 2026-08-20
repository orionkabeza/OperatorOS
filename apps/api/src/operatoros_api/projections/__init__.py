from operatoros_api.projections import (  # noqa: F401  (imported for side-effecting registration)
    customer_balance,
    daily_totals,
    money_location_balance,
    product_stock,
    reminder_log,
)
from operatoros_api.projections.framework import apply_projections, register_projection

__all__ = ["apply_projections", "register_projection"]
