"""Login-identifier normalisation and hashing.

Phone numbers are hashed for lookup indexes (spec G.1 PII minimisation) —
we never `WHERE phone = :raw` against plaintext. `hash_identifier` uses
HMAC-SHA256 with a server-side pepper (not a plain unsalted hash) so the
hash can't be reversed by rainbow-tabling common phone number ranges.
"""

from __future__ import annotations

import hashlib
import hmac

from operatoros_api.config import get_settings


def normalize_phone(raw: str) -> str:
    digits = "".join(c for c in raw.strip() if c.isdigit() or c == "+")
    if digits.startswith("+"):
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return "+250" + digits[1:]
    if digits.startswith("250"):
        return "+" + digits
    return digits


def normalize_identifier(raw: str) -> str:
    raw = raw.strip()
    if "@" in raw:
        return raw.lower()
    return normalize_phone(raw)


def hash_identifier(identifier: str) -> str:
    pepper = get_settings().jwt_secret.encode("utf-8")
    normalized = normalize_identifier(identifier)
    return hmac.new(pepper, normalized.encode("utf-8"), hashlib.sha256).hexdigest()
