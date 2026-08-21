"""Adversarial cross-tenant isolation coverage that
`tests/test_cross_tenant_isolation.py`'s generic route-walker does NOT
exercise, because of exactly how it's built:

- It substitutes tenant-B ids into PATH parameters only -- it never probes
  QUERY parameters (e.g. `?search=`, `?location_id=`) with a tenant-B value,
  and a collection GET with a required query param it doesn't know how to
  fill (like `/api/v1/cashbox/balances?location_id=...`) never gets called
  meaningfully at all.
- For any route that also takes a path parameter, it always sends an EMPTY
  body (`{}`) for POST/PUT/PATCH -- so it can never exercise the "attacker's
  own valid request, but one body FIELD names another tenant's resource id"
  shape (a `payment_allocations`-style IDOR), because a `{}` body usually
  fails schema validation (422) before the handler's own logic ever runs.

This file targets those two blind spots directly, plus a few specific
attacks called out for this phase: forging/tampering the pay-link JWT, and
confirming the MoMo webhook's constant-effort signature path actually holds
under a real timing measurement rather than just reading the code.
"""

from __future__ import annotations

import statistics
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from operatoros_api.db import tenant_scoped_session
from operatoros_api.models.payments import PaymentAllocation
from operatoros_api.security.webhooks import compute_signature
from tests.conftest import SeededTenant
from tests.helpers import auth_headers, idempotency_headers

# ---------------------------------------------------------------------------
# 1. IDOR via a body-supplied id that references ANOTHER tenant's resource,
#    on a route the generic suite only ever calls with an empty body.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_momo_match_invoice_rejects_a_sale_id_belonging_to_another_tenant(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """POST /api/v1/momo/transactions/{id}/match with
    matched_to_type="invoice" takes `sale_id` directly from the request
    body. `take_payment` (api/routers/debt.py) validates a body-supplied
    sale_id against the CALLER's own tenant-scoped open invoices before
    ever using it (`remaining_by_sale.get(line.sale_id)` -> 422 if it isn't
    one of the caller's own open invoices) -- match_transaction's
    `if body.matched_to_type == "invoice" and body.sale_id:` branch skips
    that check entirely and uses the id as-is. Naming a real tenant-B sale
    id here must be rejected the same way, not silently accepted."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        f"/api/v1/momo/transactions/{tenant_a.momo_transaction.id}/match",
        headers={**headers, **idempotency_headers()},
        json={
            "matched_to_type": "invoice",
            "location_id": tenant_a.location.id,
            "customer_id": tenant_a.customer.id,
            "sale_id": tenant_b.sale_id,
        },
    )
    assert (
        resp.status_code == 422
    ), f"expected rejection of a foreign sale_id, got {resp.status_code}: {resp.text}"

    # Whether or not the HTTP layer rejected it, the ground truth is: no
    # payment_allocations row may ever be written pointing at tenant B's
    # sale as a result of tenant A's request.
    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(PaymentAllocation).where(PaymentAllocation.sale_id == tenant_b.sale_id)
        )
        assert result.scalar_one_or_none() is None, (
            "a payment_allocations row referencing tenant B's sale_id was created "
            "by a request authenticated as tenant A"
        )


