"""FastAPI app factory.

`create_app(redis_client=...)` takes an injectable Redis client so tests
can pass `fakeredis.aioredis.FakeRedis()` — production wires a real
`redis:7` connection from `settings.redis_url` (infra/docker-compose.yml).

Every unhandled exception is logged with a correlation id and full detail
server-side, and answered to the client with a flat, generic 500 body --
never a stack trace, never an internal message (spec G.1: "Client-facing
errors are actionable but never leak stack traces or internal details.").
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from redis import asyncio as redis_asyncio

from operatoros_api.api.routers import (
    auth,
    cashbox,
    customers,
    day,
    debt,
    events,
    health,
    momo,
    overview,
    pay,
    products,
    products_import,
    receipts,
    sales,
    stock,
    stock_stocktake,
    stock_transfers,
    till,
    users,
)
from operatoros_api.config import get_settings

logger = structlog.get_logger("operatoros_api")


def create_app(redis_client: Any = None) -> FastAPI:
    app = FastAPI(title="OperatorOS API", version="0.1.0")

    settings = get_settings()
    app.state.redis = redis_client or redis_asyncio.from_url(
        settings.redis_url, decode_responses=True
    )

    @app.middleware("http")
    async def correlation_and_logging(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
        start = time.monotonic()
        structlog.contextvars.bind_contextvars(correlation_id=correlation_id)
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("unhandled_exception", path=request.url.path, method=request.method)
            return JSONResponse(
                status_code=500,
                content={"detail": "Something went wrong on our end. Please try again."},
                headers={"X-Correlation-ID": correlation_id},
            )
        finally:
            structlog.contextvars.unbind_contextvars("correlation_id")
        duration_ms = int((time.monotonic() - start) * 1000)
        response.headers["X-Correlation-ID"] = correlation_id
        logger.info(
            "request_handled",
            path=request.url.path,
            method=request.method,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        return response

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(events.router)
    app.include_router(products.router)
    app.include_router(products_import.router)
    app.include_router(customers.router)
    app.include_router(stock.router)
    app.include_router(stock_stocktake.router)
    app.include_router(stock_transfers.router)
    app.include_router(sales.router)
    app.include_router(day.router)
    app.include_router(till.router)
    app.include_router(receipts.router)
    app.include_router(overview.router)
    app.include_router(debt.router)
    app.include_router(momo.router)
    app.include_router(cashbox.router)
    app.include_router(pay.router)

    return app


app = create_app()
