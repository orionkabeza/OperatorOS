from __future__ import annotations

from operatoros_api.schemas.common import ApiModel


class LoginRequest(ApiModel):
    business_slug: str
    identifier: str  # phone or email
    secret: str  # PIN or password
    device_id: str
    remember_device: bool = False


class TokenPair(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    totp_required: bool = False
    challenge_token: str | None = None


class TotpVerifyRequest(ApiModel):
    challenge_token: str
    code: str


class RefreshRequest(ApiModel):
    business_id: str
    refresh_token: str


class LogoutRequest(ApiModel):
    business_id: str
    refresh_token: str