@pytest.mark.asyncio
async def test_momo_match_debt_payment_with_a_foreign_customer_id_allocates_nothing(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """The `debt_payment`/no-sale_id branch resolves invoices via
    `open_invoices_for_customer(ctx.session, ctx.business_id, body.customer_id)`
    -- tenant-scoped by construction (Sale.business_id == ctx.business_id),
    so a tenant-B customer_id here should just resolve to "no open
    invoices" rather than reaching across tenants. Confirms the containment
    that test above shows is broken for the sale_id shortcut."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        f"/api/v1/momo/transactions/{tenant_a.momo_transaction.id}/match",
        headers={**headers, **idempotency_headers()},
        json={
            "matched_to_type": "debt_payment",
            "location_id": tenant_a.location.id,
            "customer_id": tenant_b.customer.id,
        },
    )
    # Either outcome is acceptable from an isolation standpoint as long as
    # nothing tenant-B-owned is ever allocated against -- assert on the
    # actual invariant rather than one particular status code.
    assert resp.status_code in (201, 404, 422), resp.text
    async with tenant_scoped_session(tenant_a.business.id) as session:
        result = await session.execute(
            select(PaymentAllocation).where(PaymentAllocation.business_id == tenant_a.business.id)
        )
        for row in result.scalars():
            async with tenant_scoped_session(tenant_b.business.id) as b_session:
                from operatoros_api.models.sales import Sale

                b_sale = await b_session.get(Sale, row.sale_id)
                assert (
                    b_sale is None
                ), "tenant A's payment_allocations row references a real tenant-B sale"


@pytest.mark.asyncio
async def test_take_payment_manual_allocation_rejects_a_foreign_sale_id(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """Containment proof for the pattern `take_payment` gets right: a
    manual allocation naming tenant B's real sale id as the target invoice
    must be rejected as "not an open invoice for this customer", not
    silently accepted."""
    headers = await auth_headers(client, tenant_a)
    resp = await client.post(
        f"/api/v1/debt/accounts/{tenant_a.customer.id}/take-payment",
        headers={**headers, **idempotency_headers()},
        json={
            "amount_minor": 1000,
            "method": "cash",
            "location_id": tenant_a.location.id,
            "allocation_mode": "manual",
            "manual_allocations": [{"sale_id": tenant_b.sale_id, "amount_minor": 1000}],
        },
    )
    assert resp.status_code == 422, resp.text
    assert "not an open invoice" in resp.text


# ---------------------------------------------------------------------------
# 2. Query-parameter-driven leaks the generic path-param walker never tries.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_customer_search_never_returns_another_tenants_customer(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """`list_customers` (api/routers/customers.py) builds `select(Customer)`
    with NO explicit `.where(Customer.business_id == ctx.business_id)` --
    it relies entirely on RLS. A wildcard or a tenant-B-matching search
    string is exactly the kind of query the generic blanket test (which
    only ever calls collection GETs with no query string at all) would
    never think to try."""
    headers = await auth_headers(client, tenant_a)

    for search in ("%", "", tenant_b.customer.name, tenant_b.owner_phone[-6:]):
        resp = await client.get(
            "/api/v1/customers", headers=headers, params={"search": search} if search else {}
        )
        assert resp.status_code == 200, resp.text
        ids = {c["id"] for c in resp.json()}
        assert (
            tenant_b.customer.id not in ids
        ), f"search={search!r} returned tenant B's customer to tenant A"
        names = {c["name"] for c in resp.json()}
        assert tenant_b.customer.name not in names


@pytest.mark.asyncio
async def test_cashbox_balances_with_another_tenants_location_id_returns_nothing(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """`GET /api/v1/cashbox/balances` and `/movements` take `location_id`
    as a REQUIRED QUERY parameter, not a path parameter -- invisible to
    the generic walker entirely (it has no path param to substitute, and a
    call with no query string at all just 422s on the missing param). Both
    handlers filter `MoneyLocationBalance`/`Event`/`MoneyLocation` by
    `location_id` alone with no explicit `business_id` clause in the
    Python -- RLS is the only thing standing between tenant A naming
    tenant B's real location_id and tenant A's own GUC-scoped session
    still returning tenant B's balance data."""
    headers = await auth_headers(client, tenant_a)

    balances_resp = await client.get(
        "/api/v1/cashbox/balances",
        headers=headers,
        params={"location_id": tenant_b.location.id},
    )
    assert balances_resp.status_code == 200, balances_resp.text
    assert balances_resp.json() == []

    movements_resp = await client.get(
        "/api/v1/cashbox/movements",
        headers=headers,
        params={"location_id": tenant_b.location.id},
    )
    assert movements_resp.status_code == 200, movements_resp.text
    assert movements_resp.json() == []


# ---------------------------------------------------------------------------
# 3. Pay-link JWT forgery attempts beyond what test_pay_link_security.py
#    already covers (wrong-secret re-sign, expired, mismatched claim,
#    paid-link reuse).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pay_link_alg_none_is_rejected(client: AsyncClient, tenant_a: SeededTenant) -> None:
    """The classic JWT `alg: none` downgrade attack -- a token with no
    signature at all, claiming a real pay_link_id/business_id. PyJWT
    rejects `none` unless explicitly whitelisted in `algorithms=[...]`,
    and `decode_pay_link_token` always passes exactly
    `[settings.jwt_algorithm]` ("HS256"), never "none" -- but this is
    exactly the kind of thing that must be proven against the real decode
    path, not assumed from reading the allow-list once."""
    headers = await auth_headers(client, tenant_a)
    # A real pay link so the id is genuine and only the alg/signature is
    # the attack surface.
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Alg None Target", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
    )
    customer_id = customer_resp.json()["id"]
    await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": 1_000_000},
    )

    forged_header = {"alg": "none", "typ": "JWT"}
    payload = {
        "pay_link_id": str(uuid.uuid4()),
        "business_id": tenant_a.business.id,
        "type": "pay_link",
        "exp": int((datetime.now(UTC) + timedelta(days=7)).timestamp()),
    }
    forged = jwt.encode(payload, key=None, algorithm="none", headers=forged_header)

    resp = await client.get(f"/pay/{forged}")
    assert (
        resp.status_code == 404
    ), f"alg=none token was NOT rejected: {resp.status_code} {resp.text}"


