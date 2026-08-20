"""The cross-tenant isolation suite (spec G.1's build-failing requirement).

Auto-discovers every route from `app.routes`, determines which ones
require authentication by walking each route's FastAPI dependency tree for
`get_current_context` (present directly, or nested under
`require_capability(...)`), and — for every one of those with a path
parameter — substitutes an id that belongs to tenant B, calls it
authenticated as tenant A, and asserts the response is never a 200
carrying tenant B's data.

This does NOT maintain a hand-written list of endpoints to check. A new
route with a path parameter this file doesn't know how to seed an id for
fails `test_every_protected_route_has_a_registered_resource_seed` outright,
with a message telling the author to register it in `RESOURCE_ID_SEEDS`
first. That's the mechanism that makes "a future endpoint added without
isolation fails CI automatically" true rather than aspirational.

See docs/DECISIONS.md for the before/after proof this suite actually
catches a broken policy (RLS policy temporarily dropped -> suite fails;
restored -> suite passes again).
"""

from __future__ import annotations

import re
from collections.abc import Callable

import pytest
from fastapi.routing import APIRoute
from httpx import AsyncClient

from operatoros_api.api.deps import get_current_context
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers

PATH_PARAM_RE = re.compile(r"{(\w+)}")

RESOURCE_ID_SEEDS: dict[str, Callable[[SeededTenant], str]] = {
    "user_id": lambda t: t.owner.id,
    "location_id": lambda t: t.location.id,
    # Phase 1 additions -- see tests/conftest.py::make_tenant, which seeds
    # one of each directly so there's a real tenant-B id to attack with.
    "product_id": lambda t: t.product.id,
    "customer_id": lambda t: t.customer.id,
    "quote_id": lambda t: t.quote.id,
    "receipt_number": lambda t: str(t.receipt_number),
    "till_session_id": lambda t: t.till_session.id,
    "stocktake_id": lambda t: t.stocktake.id,
    "line_id": lambda t: t.stocktake_line.id,
    "transfer_id": lambda t: t.transfer.id,
    # Phase 2 additions -- see tests/conftest.py::make_tenant.
    "money_location_id": lambda t: t.money_location.id,
    "transaction_id": lambda t: t.momo_transaction.id,
}


def _dependant_requires_auth(dependant) -> bool:
    if dependant.call is get_current_context:
        return True
    return any(_dependant_requires_auth(sub) for sub in dependant.dependencies)


def _all_api_routes(routes) -> list[APIRoute]:
    """Flatten FastAPI's route tree into real APIRoute leaves.

    Some FastAPI versions represent an `include_router(...)` as a lazy
    `_IncludedRouter` wrapper in `app.routes` rather than immediately
    flattening its routes, so a plain `isinstance(r, APIRoute)` filter over
    `app.routes` silently finds nothing and this whole suite would pass
    vacuously. Recursing through `.original_router.routes` /
    `.routes` (whichever the wrapper exposes) is what makes discovery
    actually see every endpoint regardless of FastAPI's internal
    representation.
    """
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
        elif hasattr(route, "original_router"):
            found.extend(_all_api_routes(route.original_router.routes))
        elif hasattr(route, "routes"):
            found.extend(_all_api_routes(route.routes))
    return found


def _protected_routes(app) -> list[APIRoute]:
    return [
        route for route in _all_api_routes(app.routes) if _dependant_requires_auth(route.dependant)
    ]


def _path_params(route: APIRoute) -> list[str]:
    return PATH_PARAM_RE.findall(route.path)


@pytest.mark.asyncio
async def test_at_least_one_protected_route_is_discovered(app) -> None:
    # Guards against the whole mechanism silently discovering nothing (e.g.
    # if get_current_context were ever refactored in a way that broke the
    # dependant-tree walk above) and the suite below passing vacuously.
    protected = _protected_routes(app)
    assert len(protected) >= 3, (
        f"Expected several protected routes, found {len(protected)}. "
        "If this legitimately drops to zero, _dependant_requires_auth() is broken, "
        "not the app."
    )


