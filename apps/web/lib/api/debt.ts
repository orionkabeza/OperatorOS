import { minorUnits } from "@operatoros/shared";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { apiRequest, DEFAULT_LOCATION_ID, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import { schemas } from "./generated/client";
import { mapCustomerOut } from "./customers";
import type { z } from "zod";
import type {
  BroadcastSend,
  ChaseQueueItem,
  ContactLogEntry,
  Customer,
  CustomerSegment,
  CustomerSegmentFilterSpec,
  DebtAccountSummary,
  DebtBookHeader,
  Invoice,
  ReminderChannel,
  ReminderDigestItem,
  ReminderSchedule,
  ReminderScheduleStep,
  StatementEntry,
  TakePaymentInput,
  TakePaymentResult,
  WriteOffInput,
} from "./types";

// ---------------------------------------------------------------------------
// Header + accounts
// ---------------------------------------------------------------------------

/**
 * Real backend statuses (schemas/debt.py's `CustomerAccountOut.status`
 * comment: `current | due_soon | overdue | on_hold | written_off`) don't
 * line up 1:1 with the frontend's 4-state `DebtAccountSummary["status"]`
 * (`current | due_this_week | overdue | over_limit`) — `over_limit` isn't a
 * backend status at all (it's a balance-vs-limit fact, computed here from
 * the real numbers rather than trusted from the collapsed string, which is
 * MORE faithful than a literal string mapping would be), and `on_hold`/
 * `written_off` are carried by `Customer.onHold`/`DebtAccountSummary.
 * hasWriteOff` instead of folded into this 4-way status.
 */
function mapAccountStatus(a: { status: string; balance_minor: number; credit_limit_minor: number }): DebtAccountSummary["status"] {
  if (a.credit_limit_minor > 0 && a.balance_minor > a.credit_limit_minor) return "over_limit";
  if (a.status === "overdue") return "overdue";
  if (a.status === "due_soon") return "due_this_week";
  return "current";
}

function mapAccountSummary(a: z.infer<typeof schemas.CustomerAccountOut>): DebtAccountSummary {
  const customer: Customer = {
    id: a.id,
    name: a.name,
    phone: a.phone ?? "",
    creditLimitMinor: minorUnits(a.credit_limit_minor),
    balanceMinor: minorUnits(a.balance_minor),
    // CustomerAccountOut carries no payment-terms field (only
    // GET /api/v1/customers/{id} does) — defaulted rather than fetched
    // per-row to avoid an N+1 fetch across a whole accounts table.
    termsDays: 0,
    onHold: a.status === "on_hold",
  };
  return {
    customer,
    // Only `oldest_unpaid_days` (an age) is on the wire, not an actual due
    // date — reconstructing a fake date from an age would be worse than
    // disclosing it's unavailable.
    oldestDueDateAt: null,
    oldestDaysOverdue: a.oldest_unpaid_days,
    status: mapAccountStatus(a),
    hasWriteOff: a.status === "written_off",
  };
}

export async function listDebtAccounts(): Promise<DebtAccountSummary[]> {
  if (USE_MOCK_API) return mockDelay(store.listDebtAccounts());
  const raw = await apiRequest<unknown>("GET", "/api/v1/debt/accounts");
  return schemas.CustomerAccountOut.array().parse(raw).map(mapAccountSummary);
}

/**
 * `DebtHeaderOut` (schemas/debt.py) carries only the four money figures and
 * `ageing` — no account/invoice COUNTS or the collected-vs-credit percent
 * the frontend's `DebtBookHeader` also wants. Those are derived here from a
 * second, already-real `listDebtAccounts()` call rather than either
 * inventing them or leaving misleading zeroes next to real, nonzero money
 * figures. `dueThisWeekInvoiceCount` is the one field genuinely NOT
 * derivable this way (it's invoice-level, and there's no bulk invoice
 * endpoint) — left at 0, disclosed here and in docs/DECISIONS.md, not
 * faked.
 */
export async function getDebtBookHeader(): Promise<DebtBookHeader> {
  if (USE_MOCK_API) return mockDelay(store.debtBookHeader());
  const [headerRaw, accounts] = await Promise.all([apiRequest<unknown>("GET", "/api/v1/debt/header"), listDebtAccounts()]);
  const header = schemas.DebtHeaderOut.parse(headerRaw);
  const ageing = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const bucket of header.ageing) {
    if (bucket.bucket in ageing) ageing[bucket.bucket as keyof typeof ageing] = bucket.amount_minor;
  }
  const overdueAccounts = accounts.filter((a) => a.status === "overdue");
  const totalCreditExtended = accounts.reduce((sum, a) => sum + a.customer.creditLimitMinor, 0);
  return {
    owedToYouMinor: minorUnits(header.owed_to_you_minor),
    owedToYouAccountCount: accounts.filter((a) => a.customer.balanceMinor > 0 && !a.hasWriteOff).length,
    overdueMinor: minorUnits(header.overdue_minor),
    overdueAccountCount: overdueAccounts.length,
    overdueOldestDays: Math.max(0, ...overdueAccounts.map((a) => a.oldestDaysOverdue ?? 0)),
    dueThisWeekMinor: minorUnits(header.due_this_week_minor),
    dueThisWeekInvoiceCount: 0, // not derivable without a per-customer invoice fetch — see comment above
    collectedThisMonthMinor: minorUnits(header.collected_this_month_minor),
    collectedThisMonthPercentOfCredit: totalCreditExtended > 0 ? Math.round((header.collected_this_month_minor / totalCreditExtended) * 100) : 0,
    ageing: {
      current: minorUnits(ageing.current),
      "1-30": minorUnits(ageing["1-30"]),
      "31-60": minorUnits(ageing["31-60"]),
      "61-90": minorUnits(ageing["61-90"]),
      "90+": minorUnits(ageing["90+"]),
    },
  };
}

