import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, newIdempotencyKey, USE_MOCK_API } from "./config";
import type {
  BroadcastSend,
  ChaseQueueItem,
  ContactLogEntry,
  CustomerSegment,
  CustomerSegmentFilterSpec,
  DebtAccountSummary,
  DebtBookHeader,
  Invoice,
  ReminderDigestItem,
  ReminderSchedule,
  ReminderScheduleStep,
  StatementEntry,
  TakePaymentInput,
  TakePaymentResult,
  WriteOffInput,
} from "./types";

export async function getDebtBookHeader(): Promise<DebtBookHeader> {
  if (USE_MOCK_API) return mockDelay(store.debtBookHeader());
  return apiRequest<DebtBookHeader>("GET", "/api/v1/debt/header");
}

export async function listDebtAccounts(): Promise<DebtAccountSummary[]> {
  if (USE_MOCK_API) return mockDelay(store.listDebtAccounts());
  return apiRequest<DebtAccountSummary[]>("GET", "/api/v1/debt/accounts");
}

export async function listInvoices(customerId: string): Promise<Invoice[]> {
  if (USE_MOCK_API) return mockDelay(store.listInvoices(customerId));
  return apiRequest<Invoice[]>("GET", `/api/v1/debt/accounts/${customerId}/invoices`);
}

export async function listStatement(customerId: string): Promise<StatementEntry[]> {
  if (USE_MOCK_API) return mockDelay(store.listStatement(customerId));
  return apiRequest<StatementEntry[]>("GET", `/api/v1/debt/accounts/${customerId}/statement`);
}

export async function listContactLog(customerId: string): Promise<ContactLogEntry[]> {
  if (USE_MOCK_API) return mockDelay(store.listContactLog(customerId));
  return apiRequest<ContactLogEntry[]>("GET", `/api/v1/debt/accounts/${customerId}/contact-log`);
}

export async function logContact(customerId: string, note: string): Promise<ContactLogEntry> {
  if (USE_MOCK_API) return mockDelay(store.logContact(customerId, note, "manual_note"));
  return apiRequest<ContactLogEntry>("POST", `/api/v1/debt/accounts/${customerId}/contact-log`, { body: { note }, idempotencyKey: newIdempotencyKey() });
}

export async function takePayment(input: TakePaymentInput): Promise<TakePaymentResult> {
  if (USE_MOCK_API) return mockDelay(store.takePayment(input));
  return apiRequest<TakePaymentResult>("POST", "/api/v1/debt/payments", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function writeOffDebt(input: WriteOffInput): Promise<void> {
  if (USE_MOCK_API) {
    store.writeOffDebt(input);
    await mockDelay(undefined);
    return;
  }
  await apiRequest<void>("POST", "/api/v1/debt/write-off", { body: input, idempotencyKey: newIdempotencyKey() });
}

export async function getChaseQueue(): Promise<ChaseQueueItem[]> {
  if (USE_MOCK_API) return mockDelay(store.chaseQueue());
  return apiRequest<ChaseQueueItem[]>("GET", "/api/v1/debt/chase-queue");
}

export async function snoozeCustomer(customerId: string, untilIso: string): Promise<void> {
  if (USE_MOCK_API) {
    store.snoozeCustomer(customerId, untilIso);
    await mockDelay(undefined);
    return;
  }
  await apiRequest<void>("POST", `/api/v1/debt/accounts/${customerId}/snooze`, { body: { until: untilIso }, idempotencyKey: newIdempotencyKey() });
}

// --- Reminder schedule (Back Office) ---------------------------------------

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.getReminderSchedule());
  return apiRequest<ReminderSchedule>("GET", "/api/v1/debt/reminder-schedule");
}

export async function updateReminderSchedule(patch: Partial<Omit<ReminderSchedule, "steps">>): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.updateReminderSchedule(patch));
  return apiRequest<ReminderSchedule>("PATCH", "/api/v1/debt/reminder-schedule", { body: patch, idempotencyKey: newIdempotencyKey() });
}

export async function updateReminderStep(stepId: string, patch: Partial<ReminderScheduleStep>): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.updateReminderStep(stepId, patch));
  return apiRequest<ReminderSchedule>("PATCH", `/api/v1/debt/reminder-schedule/steps/${stepId}`, { body: patch, idempotencyKey: newIdempotencyKey() });
}

export async function getReminderDigest(): Promise<ReminderDigestItem[]> {
  if (USE_MOCK_API) return mockDelay(store.reminderDigest());
  return apiRequest<ReminderDigestItem[]>("GET", "/api/v1/debt/reminder-digest");
}

export async function sendReminders(customerIds: string[]): Promise<number> {
  if (USE_MOCK_API) return mockDelay(store.sendReminders(customerIds));
  return apiRequest<number>("POST", "/api/v1/debt/reminders/send", { body: { customerIds }, idempotencyKey: newIdempotencyKey() });
}

// --- All customers / segments / broadcast -----------------------------------

export async function listSegments(): Promise<CustomerSegment[]> {
  if (USE_MOCK_API) return mockDelay(store.listSegments());
  return apiRequest<CustomerSegment[]>("GET", "/api/v1/customers/segments");
}

export async function createSegment(name: string, filterSpec: CustomerSegmentFilterSpec): Promise<CustomerSegment> {
  if (USE_MOCK_API) return mockDelay(store.createSegment(name, filterSpec));
  return apiRequest<CustomerSegment>("POST", "/api/v1/customers/segments", { body: { name, filterSpec }, idempotencyKey: newIdempotencyKey() });
}

export async function sendBroadcast(segmentId: string | null, message: string): Promise<BroadcastSend> {
  if (USE_MOCK_API) return mockDelay(store.sendBroadcast(segmentId, message));
  return apiRequest<BroadcastSend>("POST", "/api/v1/customers/broadcast", { body: { segmentId, message }, idempotencyKey: newIdempotencyKey() });
}

export async function listBroadcasts(): Promise<BroadcastSend[]> {
  if (USE_MOCK_API) return mockDelay(store.listBroadcasts());
  return apiRequest<BroadcastSend[]>("GET", "/api/v1/customers/broadcast");
}
