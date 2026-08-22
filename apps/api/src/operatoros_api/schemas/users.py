from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class UserCreateRequest(ApiModel):
    display_name: str
    phone: str | None = None
    email: str | None = None
    secret: str  # PIN or password, hashed server-side
    role_key: str
    location_ids: list[str] = []


class UserOut(ApiModel):
    id: str
    display_name: str
    phone: str | None
    email: str | None
    role_key: str
    status: str


class LocationSummaryOut(ApiModel):
    """Just enough to name a branch in the UI. `GET /stock/locations` returns
    per-product stock rows (empty for a business with no products), so until
    now nothing could turn a location id into something readable."""

    id: str
    name: str


class MeOut(ApiModel):
    id: str
    business_id: str
    #: The shop's own trading name. Carried here because there is no other
    #: route that returns it, and the top bar names the business on every
    #: screen -- without it the frontend had nothing to show and shipped a
    #: hard-coded one from the mock fixtures to every real tenant.
    business_name: str
    display_name: str
    role_key: str
    location_ids: list[str]
    #: The same locations as `location_ids`, with their names, in the same
    #: order. Kept alongside rather than replacing it -- `location_ids` is
    #: what every caller resolving a default location already reads.
    locations: list[LocationSummaryOut]


class RoleChangeRequest(ApiModel):
    role_key: str


class GrantRequest(ApiModel):
    permission_key: str
    effect: str  # "grant" | "revoke"
    location_id: str | None = None


class ApproverOut(ApiModel):
    """Deliberately narrower than `UserOut` — a cashier looking up who can
    approve an override needs a name to pick, not a colleague's phone
    number, email, or role listing."""

    id: str
    display_name: str
