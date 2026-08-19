"""TOTP 2FA (spec G.1: mandatory for Owner/Manager/Bookkeeper).

SMS/WhatsApp OTP is explicitly deferred (approved plan §0.4) — only TOTP
(authenticator app) is implemented in Phase 0.
"""

from __future__ import annotations

import pyotp


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account_name: str, issuer: str = "OperatorOS") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=issuer)


def verify_totp_code(secret: str, code: str) -> bool:
    if not code or not code.isdigit():
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)
