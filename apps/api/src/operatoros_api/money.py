"""Money as integer minor units. Never floats.

Spec E.5: money is stored as BIGINT minor units (x100), never as a float,
anywhere. `Minor` is a `NewType(int)` so mypy can be pointed at it, but the
*enforced* gate is `scripts/check_no_float_money.py`, run in CI, which greps
the whole `apps/api` tree for float usage on anything that looks
money-shaped (variable/field/param named like an amount, or annotated
`float` in a money-ish module) and fails the build. See docs/DECISIONS.md
for why both a type and a grep-gate exist (mypy alone doesn't stop
`amount = 10.5` from being *assigned* to an `int`-typed field at runtime;
only a textual gate + tests can catch every shape of the mistake in a
dynamically-typed request body too).
"""

from __future__ import annotations

from typing import NewType

Minor = NewType("Minor", int)
"""An amount of money in minor units (e.g. RWF x100). Always an int."""


def to_minor(amount: int) -> Minor:
    """Construct a `Minor` from an int. Raises on float input.

    This is the only sanctioned way to construct a `Minor` value from a
    literal or external input (e.g. a parsed JSON number). `bool` is
    rejected too since `bool` is a subclass of `int` in Python and silently
    passing `True`/`False` through would be worse than useless.
    """
    if isinstance(amount, bool) or not isinstance(amount, int):
        raise TypeError(
            f"Minor money values must be constructed from int, got {type(amount).__name__}"
        )
    return Minor(amount)


def add_minor(*amounts: Minor) -> Minor:
    return Minor(sum(int(a) for a in amounts))


def negate_minor(amount: Minor) -> Minor:
    return Minor(-int(amount))
