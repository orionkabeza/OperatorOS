/**
 * Cheap-but-real proof that the generated Zod client actually matches the
 * backend contract — not just that the frontend typechecks against it.
 *
 * There's no live Postgres/apps/api available in this environment to fire
 * a true end-to-end HTTP request against, so this exercises the REAL-API
 * code path of a representative slice of lib/api/*.ts functions (one
 * simple GET, one GET with a path param, and the pay-link flow — the most
 * security-sensitive surface, since it's the one deliberately-unauthenticated
 * router) against SYNTHETIC payloads built from the exact field names/types
 * apps/api/openapi.json's own schemas declare (cross-checked against
 * apps/api/src/operatoros_api/schemas/*.py while writing lib/api's mappers,
 * not invented for this test). `apiRequest` is mocked at the transport
 * boundary only — every function under test still runs its real
 * `USE_MOCK_API === false` branch: building the request body, calling
 * `schemas.X.parse()` on the mocked response, and mapping into the
 * frontend's domain types. A malformed payload (missing a required field)
 * is also asserted to fail `.parse()`, proving the Zod schemas do real
 * runtime validation work rather than being a permissive pass-through.
 */
import { describe, expect, it, vi } from "vitest";
import { schemas } from "./generated/client";

const apiRequestMock = vi.fn();

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK_API: false,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
});

function responseFor(map: Record<string, unknown>) {
  apiRequestMock.mockImplementation(async (method: string, path: string) => {
    const key = `${method} ${path}`;
    if (key in map) return map[key];
    throw new Error(`Unexpected apiRequest call in test: ${key}`);
  });
}

describe("generated Zod schemas validate realistic backend-shaped payloads", () => {
  it("DebtHeaderOut (GET /api/v1/debt/header) — simple GET, no path param", () => {
    const synthetic = {
      owed_to_you_minor: 450_000_00,
      overdue_minor: 120_000_00,
      due_this_week_minor: 30_000_00,
      collected_this_month_minor: 80_000_00,
      ageing: [
        { bucket: "current", amount_minor: 200_000_00 },
        { bucket: "1-30", amount_minor: 100_000_00 },
      ],
    };
    expect(() => schemas.DebtHeaderOut.parse(synthetic)).not.toThrow();
  });

  it("rejects a DebtHeaderOut payload missing a required field — proves real validation, not a pass-through", () => {
    const broken = { overdue_minor: 1, due_this_week_minor: 1, collected_this_month_minor: 1, ageing: [] };
    expect(() => schemas.DebtHeaderOut.parse(broken)).toThrow();
  });

  it("CustomerOut (GET /api/v1/customers/{id}) — GET with a path param", async () => {
    const synthetic = {
      id: "cust-123",
      name: "Habimana Construction",
      phone: "+250780000000",
      terms_days: 30,
      language: "en",
      status: "on_hold",
      credit_limit_minor: 500_000_00,
      balance_minor: 120_000_00,
      limit_used_percent: 24,
      oldest_unpaid_at: "2026-07-01T00:00:00Z",
    };
    responseFor({ "GET /api/v1/customers/cust-123": synthetic });
    const { getCustomer } = await import("./customers");
    const customer = await getCustomer("cust-123");
    expect(customer).toEqual({
      id: "cust-123",
      name: "Habimana Construction",
      phone: "+250780000000",
      creditLimitMinor: 500_000_00,
      balanceMinor: 120_000_00,
      termsDays: 30,
      // status: "on_hold" -> onHold: true is the whole point of the
      // customers.ts mapping this test is proving out (see mapCustomerOut's
      // comment: no dedicated backend field/endpoint, just this status
      // string check).
      onHold: true,
    });
  });
});

describe("pay-link flow — the deliberately-unauthenticated, most security-sensitive surface", () => {
  it("getPayLink hits the bare /pay/{token} path (never /api/v1/pay/...)", async () => {
    const synthetic = {
      business_name: "Kigali Hardware Co",
      customer_name: "Jean Bosco",
      amount_minor: 25_000_00,
      status: "pending",
      expires_at: "2026-08-28T00:00:00Z",
    };
    responseFor({ "GET /pay/tok_abc123": synthetic });
    const { getPayLink } = await import("./pay");
    const details = await getPayLink("tok_abc123");
    expect(details).toEqual({
      status: "pending",
      businessName: "Kigali Hardware Co",
      customerName: "Jean Bosco",
      amountMinor: 25_000_00,
      invoiceRef: null,
      expiresAt: "2026-08-28T00:00:00Z",
    });
    // The security-critical assertion: confirms the call never touched
    // `/api/v1/pay/...` — the wrong, authenticated-namespace prefix every
    // one of these functions used before this pass.
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/pay/tok_abc123");
  });

  it("submitPayLink posts only { phone } to /pay/{token}/request-payment — no method/provider field on the real wire", async () => {
    const synthetic = { external_id: "ext-999", status: "pending" };
    responseFor({ "POST /pay/tok_abc123/request-payment": synthetic });
    const { submitPayLink } = await import("./pay");
    const result = await submitPayLink("tok_abc123", "momo", "+250780000001");
    expect(result).toEqual({ status: "pending_confirmation" });
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/pay/tok_abc123/request-payment", {
      body: { phone: "+250780000001" },
    });
  });

  it("getPayLinkStatus hits the bare /pay/{token}/status path", async () => {
    const synthetic = { status: "paid", paid_at: "2026-08-21T10:00:00Z" };
    responseFor({ "GET /pay/tok_abc123/status": synthetic });
    const { getPayLinkStatus } = await import("./pay");
    const status = await getPayLinkStatus("tok_abc123");
    expect(status).toBe("paid");
  });

  it("rejects a PayLinkPageOut payload with a wrong field type — proves real validation on the public surface too", () => {
    const broken = {
      business_name: "Kigali Hardware Co",
      customer_name: "Jean Bosco",
      amount_minor: "not-a-number", // should be an integer
      status: "pending",
      expires_at: "2026-08-28T00:00:00Z",
    };
    expect(() => schemas.PayLinkPageOut.parse(broken)).toThrow();
  });
});