// ---------------------------------------------------------------------------
// Per-customer invoices / statement / contact log
// ---------------------------------------------------------------------------

export async function listInvoices(customerId: string): Promise<Invoice[]> {
  if (USE_MOCK_API) return mockDelay(store.listInvoices(customerId));
  const raw = await apiRequest<unknown>("GET", `/api/v1/debt/accounts/${customerId}/invoices`);
  return schemas.InvoiceOut.array()
    .parse(raw)
    .map((inv) => ({
      // InvoiceOut has no invoice id distinct from sale_id, and no
      // receipt-number-formatted "INV-XXXX" label — sale_id is the only
      // real identifier on the wire, used for both rather than fabricating
      // a sequence number that doesn't exist server-side.
      id: inv.sale_id,
      invoiceNumber: `INV-${inv.sale_id.slice(0, 8).toUpperCase()}`,
      customerId,
      saleId: inv.sale_id,
      issuedAt: inv.occurred_at,
      dueDateAt: inv.due_date_at ?? inv.occurred_at,
      totalMinor: minorUnits(inv.total_minor),
      remainingMinor: minorUnits(inv.remaining_minor),
      status: inv.remaining_minor <= 0 ? "paid" : inv.days_overdue > 0 ? "overdue" : "open",
    }));
}

export async function listStatement(customerId: string): Promise<StatementEntry[]> {
  if (USE_MOCK_API) return mockDelay(store.listStatement(customerId));
  const raw = await apiRequest<unknown>("GET", `/api/v1/debt/accounts/${customerId}/statement`);
  return schemas.StatementLineOut.array()
    .parse(raw)
    .map((line, i) => ({
      id: `${line.reference_id}-${i}`, // StatementLineOut has no row id — synthesized from real fields
      customerId,
      date: line.occurred_at,
      kind: line.type === "sale" ? "invoice" : (line.type as StatementEntry["kind"]),
      ref: line.reference_id,
      detail: line.description,
      debitMinor: minorUnits(line.amount_minor > 0 ? line.amount_minor : 0),
      creditMinor: minorUnits(line.amount_minor < 0 ? -line.amount_minor : 0),
      runningBalanceMinor: minorUnits(line.running_balance_minor),
    }));
}

