"""Inbound webhook signature verification: HMAC + timestamp/nonce replay
protection (spec Part G.1: "Signature verification on every inbound
webhook... Replay protection via timestamp + nonce"). Used by the MoMo
webhook receiver (plan §0.3) -- see docs/DECISIONS.md's "MoMo webhook
tenant identification" entry for the full design this module implements.

Every function here is written to be constant-effort regardless of
WHETHER a real secret was available, not just constant-time GIVEN a
secret -- see `verify_signature`'s docstring. This is what stops "unknown
business_id" from being distinguishable, by response latency, from
"known business_id, wrong signature."
"""

from __future__ import annotations

import hashlib
import hmac

MAX_CLOCK_SKEW_SECONDS = 300  # 5 minutes

# A fixed, non-secret local value used ONLY as the HMAC key when the real
# per-tenant secret couldn't be resolved (unknown business_id, no
# connected credentials for this provider). Running a real HMAC
# computation and a real hmac.compare_digest against THIS instead of
# short-circuiting keeps the "not found" path's CPU cost/timing in the
# same ballpark as "found, but signature mismatched" -- see
# docs/DECISIONS.md point 3. Not a credential -- bandit's hardcoded-
# password heuristic matches on the variable name alone; nosec is scoped
# to this exact line, not the rule globally (same convention as
# api/routers/auth.py's empty TokenPair placeholders).
_DUMMY_SECRET = "operatoros-momo-webhook-dummy-secret-never-used-for-real-auth"  # nosec B105


def compute_signature(secret: str, timestamp: str, nonce: str, raw_body: bytes) -> str:
    """HMAC-SHA256 over `timestamp` + `nonce` + the EXACT raw request body
    bytes. Never call this with a re-serialized/re-parsed copy of the
    body -- canonicalization differences (key order, whitespace, number
    formatting, unicode normalization) between the bytes that were
    actually signed and a round-tripped `json.dumps(json.loads(...))`
    copy are a classic way a legitimate signature fails, or a tampered
    payload's signature is accidentally judged valid."""
    mac = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    mac.update(timestamp.encode("utf-8"))
    mac.update(b".")
    mac.update(nonce.encode("utf-8"))
    mac.update(b".")
    mac.update(raw_body)
    return mac.hexdigest()


def verify_signature(
    secret: str | None, timestamp: str, nonce: str, raw_body: bytes, signature: str
) -> bool:
    """Returns True only if `secret` is a real, resolved tenant secret AND
    the signature matches. Always computes a real HMAC and always calls
    `hmac.compare_digest` -- even when `secret` is None -- using
    `_DUMMY_SECRET` in that case, so a caller cannot distinguish "tenant/
    credentials not found" from "found, but signature didn't match" by
    timing alone. The final `secret is not None` check is a cheap,
    non-data-dependent boolean and does not reintroduce a timing gap."""
    effective_secret = secret if secret is not None else _DUMMY_SECRET
    expected = compute_signature(effective_secret, timestamp, nonce, raw_body)
    matches = hmac.compare_digest(expected, signature)
    return matches and secret is not None


def timestamp_within_window(
    timestamp: str, *, now_epoch: float, max_skew_seconds: int = MAX_CLOCK_SKEW_SECONDS
) -> bool:
    """Rejects a timestamp that's missing, malformed, or too far from now
    in either direction -- too far in the past is a replay of an old
    capture; too far in the future would let an attacker mint
    long-lived-looking signed requests ahead of when nonce bookkeeping
    would naturally expire them."""
    try:
        ts = float(timestamp)
    except (TypeError, ValueError):
        return False
    return abs(now_epoch - ts) <= max_skew_seconds
