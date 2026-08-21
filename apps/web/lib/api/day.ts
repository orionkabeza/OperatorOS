import type { MinorUnits } from "@operatoros/shared";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { schemas } from "./generated/client";
import { listMomoTransactions } from "./momo";
import type { z } from "zod";
import type { DayCloseChecklist, DaySession, DaySummary, OpenDayInput, VarianceReason } from "./types";

function mapDaySessionOut(d: z.infer<typeof schemas.DaySessionOut>): DaySession {
  const isOpen = d.status === "open";
  return {
    id: d.id,
    businessDate: d.business_date,
    locationId: d.location_id,
    status: d.status as DaySession["status"],
    openedAt: d.opened_at,
    openedBy: null, // DaySessionOut carries no actor field
    closedAt: d.closed_at,
    closedBy: null,
    countedMinor: (isOpen ? d.opening_counted_amount_minor : d.closing_counted_amount_minor) as MinorUnits | null,
    expectedMinor: (isOpen ? d.opening_expected_amount_minor : d.closing_expected_amount_minor) as MinorUnits | null,
    varianceMinor: (isOpen ? d.opening_variance_minor : d.closing_variance_minor) as MinorUnits | null,
    // DaySessionOut doesn't echo `variance_reason` back at all — the
    // request body accepts it, the response never carries it.
    reason: null,
    reasonNote: null,
  };
}

export async function getDayStatus(): Promise<DaySession> {
  if (USE_MOCK_API) return mockDelay(store.getDaySession());
  const raw = await apiRequest<unknown>("GET", "/api/v1/day/status", { query: { location_id: await getDefaultLocationId() } });
  const parsed = schemas.DaySessionOut.nullable().parse(raw);
  if (parsed) return mapDaySessionOut(parsed);
  // No open (or ever-opened) day at this location — DaySession requires a
  // non-null return; represent "never opened" with an empty closed shell
  // rather than throwing, matching what a fresh business's first visit
  // looks like.
  return {
    id: "",
    businessDate: new Date().toISOString().slice(0, 10),
    locationId: await getDefaultLocationId(),
    status: "closed",
    openedAt: null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    countedMinor: null,
    expectedMinor: null,
    varianceMinor: null,
    reason: null,
    reasonNote: null,
  };
}

/** Real `DayOpenRequest` has one `variance_reason: string | null` field — the frontend's separate enum `reason` + free-text `reasonNote` are combined (note preferred, falling back to the enum code) rather than dropping one. */
function combineVarianceReason(reason?: VarianceReason, reasonNote?: string): string | null {
  if (reasonNote && reasonNote.trim()) return reasonNote;
  return reason ?? null;
}

export async function openDay(input: OpenDayInput): Promise<DaySession> {
  if (USE_MOCK_API) {
    return mockDelay(store.openDay({ countedMinor: input.countedMinor, reason: input.reason, reasonNote: input.reasonNote }));
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/day/open", {
    body: {
      location_id: await getDefaultLocationId(),
      counted_amount_minor: input.countedMinor,
      variance_reason: combineVarianceReason(input.reason, input.reasonNote),
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapDaySessionOut(schemas.DaySessionOut.parse(raw));
}

/**
 * No `/api/v1/day/close-checklist` endpoint exists. `unreconciledMomo` is
 * derived here from a real, already-existing endpoint (`GET
 * /momo/transactions`) rather than faked or dropped. The other three stay
 * at 0 with this disclosure:
 * - `parkedSales`: parking a sale has no backend counterpart at all (see
 *   sales.ts).
 * - `unsentQuotes`: "sent" isn't a tracked quote state server-side (only
 *   open/expired/converted).
 * - `unpostedStocktakes`: there is no `GET /api/v1/stock/stocktakes` LIST
 *   endpoint at all (only create, and get-by-id) — every stocktake would
 *   need its id known in advance to check its status, which defeats the
 *   point of a count. See stock.ts's `listStocktakes` comment.
 */
export async function getDayCloseChecklist(): Promise<DayCloseChecklist> {
  if (USE_MOCK_API) return mockDelay(store.dayCloseChecklist());
  const momoTransactions = await listMomoTransactions();
  return {
    parkedSales: 0,
    unsentQuotes: 0,
    unreconciledMomo: momoTransactions.filter((t) => t.status === "unmatched").length,
    unpostedStocktakes: 0,
  };
}

/** No `/api/v1/day/summary` endpoint exists — derived from `GET /api/v1/overview`'s `today` block, which carries the same underlying figures. */
export async function getDaySummary(): Promise<DaySummary> {
  if (USE_MOCK_API) return mockDelay(store.daySummary());
  const raw = await apiRequest<unknown>("GET", "/api/v1/overview", { query: { location_id: await getDefaultLocationId() } });
  const overview = schemas.OverviewOut.parse(raw);
  const today = overview.today;
  const takenMinor = today.revenue_minor - today.credit_minor;
  return {
    takenMinor: takenMinor as MinorUnits,
    byMethod: Object.entries(today.by_payment_method).map(([method, amountMinor]) => ({
      method: method as DaySummary["byMethod"][number]["method"],
      amountMinor: amountMinor as MinorUnits,
    })),
    onCreditMinor: today.credit_minor as MinorUnits,
    // TodayOut carries no expenses figure — genuinely unavailable from
    // this endpoint (Cash Box's own expenses list would need a separate,
    // date-filtered fetch this summary doesn't warrant).
    expensesMinor: 0 as MinorUnits,
    netMinor: takenMinor as MinorUnits,
    transactionCount: today.transaction_count,
    // Not derivable from any current endpoint without per-sale timestamps.
    busiestHour: null,
    topProductName: null,
    // No shrinkage/variance figure on this endpoint.
    shrinkageMinor: null,
  };
}

/** No `/api/v1/day/expected-till` endpoint — derived from `GET /api/v1/overview`'s `money_position.balances_by_account["till"]`, the same figure `api/routers/day.py::close_day` itself reads server-side to compute the expected amount. */
export async function getExpectedTillMinor() {
  if (USE_MOCK_API) return mockDelay(store.expectedTillMinor());
  const raw = await apiRequest<unknown>("GET", "/api/v1/overview", { query: { location_id: await getDefaultLocationId() } });
  const overview = schemas.OverviewOut.parse(raw);
  return overview.money_position.balances_by_account["till"] ?? 0;
}

export async function closeDay(input: {
  countedMinor: MinorUnits;
  reason?: VarianceReason | undefined;
  reasonNote?: string | undefined;
}): Promise<DaySession> {
  if (USE_MOCK_API) {
    return mockDelay(store.closeDay({ countedMinor: input.countedMinor, reason: input.reason, reasonNote: input.reasonNote }));
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/day/close", {
    body: {
      location_id: await getDefaultLocationId(),
      counted_amount_minor: input.countedMinor,
      variance_reason: combineVarianceReason(input.reason, input.reasonNote),
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapDaySessionOut(schemas.DaySessionOut.parse(raw));
}

/** No `/api/v1/day/reopen` endpoint exists at all — genuinely unsupported, not a naming mismatch. See docs/DECISIONS.md. */
export async function reopenDay(): Promise<DaySession> {
  if (USE_MOCK_API) return mockDelay(store.reopenDay());
  return notSupportedByBackend("Reopening a closed day");
}