/** Real path is `GET .../contact-history`, not `.../contact-log`. */
export async function listContactLog(customerId: string): Promise<ContactLogEntry[]> {
  if (USE_MOCK_API) return mockDelay(store.listContactLog(customerId));
  const raw = await apiRequest<unknown>("GET", `/api/v1/debt/accounts/${customerId}/contact-history`);
  return schemas.ContactHistoryEntryOut.array().parse(raw).map((e) => mapContactHistoryEntry(customerId, e));
}

function mapContactHistoryEntry(customerId: string, e: z.infer<typeof schemas.ContactHistoryEntryOut>): ContactLogEntry {
  return {
    id: e.id,
    customerId,
    channel: e.channel as ContactLogEntry["channel"],
    step: e.template_key,
    sentAt: e.sent_at,
    delivered: e.delivered_status === "delivered" ? true : e.delivered_status === "failed" ? false : null,
    read: e.read_status === "read" ? true : e.read_status === "unread" ? false : null,
    note: e.note,
    // ContactHistoryEntryOut carries no actor/user field — `source`
    // ("manual"/"automated") is the closest real signal, not a user name.
    loggedBy: e.source,
  };
}

/** Real path is `POST .../log-call`, not `.../contact-log`. */
export async function logContact(customerId: string, note: string): Promise<ContactLogEntry> {
  if (USE_MOCK_API) return mockDelay(store.logContact(customerId, note, "manual_note"));
  const raw = await apiRequest<unknown>("POST", `/api/v1/debt/accounts/${customerId}/log-call`, {
    body: { note },
    idempotencyKey: newIdempotencyKey(),
  });
  return mapContactHistoryEntry(customerId, schemas.ContactHistoryEntryOut.parse(raw));
}

// ---------------------------------------------------------------------------
// Take payment / write-off
// ---------------------------------------------------------------------------

/**
 * Real path is `POST /api/v1/debt/accounts/{customer_id}/take-payment`
 * (not `/api/v1/debt/payments`), and the body shape is `TakePaymentRequest`
 * (schemas/debt.py) — `location_id` (not `moneyLocationAccountKey`: the
 * real endpoint derives the money-location account from `method` itself
 * via `payment_method_account_key`, so `moneyLocationAccountKey` has no
 * wire representation and is dropped) plus `allocation_mode`/
 * `manual_allocations` renamed from camelCase, `sale_id` instead of
 * `invoiceId` (a credit-bearing sale IS the invoice, docs/DECISIONS.md).
 */