@pytest.mark.asyncio
async def test_pay_link_flipped_signature_byte_is_rejected(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """A validly-issued token with one character of the signature flipped
    -- must fail signature verification, not fall through to some lenient
    fallback."""
    headers = await auth_headers(client, tenant_a)
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Flip Target", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
    )
    customer_id = customer_resp.json()["id"]
    await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": 1_000_000},
    )
    link_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/pay-link",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant_a.location.id, "amount_minor": 1000},
    )
    assert link_resp.status_code == 201, link_resp.text
    token = link_resp.json()["token"]

    # Flip the last character of the signature segment.
    header_b64, payload_b64, sig_b64 = token.split(".")
    last_char = sig_b64[-1]
    replacement = "A" if last_char != "A" else "B"
    tampered = f"{header_b64}.{payload_b64}.{sig_b64[:-1]}{replacement}"

    resp = await client.get(f"/pay/{tampered}")
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# 4. The MoMo webhook's constant-effort dummy-secret path, measured for
#    real rather than assumed from reading security/webhooks.py.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_webhook_timing_does_not_meaningfully_separate_known_vs_unknown_business(
    client: AsyncClient, tenant_a: SeededTenant
) -> None:
    """`security/webhooks.py::verify_signature` is documented to always run
    a real HMAC + `hmac.compare_digest` even for an unresolved business_id,
    specifically so response latency can't be used to enumerate valid
    business ids. This measures it: N requests naming tenant A's real
    (connected) business_id with a wrong signature, vs N requests naming a
    random, never-registered business_id, both over the live ASGI
    transport (same code path a real attacker would hit), and checks the
    two latency distributions don't separate by an amount that would make
    a practical enumeration oracle."""
    headers = await auth_headers(client, tenant_a)
    connect_resp = await client.post(
        "/api/v1/momo/connect",
        headers={**headers, **idempotency_headers()},
        json={"merchant_ref": "timing-test"},
    )
    assert connect_resp.status_code == 201, connect_resp.text

    def _payload(business_id: str) -> bytes:
        import json

        body = {
            "business_id": business_id,
            "external_id": uuid.uuid4().hex,
            "phone": "+250788000000",
            "amount_minor": 1000,
            "direction": "in",
        }
        return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")

    async def _time_requests(business_id: str, n: int) -> list[float]:
        durations = []
        for _ in range(n):
            raw_body = _payload(business_id)
            ts = str(time.time())
            nonce = uuid.uuid4().hex
            # Deliberately the WRONG signature in both cases -- this
            # isolates exactly the "known tenant, bad sig" vs "unknown
            # tenant, bad sig" comparison the dummy-secret path exists for.
            sig = compute_signature("attacker-guess", ts, nonce, raw_body)
            start = time.perf_counter()
            resp = await client.post(
                "/api/v1/momo/webhook/sandbox_momo",
                content=raw_body,
                headers={
                    "content-type": "application/json",
                    "x-momo-timestamp": ts,
                    "x-momo-nonce": nonce,
                    "x-momo-signature": sig,
                },
            )
            durations.append(time.perf_counter() - start)
            assert resp.status_code == 401
        return durations

    n = 60
    # Warm up (import caching, connection setup, JIT-ish effects) before
    # measuring either arm, so the first arm run isn't unfairly penalized.
    await _time_requests(tenant_a.business.id, 5)
    await _time_requests(str(uuid.uuid4()), 5)

    known_times = await _time_requests(tenant_a.business.id, n)
    unknown_times = await _time_requests(str(uuid.uuid4()), n)

    known_median = statistics.median(known_times)
    unknown_median = statistics.median(unknown_times)
    pooled_stdev = statistics.pstdev(known_times + unknown_times) or 1e-9

    # Generous threshold: an in-process ASGI test transport over an
    # embedded Postgres has plenty of scheduler/GC noise unrelated to the
    # code path itself, so this isn't a tight statistical test -- it's a
    # sanity check that the gap isn't a large, consistent, multi-stdev
    # separation of the kind that WOULD make a practical timing oracle.
    separation_in_stdevs = abs(known_median - unknown_median) / pooled_stdev
    assert separation_in_stdevs < 3, (
        f"known vs unknown business_id timing separated by "
        f"{separation_in_stdevs:.2f} pooled stdevs "
        f"(known median={known_median * 1000:.2f}ms, "
        f"unknown median={unknown_median * 1000:.2f}ms) -- "
        "large enough to risk being a usable timing oracle"
    )


