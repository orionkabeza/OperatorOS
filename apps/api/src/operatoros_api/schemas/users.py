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


class MeOut(ApiModel):
    id: str
    business_id: str
    display_name: str
    role_key: str
    location_ids: list[str]


class RoleChangeRequest(ApiModel):
    role_key: str


class GrantRequest(ApiModel):
    permission_key: str
    effect: str  # "grant" | "revoke"
    location_id: str | None = None