export async function takePayment(input: TakePaymentInput): Promise<TakePaymentResult> {
  if (USE_MOCK_API) return mockDelay(store.takePayment(input));
  const raw = await apiRequest<unknown>("POST", `/api/v1/debt/accounts/${input.customerId}/take-payment`, {
    body: {
      location_id: DEFAULT_LOCATION_ID,
      amount_minor: input.amountMinor,
      method: input.method,
      reference: input.transactionRef ?? null,
      allocation_mode: input.allocationMode,
      manual_allocations:
        input.allocationMode === "manual" && input.manualAllocations
          ? input.manualAllocations.map((a) => ({ sale_id: a.invoiceId, amount_minor: a.amountMinor }))
          : null,
      received_at: input.backdatedTo ?? null,
      back_date_reason: input.backdateReason ?? null,
      send_receipt: false,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const result = schemas.TakePaymentOut.parse(raw);
  const customerRaw = await apiRequest<unknown>("GET", `/api/v1/customers/${input.customerId}`);
  const customer = mapCustomerOut(schemas.CustomerOut.parse(customerRaw));
  const allocatedMinor = result.allocations.reduce((sum, a) => sum + a.amount_minor, 0);
  return {
    paymentId: result.payment_event_id,
    allocations: result.allocations.map((a) => ({ invoiceId: a.sale_id, amountMinor: minorUnits(a.amount_minor) })),
    unallocatedMinor: minorUnits(result.amount_minor - allocatedMinor),
    // customer_balance_minor from the SAME transaction is fresher than
    // whatever the follow-up GET might race against, so it wins here.
    customer: { ...customer, balanceMinor: minorUnits(result.customer_balance_minor) },
  };
}

/**
 * Real path is `POST /api/v1/debt/accounts/{customer_id}/write-off` (not
 * `/api/v1/debt/write-off`), body `WriteOffRequest{reason,
 * confirm_customer_name?}` — the amount isn't client-supplied at all; the
 * real endpoint writes off the account's current balance, computed
 * server-side, so `input.amountMinor` has no wire representation.
 */
export async function writeOffDebt(input: WriteOffInput): Promise<void> {
  if (USE_MOCK_API) {
    store.writeOffDebt(input);
    await mockDelay(undefined);
    return;
  }
  const raw = await apiRequest<unknown>("POST", `/api/v1/debt/accounts/${input.customerId}/write-off`, {
    body: { reason: input.reason, confirm_customer_name: input.typedConfirmationName ?? null },
    idempotencyKey: newIdempotencyKey(),
  });
  schemas.WriteOffOut.parse(raw);
}

// ---------------------------------------------------------------------------
// Chase queue
// ---------------------------------------------------------------------------

/** Real path is `GET /api/v1/debt/queue`, not `/api/v1/debt/chase-queue`. */
export async function getChaseQueue(): Promise<ChaseQueueItem[]> {
  if (USE_MOCK_API) return mockDelay(store.chaseQueue());
  const raw = await apiRequest<unknown>("GET", "/api/v1/debt/queue");
  return schemas.ChaseQueueEntryOut.array()
    .parse(raw)
    .map((q) => ({
      customer: {
        id: q.customer_id,
        name: q.name,
        phone: q.phone ?? "",
        // ChaseQueueEntryOut carries no credit-limit figure — the queue is
        // already filtered to on_hold=false accounts server-side
        // (api/routers/debt.py::get_chase_queue skips `on_hold`), so
        // `onHold: false` here is a correct fact, not a default guess.
        creditLimitMinor: minorUnits(0),
        balanceMinor: minorUnits(q.balance_minor),
        termsDays: 0,
        onHold: false,
      },
      balanceMinor: minorUnits(q.balance_minor),
      daysOverdue: q.days_overdue,
      // No next-scheduled-step or last-contact field on ChaseQueueEntryOut
      // — would need joining against reminder-digest/contact-history per
      // row, an N+1 this list view doesn't warrant.
      nextReminderStep: null,
      lastContactAt: null,
      // No snooze concept exists server-side at all (see snoozeCustomer).
      snoozedUntil: null,
    }));
}

/** No backend counterpart — grep of api/routers/debt.py confirms no `/snooze` route exists anywhere in the Debt Book router. Genuinely unsupported, not a naming mismatch. */
export async function snoozeCustomer(customerId: string, untilIso: string): Promise<void> {
  if (USE_MOCK_API) {
    store.snoozeCustomer(customerId, untilIso);
    await mockDelay(undefined);
    return;
  }
  notSupportedByBackend(`Snoozing customer ${customerId} in the chase queue`);
}

// --- Reminder schedule (Back Office) ---------------------------------------

function mapStepOut(s: z.infer<typeof schemas.ReminderStepOut>): ReminderScheduleStep {
  return {
    id: s.id,
    order: s.step_order,
    offsetDays: s.offset_days,
    tone: s.label,
    // Real steps carry one `channel` string, not a list — wrapped to match
    // the frontend's `channels: ReminderChannel[]` shape.
    channels: [s.channel as ReminderChannel],
    template: s.template_key,
    // No enabled/disabled flag exists per-step server-side (only the whole
    // schedule can be paused) — every fetched step is, by definition,
    // live.
    enabled: true,
  };
}

function mapScheduleOut(s: z.infer<typeof schemas.ReminderScheduleOut>): ReminderSchedule {
  return {
    id: s.id,
    businessId: "", // ReminderScheduleOut doesn't echo business_id back
    steps: s.steps.map(mapStepOut).sort((a, b) => a.order - b.order),
    approvalMode: s.approval_mode,
    paused: s.paused,
    quietHoursStart: `${String(s.quiet_hours_start).padStart(2, "0")}:00`,
    quietHoursEnd: `${String(s.quiet_hours_end).padStart(2, "0")}:00`,
    // `max_per_customer_hours` is a COOLDOWN IN HOURS between reminders to
    // the same customer, not "max sends per week" — the frontend field
    // name assumes a weekly cap that doesn't exist server-side. Carrying
    // the real hours value through rather than doing a lossy hours->weeks
    // conversion that would misrepresent what the number means.
    maxPerCustomerPerWeek: s.max_per_customer_hours,
  };
}

/**
 * The real backend models a LIST of named schedules (`GET/POST
 * /api/v1/debt/reminder-schedules`), not one singular schedule resource —
 * "the" schedule the frontend edits is the business's DEFAULT one
 * (`customer_id: null`), created on first use if none exists yet rather
 * than assuming the backend will grow a singular-schedule endpoint.
 */
async function getOrCreateDefaultSchedule(): Promise<z.infer<typeof schemas.ReminderScheduleOut>> {
  const raw = await apiRequest<unknown>("GET", "/api/v1/debt/reminder-schedules");
  const schedules = schemas.ReminderScheduleOut.array().parse(raw);
  const existing = schedules.find((s) => s.customer_id === null);
  if (existing) return existing;
  const createdRaw = await apiRequest<unknown>("POST", "/api/v1/debt/reminder-schedules", {
    body: { name: "Default", customer_id: null },
    idempotencyKey: newIdempotencyKey(),
  });
  return schemas.ReminderScheduleOut.parse(createdRaw);
}

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.getReminderSchedule());
  return mapScheduleOut(await getOrCreateDefaultSchedule());
}

export async function updateReminderSchedule(patch: Partial<Omit<ReminderSchedule, "steps">>): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.updateReminderSchedule(patch));
  const current = await getOrCreateDefaultSchedule();
  const body: Record<string, unknown> = {};
  if (patch.paused !== undefined) body.paused = patch.paused;
  if (patch.approvalMode !== undefined) body.approval_mode = patch.approvalMode;
  if (patch.quietHoursStart !== undefined) body.quiet_hours_start = Number.parseInt(patch.quietHoursStart.split(":")[0]!, 10);
  if (patch.quietHoursEnd !== undefined) body.quiet_hours_end = Number.parseInt(patch.quietHoursEnd.split(":")[0]!, 10);
  if (patch.maxPerCustomerPerWeek !== undefined) body.max_per_customer_hours = patch.maxPerCustomerPerWeek;
  const raw = await apiRequest<unknown>("PATCH", `/api/v1/debt/reminder-schedules/${current.id}`, {
    body,
    idempotencyKey: newIdempotencyKey(),
  });
  return mapScheduleOut(schemas.ReminderScheduleOut.parse(raw));
}