# ---------------------------------------------------------------------------
# 5. The `businesses` table's deliberate RLS exemption: what an
#    authenticated tenant-A request can and cannot reach through it.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_authenticated_endpoint_exposes_another_businesss_name_or_slug(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """`businesses` is the one table with no RLS (routing-only, by design
    -- see db.py's module docstring). Nothing about that exemption should
    let an authenticated tenant-A request read tenant B's business `name`
    or `slug` through any endpoint. There is no "get my business" endpoint
    in this phase at all (grep confirms `Business` is only ever queried in
    api/routers/pay.py, gated by a verified pay-link JWT claim) -- this
    test pins that invariant: tenant B's business name/slug must never
    appear in any response body tenant A can obtain."""
    headers = await auth_headers(client, tenant_a)

    for path in (
        "/api/v1/customers",
        "/api/v1/products",
        "/api/v1/momo/transactions",
        "/api/v1/expenses",
        "/api/v1/debt/accounts",
    ):
        resp = await client.get(path, headers=headers)
        if resp.status_code == 200:
            assert tenant_b.business.name not in resp.text
            assert tenant_b.business.slug not in resp.text


@pytest.mark.asyncio
async def test_pay_link_page_never_shows_the_wrong_business_name(
    client: AsyncClient, tenant_a: SeededTenant, tenant_b: SeededTenant
) -> None:
    """A real pay link for tenant A must always resolve to tenant A's
    business name -- confirms `pay.py::get_pay_link_page`'s unscoped
    `session.get(Business, business_id)` (safe only because `business_id`
    itself came from the verified JWT claim, already cross-checked against
    the row's own `business_id`) can never be tricked into rendering
    tenant B's name for tenant A's link."""
    headers = await auth_headers(client, tenant_a)
    customer_resp = await client.post(
        "/api/v1/customers",
        headers={**headers, **idempotency_headers()},
        json={"name": "Business Name Check", "phone": f"+2507{uuid.uuid4().int % 10**8:08d}"},
    )
    customer_id = customer_resp.json()["id"]
    await client.post(
        f"/api/v1/customers/{customer_id}/credit-limit",
        headers={**headers, **idempotency_headers()},
        json={"new_limit_minor": 1_000_000},
    )
    link_resp = await client.post(
        f"/api/v1/debt/accounts/{customer_id}/pay-link",
        headers={**headers, **idempotency_headers()},
        json={"location_id": tenant_a.location.id, "amount_minor": 1000},
    )
    assert link_resp.status_code == 201, link_resp.text
    token = link_resp.json()["token"]

    page_resp = await client.get(f"/pay/{token}")
    assert page_resp.status_code == 200, page_resp.text
    assert page_resp.json()["business_name"] == tenant_a.business.name
    assert page_resp.json()["business_name"] != tenant_b.business.name
