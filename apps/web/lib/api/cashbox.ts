import { minorUnits, type MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { z } from "zod";
import type { MoneyLocation, MoneyMovement, MoneyMovementFilters } from "./types";

function mapBalanceCard(c: z.infer<typeof schemas.BalanceCardOut>): MoneyLocation {
  return {
    // BalanceCardOut has no `id` distinct from account_key (see
    // ensureMoneyLocationId's comment below) — accountKey doubles as id
    // for display/lookup purposes on this screen, which is all this type
    // is used for; only update-balance needs the real MoneyLocation row id.
    id: c.account_key,
    accountKey: c.account_key,
    displayName: c.display_name,
    kind: (c.kind as MoneyLocation["kind"] | undefined) ?? "till",
    balanceMinor: minorUnits(c.balance_minor),
    todaysMovementMinor: minorUnits(c.today_movement_minor),
    connectionStatus: c.connection_status === "connected" ? "connected" : "manual",
    lastSyncedAt: c.last_synced_at,
  };
}

/**
 * Real endpoint: `GET /api/v1/cashbox/balances` — not
 * `/api/v1/cashbox/locations` (doesn't exist), and `location_id` is a
 * required query param the old code never sent. Kept zero-arg (rather than
 * accepting a `locationId` parameter) so this can still be passed directly
 * as a React Query `queryFn` (`lib/queries/cashbox.ts`) without every call
 * site needing to know about the location — see `getDefaultLocationId()` in
 * config.ts for the "no location-switcher UI yet" caveat.
 */
export async function listMoneyLocations(): Promise<MoneyLocation[]> {
  if (USE_MOCK_API) return mockDelay(store.listMoneyLocations());
  const raw = await apiRequest<unknown>("GET", "/api/v1/cashbox/balances", { query: { location_id: await getDefaultLocationId() } });
  return schemas.BalanceCardOut.array().parse(raw).map(mapBalanceCard);
}

/**
 * `POST /api/v1/cashbox/money-locations/{money_location_id}/update-balance`
 * needs the real `MoneyLocation.id` primary key — a different identifier
 * space from `account_key`/`accountKey`, confirmed against
 * `models/money_locations.py`. `GET /balances` (above) never returns that
 * id, and there is no `GET /api/v1/cashbox/money-locations` list/lookup
 * endpoint to resolve `account_key -> id` for a row that already exists
 * (apps/api/openapi.json's full cashbox.py surface is exactly `/balances`,
 * `/money-locations` [create-only], `/money-locations/{id}/update-balance`,
 * `/movements` — nothing else). This get-or-create closes that gap using
 * the idempotency machinery as designed, not a new mechanism: a
 * DETERMINISTIC key scoped to `(location_id, account_key)` — instead of
 * the usual per-call random `newIdempotencyKey()` — makes every call for
 * the same account replay the SAME created row's id rather than creating a
 * duplicate. This only holds if nothing else ever creates that
 * (business_id, location_id, account_key) row through a different
 * idempotency key first — `money_locations` has a real DB unique
 * constraint on that triple, so a second, differently-keyed create attempt
 * for an already-existing row would fail. Flagged in docs/DECISIONS.md as
 * a real, load-bearing limitation of the current API surface; a
 * `GET .../money-locations?location_id=...` list endpoint would remove the
 * need for this entirely.
 */
async function ensureMoneyLocationId(accountKey: string, locationId: string): Promise<string> {
  const key = `ensure-money-location:${locationId}:${accountKey}`;
  try {
    const raw = await apiRequest<unknown>("POST", "/api/v1/cashbox/money-locations", {
      body: {
        location_id: locationId,
        account_key: accountKey,
        display_name: accountKey.toUpperCase(),
        kind: accountKey,
      },
      idempotencyKey: key,
    });
    return schemas.MoneyLocationOut.parse(raw).id;
  } catch (err) {
    throw new Error(
      `Couldn't resolve a money-location id for account "${accountKey}" — a row for it may already exist under a different idempotency key, and there's no lookup-by-account_key endpoint to recover from that. See docs/DECISIONS.md's Cash Box entry.`,
      { cause: err },
    );
  }
}

export async function updateMoneyLocationBalance(accountKey: string, countedMinor: MinorUnits, reason?: string): Promise<MoneyLocation> {
  if (USE_MOCK_API) return mockDelay(store.updateMoneyLocationBalance(accountKey, countedMinor, reason));
  const moneyLocationId = await ensureMoneyLocationId(accountKey, await getDefaultLocationId());
  const raw = await apiRequest<unknown>("POST", `/api/v1/cashbox/money-locations/${moneyLocationId}/update-balance`, {
    body: { new_balance_minor: countedMinor, note: reason ?? null },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapBalanceCard(schemas.BalanceCardOut.parse(raw));
}

/**
 * D.7.1's "add account" action — a real endpoint (`POST
 * /api/v1/cashbox/money-locations`) with no current UI caller; wired here
 * so a future "Add account" affordance in Back Office → Cash Box has
 * something real to call, rather than needing lib/api plumbing added later.
 */
export async function createMoneyLocation(input: {
  accountKey: string;
  displayName: string;
  kind: MoneyLocation["kind"];
  locationId?: string;
  maskedAccountNumber?: string | null;
}): Promise<MoneyLocation> {
  const locationId = input.locationId ?? (await getDefaultLocationId());
  const raw = await apiRequest<unknown>("POST", "/api/v1/cashbox/money-locations", {
    body: {
      location_id: locationId,
      account_key: input.accountKey,
      display_name: input.displayName,
      kind: input.kind,
      masked_account_number: input.maskedAccountNumber ?? null,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const created = schemas.MoneyLocationOut.parse(raw);
  return {
    id: created.id,
    accountKey: created.account_key,
    displayName: created.display_name,
    kind: (created.kind as MoneyLocation["kind"] | undefined) ?? input.kind,
    balanceMinor: minorUnits(0),
    todaysMovementMinor: minorUnits(0),
    connectionStatus: created.connection_status === "connected" ? "connected" : "manual",
    lastSyncedAt: created.last_synced_at,
  };
}

const MOVEMENT_TYPE_LABELS: Record<string, MoneyMovement["type"]> = {
  Sale: "sale",
  "Debt payment": "payment_received",
  Expense: "expense",
  Transfer: "transfer",
  // MONEY_TRANSFERRED also carries manual balance corrections (see
  // docs/DECISIONS.md's "manual balance updates reuse MONEY_TRANSFERRED"
  // entry) but the wire label is the same "Transfer" either way — the API
  // doesn't distinguish a correction from a real transfer in this field.
};

function mapMovement(m: z.infer<typeof schemas.MoneyMovementOut>, index: number): MoneyMovement {
  return {
    // MoneyMovementOut carries no id — synthesized from fields that are
    // stable for a given row (not fabricated data, just a React-key-safe
    // composite of real wire fields).
    id: `${m.account_key}-${m.occurred_at}-${index}`,
    accountKey: m.account_key,
    // MoneyMovementOut has no separate display-name field — reuses the
    // same account_key; the balances endpoint is the source of truth for
    // a friendlier label.
    accountDisplayName: m.account_key.toUpperCase(),
    type: MOVEMENT_TYPE_LABELS[m.type] ?? "manual_adjustment",
    amountMinor: minorUnits(m.in_minor - m.out_minor),
    // Not on the wire — money_location_balance only stores the current
    // total, not a per-movement running balance (see cashbox.py's own
    // docstring on `_today_movement`). Genuinely unavailable, not faked.
    balanceAfterMinor: minorUnits(0),
    userId: m.user_id ?? "",
    userName: m.user_id ?? "", // no separate display name on the wire
    reference: m.reference,
    timestamp: m.occurred_at,
  };
}

/** Real endpoint only supports `location_id`/`days` query params — `type`/`accountKey`/`userId`/date-range filtering happens client-side after fetch, same end result the mock's in-memory filtering already gave. */
export async function listMoneyMovements(filters?: MoneyMovementFilters): Promise<MoneyMovement[]> {
  if (USE_MOCK_API) return mockDelay(store.listMoneyMovements(filters));
  const raw = await apiRequest<unknown>("GET", "/api/v1/cashbox/movements", {
    query: { location_id: await getDefaultLocationId(), days: "90" },
  });
  let rows = schemas.MoneyMovementOut.array().parse(raw).map(mapMovement);
  if (filters?.accountKey) rows = rows.filter((r) => r.accountKey === filters.accountKey);
  if (filters?.type) rows = rows.filter((r) => r.type === filters.type);
  if (filters?.userId) rows = rows.filter((r) => r.userId === filters.userId);
  if (filters?.from) rows = rows.filter((r) => r.timestamp >= filters.from!);
  if (filters?.to) rows = rows.filter((r) => r.timestamp <= filters.to!);
  return rows;
}