/**
 * No backend counterpart at all — `ReminderScheduleUpdateRequest`
 * (schemas/reminders.py) has no `steps` field, and there is no separate
 * per-step route either. Steps can only be set at schedule CREATION time
 * (`ReminderScheduleCreateRequest.steps`); the real API has no way to edit
 * an existing step, full stop. This is a real, disclosed gap — not the
 * "PATCH the whole schedule body" shape the seed guess assumed.
 */
export async function updateReminderStep(stepId: string, patch: Partial<ReminderScheduleStep>): Promise<ReminderSchedule> {
  if (USE_MOCK_API) return mockDelay(store.updateReminderStep(stepId, patch));
  return notSupportedByBackend(`Editing reminder schedule step ${stepId}`);
}

function mapDigestEntry(d: z.infer<typeof schemas.ReminderDigestEntryOut>): ReminderDigestItem {
  const step: ReminderScheduleStep = {
    id: d.step_id,
    order: d.step_order,
    offsetDays: 0, // not on ReminderDigestEntryOut
    tone: d.label,
    channels: [d.channel as ReminderChannel],
    template: d.template_key,
    enabled: true,
  };
  return {
    id: `${d.customer_id}-${d.step_id}`,
    customer: {
      id: d.customer_id,
      name: d.customer_name,
      phone: "", // not on the wire here
      creditLimitMinor: minorUnits(0),
      balanceMinor: minorUnits(d.amount_minor),
      termsDays: 0,
      onHold: false,
    },
    step,
    // ReminderDigestEntryOut carries no rendered template body (that needs
    // a separate `/reminder-schedules/preview` call per entry, against the
    // schedule step's own template text) — a real-data summary line
    // stands in rather than a fabricated message.
    renderedMessage: `${d.label} — RWF ${(d.amount_minor / 100).toLocaleString("en-US")}, ${d.days_overdue}d overdue.`,
    checked: true,
  };
}

