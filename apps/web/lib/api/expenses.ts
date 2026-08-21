import { minorUnits, type MinorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, DEFAULT_LOCATION_ID, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import type { z } from "zod";
import type { Expense, ExpenseCategory, RecordExpenseInput, RecurringExpense } from "./types";

/**
 * Initial/default value only — the live threshold (Back Office → Settings)
 * is `getApprovalThreshold()` below, which for the real backend is the
 * SAME hardcoded value: `api/routers/expenses.py::EXPENSE_APPROVAL_THRESHOLD_MINOR`
 * (5,000.00 RWF, same pattern as `sales.py`'s discount threshold and
 * `debt.py`'s write-off name-confirm threshold — a disclosed gap pending a
 * real Back Office settings system, not something this endpoint persists).
 * There is no `/api/v1/expenses/approval-threshold` route at all.
 */
export const EXPENSE_APPROVAL_THRESHOLD_MINOR = store.EXPENSE_APPROVAL_THRESHOLD_MINOR;

/** Read-only against the real backend — the threshold is a Python constant, not a stored setting. Returns the known hardcoded value rather than calling a nonexistent endpoint. */
export async function getApprovalThreshold(): Promise<MinorUnits> {
  if (USE_MOCK_API) return mockDelay(store.getExpenseApprovalThreshold());
  return Promise.resolve(EXPENSE_APPROVAL_THRESHOLD_MINOR);
}

/** No backend counterpart — the threshold can't actually be changed server-side. Callers (Back Office → Settings) must not present this as a working edit against the real API; see docs/DECISIONS.md. */
export async function setApprovalThreshold(amountMinor: MinorUnits): Promise<MinorUnits> {
  if (USE_MOCK_API) return mockDelay(store.setExpenseApprovalThreshold(amountMinor));
  return notSupportedByBackend("Changing the expense approval threshold");
}

function mapExpenseOut(e: z.infer<typeof schemas.ExpenseOut>): Expense {
  return {
    id: e.id,
    amountMinor: minorUnits(e.amount_minor),
    category: e.category as ExpenseCategory,
    moneyLocationAccountKey: e.money_location,
    payee: e.payee ?? "",
    date: e.expense_date,
    note: e.note ?? "",
    receiptPhotoUrl: e.receipt_photo_url,
    // The frontend's `Expense.ocrStatus` type is the single literal
    // "not_attempted" (no OCR-in-progress/succeeded/failed states were
    // ever modeled) even though the real `ExpenseOut.ocr_status` can carry
    // other values — narrowing here rather than widening the type outside
    // lib/api's scope.
    ocrStatus: "not_attempted",
    status: e.status as Expense["status"],
    approvedBy: e.approved_by_user_id,
    createdBy: e.created_by_user_id,
    // ExpenseOut has no separate creation timestamp — expense_date is the
    // closest real field available.
    createdAt: e.expense_date,
  };
}

export async function listExpenses(): Promise<Expense[]> {
  if (USE_MOCK_API) return mockDelay(store.listExpenses());
  const raw = await apiRequest<unknown>("GET", "/api/v1/expenses");
  return schemas.ExpenseOut.array().parse(raw).map(mapExpenseOut);
}

export async function recordExpense(input: RecordExpenseInput): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.recordExpense(input));
  const raw = await apiRequest<unknown>("POST", "/api/v1/expenses", {
    body: {
      amount_minor: input.amountMinor,
      category: input.category,
      expense_date: input.date,
      location_id: DEFAULT_LOCATION_ID,
      money_location: input.moneyLocationAccountKey,
      note: input.note ?? null,
      payee: input.payee,
      receipt_photo_url: input.receiptPhotoUrl ?? null,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapExpenseOut(schemas.ExpenseOut.parse(raw));
}

export async function approveExpense(id: string): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.approveExpense(id));
  const raw = await apiRequest<unknown>("POST", `/api/v1/expenses/${id}/approve`, { idempotencyKey: newIdempotencyKey() });
  return mapExpenseOut(schemas.ExpenseOut.parse(raw));
}

/** Real `ExpenseRejectRequest.reason` is required (unlike the frontend's optional `note`) — an undefined note falls back to a disclosed placeholder reason rather than sending an empty/missing field. */
export async function rejectExpense(id: string, note?: string): Promise<Expense> {
  if (USE_MOCK_API) return mockDelay(store.rejectExpense(id, note));
  const raw = await apiRequest<unknown>("POST", `/api/v1/expenses/${id}/reject`, {
    body: { reason: note && note.trim() ? note : "No reason given" },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapExpenseOut(schemas.ExpenseOut.parse(raw));
}

function mapRecurringExpenseOut(r: z.infer<typeof schemas.RecurringExpenseOut>): RecurringExpense {
  return {
    id: r.id,
    template: {
      amountMinor: minorUnits(r.amount_minor),
      category: r.category as ExpenseCategory,
      moneyLocationAccountKey: r.money_location,
      payee: r.payee ?? "",
      date: r.next_run_date,
      note: r.note ?? undefined,
    },
    interval: r.interval as RecurringExpense["interval"],
    nextRunDate: r.next_run_date,
    active: r.active,
  };
}

/** Real path is `GET /api/v1/expenses/recurring/list`, not `/api/v1/expenses/recurring` (that path is POST-create only). */
export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  if (USE_MOCK_API) return mockDelay(store.listRecurringExpenses());
  const raw = await apiRequest<unknown>("GET", "/api/v1/expenses/recurring/list");
  return schemas.RecurringExpenseOut.array().parse(raw).map(mapRecurringExpenseOut);
}

export async function createRecurringExpense(template: RecordExpenseInput, interval: "weekly" | "monthly"): Promise<RecurringExpense> {
  if (USE_MOCK_API) return mockDelay(store.createRecurringExpense(template, interval));
  const raw = await apiRequest<unknown>("POST", "/api/v1/expenses/recurring", {
    body: {
      amount_minor: template.amountMinor,
      category: template.category,
      interval,
      location_id: DEFAULT_LOCATION_ID,
      money_location: template.moneyLocationAccountKey,
      next_run_date: template.date,
      note: template.note ?? null,
      payee: template.payee,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapRecurringExpenseOut(schemas.RecurringExpenseOut.parse(raw));
}

/** Real path is `PATCH /api/v1/expenses/recurring/{id}` — there's no separate `/toggle` route; toggling `active` is just a partial update with that one field. */
export async function toggleRecurringExpense(id: string, active: boolean): Promise<RecurringExpense> {
  if (USE_MOCK_API) return mockDelay(store.toggleRecurringExpense(id, active));
  const raw = await apiRequest<unknown>("PATCH", `/api/v1/expenses/recurring/${id}`, {
    body: { active },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapRecurringExpenseOut(schemas.RecurringExpenseOut.parse(raw));
}