@pytest.mark.asyncio
async def test_every_protected_route_has_a_registered_resource_seed(app) -> None:
    unregistered = sorted(
        {
            param
            for route in _protected_routes(app)
            for param in _path_params(route)
            if param not in RESOURCE_ID_SEEDS
        }
    )
    assert not unregistered, (
        f"Path parameter(s) {unregistered} appear on a protected route but have no "
        "entry in RESOURCE_ID_SEEDS (tests/test_cross_tenant_isolation.py). "
        "Register how to fetch a tenant-B id for this resource before this can "
        "be considered isolation-tested."
    )


@pytest.mark.asyncio
async def test_cross_tenant_isolation_every_protected_route(
    app, client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    headers = await auth_headers(client, tenant_a)
    failures: list[str] = []

    def _leaks_tenant_b(text: str) -> bool:
        # Phase 1 additions: a leaked product/customer/quote/till response
        # wouldn't necessarily echo owner_id/business_id/location_id
        # anywhere in its body (ProductOut/CustomerOut/... don't carry those
        # fields) -- but it WOULD echo the resource's own (UUID) id, which
        # is exactly what got substituted into the attacked path in the
        # first place. If a broken RLS policy let the row through
        # unfiltered, its own id in the response body would match tenant
        # B's real id; a correctly-scoped 404/empty response never gets
        # that far. Deliberately NOT using the numeric `receipt_number` as
        # a substring marker here -- it's a small random int (100000-999999)
        # that could coincidentally appear inside an unrelated money amount
        # elsewhere in a legitimate response and produce a false positive;
        # ReceiptOut's `sale_id` (a real UUID) is the safe equivalent.
        markers = (
            tenant_b.owner.id,
            tenant_b.business.id,
            tenant_b.location.id,
            tenant_b.product.id,
            tenant_b.customer.id,
            tenant_b.quote.id,
            tenant_b.till_session.id,
            tenant_b.sale_id,
            tenant_b.stocktake.id,
            tenant_b.stocktake_line.id,
            tenant_b.transfer.id,
            tenant_b.money_location.id,
            tenant_b.momo_transaction.id,
        )
        return any(marker in text for marker in markers)

    for route in _protected_routes(app):
        methods = route.methods - {"HEAD", "OPTIONS"}
        params = _path_params(route)

        if not params:
            # Collection-level route (list/create): no path id to attack
            # directly. Every mutating request schema in schemas/*.py is
            # extra="forbid" and never accepts a business_id field, so
            # there's no body-level attack surface either -- business_id
            # always comes from the verified token (api/deps.py), never
            # the request. What we CAN check here: a GET list response
            # must never contain tenant B's data.
            if "GET" in methods:
                resp = await client.get(route.path, headers=headers)
                if resp.status_code == 200 and _leaks_tenant_b(resp.text):
                    failures.append(f"GET {route.path} leaked tenant B data in a list response")
            continue

        attacked_path = route.path
        for param_name in params:
            seed = RESOURCE_ID_SEEDS[param_name]
            attacked_path = attacked_path.replace(f"{{{param_name}}}", str(seed(tenant_b)))

        for method in methods:
            body = {} if method in {"POST", "PUT", "PATCH"} else None
            req_headers = {**headers, **idempotency_headers()} if body is not None else headers
            resp = await client.request(method, attacked_path, headers=req_headers, json=body)

            if resp.status_code == 200:
                # A 200 is only acceptable if RLS filtered the response down
                # to nothing tenant-B-identifying (e.g. an empty list) --
                # the approved plan's own wording allows "403/404/empty" as
                # passing outcomes. A 200 that actually carries tenant B's
                # data is the one thing this suite exists to catch.
                if _leaks_tenant_b(resp.text):
                    failures.append(
                        f"{method} {attacked_path} (tenant A token, tenant B's resource id) "
                        f"returned 200 WITH tenant B data: {resp.text[:300]}"
                    )
            elif resp.status_code not in (401, 403, 404, 422):
                failures.append(
                    f"{method} {attacked_path} returned unexpected status "
                    f"{resp.status_code}: {resp.text[:300]}"
                )

    assert not failures, "Cross-tenant isolation FAILED:\n" + "\n".join(failures)
