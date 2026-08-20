"""At-rest encryption for small secrets stored on tenant rows (e.g. TOTP
seeds, mobile-money/EBM credentials once those land).

Phase 0 simplification, logged in docs/DECISIONS.md: this uses a single
deployment-wide Fernet key from settings rather than the full envelope
encryption with per-tenant data keys that spec G.1 describes for
production. The interface (`encrypt_secret`/`decrypt_secret`) is the seam
a later phase swaps to per-tenant envelope keys without touching callers.
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from operatoros_api.config import get_settings


class DecryptionError(Exception):
    pass


@lru_cache
def _fernet() -> Fernet:
    settings = get_settings()
    return Fernet(settings.secret_encryption_key.encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise DecryptionError("Could not decrypt stored secret.") from exc