export async function getReminderDigest(): Promise<ReminderDigestItem[]> {
  if (USE_MOCK_API) return mockDelay(store.reminderDigest());
  const raw = await apiRequest<unknown>("GET", "/api/v1/debt/reminder-digest");
  return schemas.ReminderDigestEntryOut.array().parse(raw).map(mapDigestEntry);
}

/** Real path is `POST /api/v1/debt/reminder-digest/send`, body `{ customer_ids? }` — not `/api/v1/debt/reminders/send` with `{ customerIds }`. Response is `{ sent: number }`, not a bare number, but the return type here stays a plain count. */
export async function sendReminders(customerIds: string[]): Promise<number> {
  if (USE_MOCK_API) return mockDelay(store.sendReminders(customerIds));
  const raw = await apiRequest<{ sent: number }>("POST", "/api/v1/debt/reminder-digest/send", {
    body: { customer_ids: customerIds },
    idempotencyKey: newIdempotencyKey(),
  });
  return raw.sent;
}

// --- All customers / segments / broadcast -----------------------------------

export async function listSegments(): Promise<CustomerSegment[]> {
  if (USE_MOCK_API) return mockDelay(store.listSegments());
  const raw = await apiRequest<unknown>("GET", "/api/v1/customers/segments");
  return schemas.SegmentOut.array()
    .parse(raw)
    .map((s) => ({
      id: s.id,
      name: s.name,
      filterSpec: s.filter_spec as CustomerSegmentFilterSpec,
      memberCount: s.member_count,
    }));
}

export async function createSegment(name: string, filterSpec: CustomerSegmentFilterSpec): Promise<CustomerSegment> {
  if (USE_MOCK_API) return mockDelay(store.createSegment(name, filterSpec));
  const raw = await apiRequest<unknown>("POST", "/api/v1/customers/segments", {
    body: { name, filter_spec: filterSpec },
    idempotencyKey: newIdempotencyKey(),
  });
  const s = schemas.SegmentOut.parse(raw);
  return { id: s.id, name: s.name, filterSpec: s.filter_spec as CustomerSegmentFilterSpec, memberCount: s.member_count };
}

/** Real `BroadcastSendRequest` requires a non-null `segment_id` (schemas/customers.py) — broadcasting to "everyone" (`segmentId: null`) has no wire representation and is rejected server-side rather than silently coerced into something the backend didn't ask for. */
export async function sendBroadcast(segmentId: string | null, message: string): Promise<BroadcastSend> {
  if (USE_MOCK_API) return mockDelay(store.sendBroadcast(segmentId, message));
  if (segmentId === null) {
    return notSupportedByBackend("Broadcasting to all customers without a segment (the real API requires a segment_id)");
  }
  const raw = await apiRequest<unknown>("POST", "/api/v1/customers/broadcast", {
    body: { segment_id: segmentId, message },
    idempotencyKey: newIdempotencyKey(),
  });
  const b = schemas.BroadcastSendOut.parse(raw);
  return {
    id: b.id,
    segmentId: b.segment_id,
    segmentName: "", // BroadcastSendOut doesn't echo the segment's name back
    message: b.message,
    sentAt: b.sent_at,
    sentBy: "", // not on the wire
    recipientCount: b.recipient_count,
    deliveredCount: b.delivered_count,
    readCount: b.read_count,
  };
}

/** No backend counterpart at all — `customers.py` only has `POST /segments`, `GET /segments`, `POST /broadcast` (send, not list/history). Genuinely unsupported, kept mock-only. See docs/DECISIONS.md. */
export async function listBroadcasts(): Promise<BroadcastSend[]> {
  if (USE_MOCK_API) return mockDelay(store.listBroadcasts());
  return notSupportedByBackend("Listing broadcast history");
}
