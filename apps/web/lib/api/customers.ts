import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { getDb, mockDelay, setCustomerCreditLimit, setCustomerHold } from "../mock/store";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { z } from "zod";
import type { CreateCustomerInput, Customer } from "./types";

/**
 * `CustomerOut` (schemas/customers.py) has no `onHold` boolean — `status` is
 * a free-form string column (default `"active"`) that `debt.py`/
 * `reminders_engine.py` genuinely check for the literal value `"on_hold"`
 * (excludes the customer from the chase queue and reminder digest — see
 * docs/DECISIONS.md). So customer hold IS real backend behaviour, just
 * modelled as a status string rather than a dedicated field/endpoint —
 * `updateCustomerHold` below writes it via `PATCH .../customers/{id}` with
 * `{ status: "on_hold" | "active" }`, not a separate `/hold` route (which
 * doesn't exist).
 */
export function mapCustomerOut(c: z.infer<typeof schemas.CustomerOut>): Customer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    creditLimitMinor: minorUnits(c.credit_limit_minor),
    balanceMinor: minorUnits(c.balance_minor),
    termsDays: c.terms_days,
    onHold: c.status === "on_hold",
  };
}

export async function listCustomers(search?: string): Promise<Customer[]> {
  if (USE_MOCK_API) {
    const rows = getDb().customers.filter((c) => c.id !== "cust-walkin");
    const filtered = search
      ? rows.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
      : rows;
    return mockDelay(filtered);
  }
  const raw = await apiRequest<unknown>("GET", "/api/v1/customers", { query: { search } });
  return schemas.CustomerOut.array().parse(raw).map(mapCustomerOut);
}

export async function getCustomer(id: string): Promise<Customer> {
  if (USE_MOCK_API) {
    const customer = getDb().customers.find((c) => c.id === id);
    if (!customer) throw new Error(`Customer ${id} not found`);
    return mockDelay(customer);
  }
  const raw = await apiRequest<unknown>("GET", `/api/v1/customers/${id}`);
  return mapCustomerOut(schemas.CustomerOut.parse(raw));
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  if (USE_MOCK_API) {
    const customer: Customer = {
      id: `cust-${crypto.randomUUID()}`,
      name: input.name,
      phone: input.phone,
      creditLimitMinor: input.creditLimitMinor ?? minorUnits(0),
      balanceMinor: minorUnits(0),
      termsDays: input.termsDays ?? 30,
      onHold: false,
    };
    getDb().customers.push(customer);
    return mockDelay(customer);
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/customers", {
    body: {
      name: input.name,
      phone: input.phone,
      credit_limit_minor: input.creditLimitMinor,
      terms_days: input.termsDays,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapCustomerOut(schemas.CustomerOut.parse(raw));
}

/** D.6 row action — "Put on hold" / "Take off hold". No `/hold` route exists — see mapCustomerOut's comment. */
export async function updateCustomerHold(id: string, onHold: boolean): Promise<Customer> {
  if (USE_MOCK_API) return mockDelay(setCustomerHold(id, onHold));
  const raw = await apiRequest<unknown>("PATCH", `/api/v1/customers/${id}`, {
    body: { status: onHold ? "on_hold" : "active" },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapCustomerOut(schemas.CustomerOut.parse(raw));
}

/** D.6 row action — "Adjust limit". */
export async function updateCustomerCreditLimit(id: string, creditLimitMinor: MinorUnits): Promise<Customer> {
  if (USE_MOCK_API) return mockDelay(setCustomerCreditLimit(id, creditLimitMinor));
  const raw = await apiRequest<unknown>("POST", `/api/v1/customers/${id}/credit-limit`, {
    body: { new_limit_minor: creditLimitMinor },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapCustomerOut(schemas.CustomerOut.parse(raw));
}
