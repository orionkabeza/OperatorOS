import type { MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import type { Expense, RecordExpenseInput, RecurringExpense } from "./types";

/** Initial/default value only — the live, mutable threshold (Back Office → Settings) is `getApprovalThreshold()` below. */
export const EXPENSE_APPROVAL_THRESHOLD_MINOR = store.EXPENSE_APPROVAL_THRESHOLD_MINOR;

export async function getApprovalThreshold(): Promise<MinorUnits> {
  if (USE_MOCK_API) return mockDelay(store.getExpenseApprovalThreshold());
  return apiRequest<MinorUnits>("GET", "/api/v1/expenses/approval-threshold");
}

export async function setApprovalThreshold(amountMinor: MinorUnits): Promise<MinorUnits> {
  if (USE_MOCK_API) return mockDelay(store.setExpenseApprovalThreshold(amountMinor));
  return apiRequest<MinorUnits>("POST", "/api/v1/expenses/approval-threshold", { body: { amountMinor }, idempotencyKey: newIdempotencyKey() });
}

export async function listExpenses(): Promise<Expense[]> {
  if (USE_MOCK_API) return mockDelay(store.listExpenses());
  return apiRequest<Expense[]>("GET", "/api/v1/expenses");
}

export async function recordExpense(input: RecordExpenseInput): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.recordExpense(input));
  return apiRequest<Expense>("POST", "/api/v1/expenses", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function approveExpense(id: string): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.approveExpense(id));
  return apiRequest<Expense>("POST", `/api/v1/expenses/${id}/approve`, { idempotencyKey: newIdempotencyKey() });
}

export async function rejectExpense(id: string, note?: string): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.rejectExpense(id, note));
  return apiRequest<Expense>("POST", `/api/v1/expenses/${id}/reject`, { body: { note }, idempotencyKey: newIdempotencyKey() });
}

export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  if (USE_MOCK_API) return mockDelay(store.listRecurringExpenses());
  return apiRequest<RecurringExpense[]>("GET", "/api/v1/expenses/recurring");
}

export async function createRecurringExpense(template: RecordExpenseInput, interval: "weekly" | "monthly"): Promise<RecurringExpense> {
  if (USE_MOCK_API) return mockDelay(store.createRecurringExpense(template, interval));
  return apiRequest<RecurringExpense>("POST", "/api/v1/expenses/recurring", { body: { template, interval }, idempotencyKey: newIdempotencyKey() });
}

export async function toggleRecurringExpense(id: string, active: boolean): Promise<RecurringExpense> {
  if (USE_MOCK_API) return mockDelay(store.toggleRecurringExpense(id, active));
  return apiRequest<RecurringExpense>("POST", `/api/v1/expenses/recurring/${id}/toggle`, { body: { active }, idempotencyKey: newIdempotencyKey() });
}
