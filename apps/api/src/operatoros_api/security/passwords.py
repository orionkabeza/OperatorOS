"""Argon2id hashing for passwords and PINs (spec G.1, D.1)."""

from __future__ import annotations

import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
from argon2.low_level import Type

_ph = PasswordHasher(
    time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16, type=Type.ID
)

_TRIVIAL_PINS = {
    "000000",
    "111111",
    "222222",
    "333333",
    "444444",
    "555555",
    "666666",
    "777777",
    "888888",
    "999999",
    "123456",
    "654321",
    "012345",
    "543210",
    "123123",
    "112233",
    "121212",
    "010101",
}


def is_trivial_pin(pin: str) -> bool:
    if pin in _TRIVIAL_PINS:
        return True
    digits = [int(c) for c in pin]
    if len(set(digits)) == 1:
        return True
    if all(digits[i + 1] - digits[i] == 1 for i in range(len(digits) - 1)):
        return True
    return all(digits[i] - digits[i + 1] == 1 for i in range(len(digits) - 1))


def validate_pin(pin: str) -> None:
    if not re.fullmatch(r"\d{6,}", pin):
        raise ValueError("PIN must be at least 6 digits.")
    if is_trivial_pin(pin):
        raise ValueError("That PIN is too easy to guess. Choose a less predictable one.")


def hash_secret(secret: str) -> str:
    return _ph.hash(secret)


def verify_secret(secret: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, secret)
    except (VerifyMismatchError, InvalidHash):
        return False


def needs_rehash(hashed: str) -> bool:
    return _ph.check_needs_rehash(hashed)
