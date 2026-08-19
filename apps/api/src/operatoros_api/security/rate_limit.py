"""Redis-backed rate limiting and lockout (spec D.1, G.1).

Both classes take an injected async Redis client so tests can pass
`fakeredis.aioredis.FakeRedis()` and production wires a real `redis:7`
connection (see api/deps.py / infra/docker-compose.yml). Real Redis and
fakeredis both implement the same `INCR` / `EXPIRE` / `TTL` / `GET` /
`DELETE` command surface used here, so this code is identical either way.
"""

from __future__ import annotations


class RateLimiter:
    """Fixed-window counter. Good enough for per-IP / per-identifier login
    throttling; not intended for anything needing sub-window precision."""

    def __init__(self, redis_client, prefix: str = "rl") -> None:
        self.redis = redis_client
        self.prefix = prefix

    async def check_and_increment(self, key: str, limit: int, window_seconds: int) -> bool:
        full_key = f"{self.prefix}:{key}:{window_seconds}"
        count = await self.redis.incr(full_key)
        if count == 1:
            await self.redis.expire(full_key, window_seconds)
        return count <= limit


class LockoutTracker:
    """Per (business, identifier, device) failed-login lockout.

    D.1: 3 failed attempts locks the *device* for 15 minutes. The remaining-
    attempts count is only ever surfaced to the caller from attempt 3
    onward (see api/routers/auth.py) — this class just counts and reports.
    """

    def __init__(self, redis_client, max_attempts: int, lockout_seconds: int) -> None:
        self.redis = redis_client
        self.max_attempts = max_attempts
        self.lockout_seconds = lockout_seconds

    def _key(self, business_id: str, identifier_hash: str, device_id: str) -> str:
        return f"lockout:{business_id}:{identifier_hash}:{device_id}"

    async def is_locked(self, business_id: str, identifier_hash: str, device_id: str) -> tuple[bool, int]:
        key = self._key(business_id, identifier_hash, device_id)
        raw = await self.redis.get(key)
        if raw is None:
            return False, 0
        count = int(raw)
        if count >= self.max_attempts:
            ttl = await self.redis.ttl(key)
            return True, max(int(ttl), 0)
        return False, count

    async def record_failure(self, business_id: str, identifier_hash: str, device_id: str) -> int:
        key = self._key(business_id, identifier_hash, device_id)
        count = await self.redis.incr(key)
        if count == 1:
            await self.redis.expire(key, self.lockout_seconds)
        return int(count)

    async def reset(self, business_id: str, identifier_hash: str, device_id: str) -> None:
        await self.redis.delete(self._key(business_id, identifier_hash, device_id))
