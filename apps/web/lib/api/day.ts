import type { MinorUnits } from "@operatoros/shared";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import type { DayCloseChecklist, DaySession, DaySummary, OpenDayInput, VarianceReason } from "./types";

export async function getDayStatus(): Promise<DaySession> {
  if (USE_MOCK_API) return mockDelay(store.getDaySession());
  return apiRequest<DaySession>("GET", "/api/v1/day/status");
}

export async function openDay(input: OpenDayInput): Promise<DaySession> {
  if (USE_MOCK_API) {
    return mockDelay(store.openDay({ countedMinor: input.countedMinor, reason: input.reason, reasonNote: input.reasonNote }));
  }
  return apiRequest<DaySession>("POST", "/api/v1/day/open", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function getDayCloseChecklist(): Promise<DayCloseChecklist> {
  if (USE_MOCK_API) return mockDelay(store.dayCloseChecklist());
  return apiRequest<DayCloseChecklist>("GET", "/api/v1/day/close-checklist");
}

export async function getDaySummary(): Promise<DaySummary> {
  if (USE_MOCK_API) return mockDelay(store.daySummary());
  return apiRequest<DaySummary>("GET", "/api/v1/day/summary");
}

export async function getExpectedTillMinor() {
  if (USE_MOCK_API) return mockDelay(store.expectedTillMinor());
  return apiRequest<number>("GET", "/api/v1/day/expected-till");
}

export async function closeDay(input: {
  countedMinor: MinorUnits;
  reason?: VarianceReason | undefined;
  reasonNote?: string | undefined;
}): Promise<DaySession> {
  if (USE_MOCK_API) {
    return mockDelay(store.closeDay({ countedMinor: input.countedMinor, reason: input.reason, reasonNote: input.reasonNote }));
  }
  return apiRequest<DaySession>("POST", "/api/v1/day/close", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function reopenDay(): Promise<DaySession> {
  if (USE_MOCK_API) return mockDelay(store.reopenDay());
  return apiRequest<DaySession>("POST", "/api/v1/day/reopen", { idempotencyKey: newIdempotencyKey() });
}
