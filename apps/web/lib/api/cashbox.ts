import type { MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import type { MoneyLocation, MoneyMovement, MoneyMovementFilters } from "./types";

export async function listMoneyLocations(): Promise<MoneyLocation[]> {
  if (USE_MOCK_API) return mockDelay(store.listMoneyLocations());
  return apiRequest<MoneyLocation[]>("GET", "/api/v1/cashbox/locations");
}

export async function updateMoneyLocationBalance(accountKey: string, countedMinor: MinorUnits, reason?: string): Promise<MoneyLocation> {
  if (USE_MOCK_API) return mockDelay(store.updateMoneyLocationBalance(accountKey, countedMinor, reason));
  return apiRequest<MoneyLocation>("POST", `/api/v1/cashbox/locations/${accountKey}/update-balance`, {
    body: { countedMinor, reason },
    idempotencyKey: newIdempotencyKey(),
  });
}

export async function listMoneyMovements(filters?: MoneyMovementFilters): Promise<MoneyMovement[]> {
  if (USE_MOCK_API) return mockDelay(store.listMoneyMovements(filters));
  return apiRequest<MoneyMovement[]>("GET", "/api/v1/cashbox/movements", {
    query: { accountKey: filters?.accountKey, type: filters?.type, from: filters?.from, to: filters?.to, userId: filters?.userId },
  });
}
