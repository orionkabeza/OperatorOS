import { minorUnits } from "@operatoros/shared";
import type {
  ContactLogEntry,
  CustomerSegment,
  Expense,
  Invoice,
  MoneyLocation,
  MoneyMovement,
  MomoTransaction,
  RecurringExpense,
  ReminderSchedule,
  StatementEntry,
} from "../api/types";
import { CURRENT_USER_ID, CURRENT_USER_NAME, rwf } from "./seed";

/**
 * Phase 2 (Debt Book / Cash Box) mock fixtures — a Kigali hardware-store
 * shaped dataset: overdue customers spanning every ageing bucket and
 * account status, a mix of MoMo/cash/bank money locations, some unmatched
 * MoMo transactions, and expenses on both sides of the approval threshold.
 * Kept in its own file (rather than growing seed.ts further) since it's a
 * genuinely separate domain from Phase 1's catalog/customer fixtures, but
 * follows the exact same conventions (rwf() helper, plain exported consts,
 * copied — not shared-by-reference — into freshDb() so nothing here is
 * ever mutated in place across a session).
 */

const ALPHONSE_USER_ID = "user-alphonse";
const ALPHONSE_USER_NAME = "Alphonse Nshimiyimana";

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Invoices (credit-bearing sales, per docs/DECISIONS.md — dueDateAt snapshotted at issue time)
// ---------------------------------------------------------------------------

export const INVOICES: Invoice[] = [
  // Kigali Builders Ltd — 1,760,000 total across two invoices, one partly paid.
  {
    id: "inv-kb-1",
    invoiceNumber: "INV-2841",
    customerId: "cust-kigali-builders",
    saleId: "sale-seed-kb-1",
    issuedAt: daysAgoIso(42),
    dueDateAt: daysAgoIso(12),
    totalMinor: rwf(1_500_000),
    remainingMinor: rwf(1_200_000), // 300,000 already paid — see STATEMENTS below
    status: "overdue",
  },
  {
    id: "inv-kb-2",
    invoiceNumber: "INV-2977",
    customerId: "cust-kigali-builders",
    saleId: "sale-seed-kb-2",
    issuedAt: daysAgoIso(25),
    dueDateAt: daysAgoIso(-5),
    totalMinor: rwf(560_000),
    remainingMinor: rwf(560_000),
    status: "open",
  },
  // Jean-Paul Nzeyimana — one invoice, not yet due, comfortably inside terms.
  {
    id: "inv-jpn-1",
    invoiceNumber: "INV-3102",
    customerId: "cust-nzeyimana",
    saleId: "sale-seed-jpn-1",
    issuedAt: daysAgoIso(3),
    dueDateAt: daysAgoIso(-11),
    totalMinor: rwf(45_000),
    remainingMinor: rwf(45_000),
    status: "open",
  },
  // Divine Umutoni — one invoice, 35 days overdue (31-60 bucket).
  {
    id: "inv-du-1",
    invoiceNumber: "INV-2650",
    customerId: "cust-umutoni",
    saleId: "sale-seed-du-1",
    issuedAt: daysAgoIso(65),
    dueDateAt: daysAgoIso(35),
    totalMinor: rwf(120_000),
    remainingMinor: rwf(120_000),
    status: "overdue",
  },
  // Jean Bosco Habimana — two invoices, 62d and 35d overdue (61-90 and 31-60).
  {
    id: "inv-jbh-1",
    invoiceNumber: "INV-2611",
    customerId: "cust-habimana",
    saleId: "sale-seed-jbh-1",
    issuedAt: daysAgoIso(92),
    dueDateAt: daysAgoIso(62),
    totalMinor: rwf(900_000),
    remainingMinor: rwf(900_000),
    status: "overdue",
  },
  {
    id: "inv-jbh-2",
    invoiceNumber: "INV-2802",
    customerId: "cust-habimana",
    saleId: "sale-seed-jbh-2",
    issuedAt: daysAgoIso(65),
    dueDateAt: daysAgoIso(35),
    totalMinor: rwf(945_000),
    remainingMinor: rwf(945_000),
    status: "overdue",
  },
  // Alice Mukamana — due in 4 days (due-this-week fixture).
  {
    id: "inv-am-1",
    invoiceNumber: "INV-3140",
    customerId: "cust-mukamana",
    saleId: "sale-seed-am-1",
    issuedAt: daysAgoIso(10),
    dueDateAt: daysAgoIso(-4),
    totalMinor: rwf(180_000),
    remainingMinor: rwf(180_000),
    status: "open",
  },
  // Emmanuel Gasana — 45 days overdue (31-60 bucket).
  {
    id: "inv-eg-1",
    invoiceNumber: "INV-2711",
    customerId: "cust-gasana",
    saleId: "sale-seed-eg-1",
    issuedAt: daysAgoIso(75),
    dueDateAt: daysAgoIso(45),
    totalMinor: rwf(340_000),
    remainingMinor: rwf(340_000),
    status: "overdue",
  },
  // Solange Uwase — 75 days overdue (61-90 bucket).
  {
    id: "inv-su-1",
    invoiceNumber: "INV-2588",
    customerId: "cust-uwase",
    saleId: "sale-seed-su-1",
    issuedAt: daysAgoIso(89),
    dueDateAt: daysAgoIso(75),
    totalMinor: rwf(410_000),
    remainingMinor: rwf(410_000),
    status: "overdue",
  },
  // Patrick Ndayisenga — two invoices, 120d (90+) and 15d (1-30); over the credit limit.
  {
    id: "inv-pn-1",
    invoiceNumber: "INV-2299",
    customerId: "cust-ndayisenga",
    saleId: "sale-seed-pn-1",
    issuedAt: daysAgoIso(150),
    dueDateAt: daysAgoIso(120),
    totalMinor: rwf(1_020_000),
    remainingMinor: rwf(1_020_000),
    status: "overdue",
  },
  {
    id: "inv-pn-2",
    invoiceNumber: "INV-3050",
    customerId: "cust-ndayisenga",
    saleId: "sale-seed-pn-2",
    issuedAt: daysAgoIso(45),
    dueDateAt: daysAgoIso(15),
    totalMinor: rwf(600_000),
    remainingMinor: rwf(600_000),
    status: "overdue",
  },
];

// ---------------------------------------------------------------------------
// Statements — running ledger per customer, oldest first, balances tie out to Customer.balanceMinor
// ---------------------------------------------------------------------------

export const STATEMENTS: StatementEntry[] = [
  { id: "st-kb-1", customerId: "cust-kigali-builders", date: daysAgoIso(42), kind: "invoice", ref: "INV-2841", detail: "40 bags cement, 12 bars rebar 12mm", debitMinor: rwf(1_500_000), creditMinor: rwf(0), runningBalanceMinor: rwf(1_500_000) },
  { id: "st-kb-2", customerId: "cust-kigali-builders", date: daysAgoIso(30), kind: "payment", ref: "PAY-1190", detail: "MTN MoMo · ref 8814QK", debitMinor: rwf(0), creditMinor: rwf(300_000), runningBalanceMinor: rwf(1_200_000) },
  { id: "st-kb-3", customerId: "cust-kigali-builders", date: daysAgoIso(25), kind: "invoice", ref: "INV-2977", detail: "Wheelbarrows ×4, paint 20L ×6", debitMinor: rwf(560_000), creditMinor: rwf(0), runningBalanceMinor: rwf(1_760_000) },

  { id: "st-jpn-1", customerId: "cust-nzeyimana", date: daysAgoIso(3), kind: "invoice", ref: "INV-3102", detail: "PVC fittings assortment", debitMinor: rwf(45_000), creditMinor: rwf(0), runningBalanceMinor: rwf(45_000) },

  { id: "st-du-1", customerId: "cust-umutoni", date: daysAgoIso(65), kind: "invoice", ref: "INV-2650", detail: "Electrical cable 2.5mm ×2 rolls", debitMinor: rwf(120_000), creditMinor: rwf(0), runningBalanceMinor: rwf(120_000) },

  { id: "st-jbh-1", customerId: "cust-habimana", date: daysAgoIso(92), kind: "invoice", ref: "INV-2611", detail: "Cement 50kg ×60, rebar 12mm ×40", debitMinor: rwf(900_000), creditMinor: rwf(0), runningBalanceMinor: rwf(900_000) },
  { id: "st-jbh-2", customerId: "cust-habimana", date: daysAgoIso(65), kind: "invoice", ref: "INV-2802", detail: "Rebar 8mm bundle ×8, binding wire ×20", debitMinor: rwf(945_000), creditMinor: rwf(0), runningBalanceMinor: rwf(1_845_000) },

  { id: "st-am-1", customerId: "cust-mukamana", date: daysAgoIso(10), kind: "invoice", ref: "INV-3140", detail: "Paint brushes, emulsion paint 20L", debitMinor: rwf(180_000), creditMinor: rwf(0), runningBalanceMinor: rwf(180_000) },

  { id: "st-eg-1", customerId: "cust-gasana", date: daysAgoIso(75), kind: "invoice", ref: "INV-2711", detail: "Tools assortment, tape measures", debitMinor: rwf(340_000), creditMinor: rwf(0), runningBalanceMinor: rwf(340_000) },

  { id: "st-su-1", customerId: "cust-uwase", date: daysAgoIso(89), kind: "invoice", ref: "INV-2588", detail: "Plumbing fittings bulk order", debitMinor: rwf(410_000), creditMinor: rwf(0), runningBalanceMinor: rwf(410_000) },

  { id: "st-pn-1", customerId: "cust-ndayisenga", date: daysAgoIso(150), kind: "invoice", ref: "INV-2299", detail: "Circuit breakers ×30, socket combos ×80", debitMinor: rwf(1_020_000), creditMinor: rwf(0), runningBalanceMinor: rwf(1_020_000) },
  { id: "st-pn-2", customerId: "cust-ndayisenga", date: daysAgoIso(45), kind: "invoice", ref: "INV-3050", detail: "Cement 50kg ×40", debitMinor: rwf(600_000), creditMinor: rwf(0), runningBalanceMinor: rwf(1_620_000) },
];

// ---------------------------------------------------------------------------
// Reminder schedule — default 4-step sequence, merge fields per docs/plans/phase-2.md §4
// ---------------------------------------------------------------------------

export const REMINDER_SCHEDULE: ReminderSchedule = {
  id: "sched-default",
  businessId: "biz-demo",
  approvalMode: true,
  paused: false,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  maxPerCustomerPerWeek: 3,
  steps: [
    {
      id: "step-1",
      order: 1,
      offsetDays: -3,
      tone: "Friendly nudge",
      channels: ["whatsapp"],
      enabled: true,
      template: "Muraho {customer}, a friendly reminder from the shop: RWF {amount} on your account falls due soon. You can pay by MoMo or at the counter. Murakoze!",
    },
    {
      id: "step-2",
      order: 2,
      offsetDays: 0,
      tone: "Neutral, payment details",
      channels: ["whatsapp"],
      enabled: true,
      template: "Muraho {customer}, RWF {amount} is due today. Pay by MoMo here: {pay_link} or drop by the shop. Thank you for your business.",
    },
    {
      id: "step-3",
      order: 3,
      offsetDays: 7,
      tone: "Firm, asks for a date",
      channels: ["whatsapp", "sms"],
      enabled: true,
      template: "Muraho {customer}, RWF {amount} was due on {oldest_invoice_date} and is now {days_overdue} days overdue. Can you tell us which day you plan to settle? Pay here: {pay_link}",
    },
    {
      id: "step-4",
      order: 4,
      offsetDays: 21,
      tone: "Final before credit hold",
      channels: ["whatsapp", "call_task"],
      enabled: false,
      template: "Muraho {customer}, RWF {amount} is now {days_overdue} days overdue since {oldest_invoice_date} and your account is on hold for new credit. Please call us today so we can agree a payment plan.",
    },
  ],
};

export const CONTACT_LOG: ContactLogEntry[] = [
  { id: "log-1", customerId: "cust-habimana", channel: "whatsapp", step: "step-3", sentAt: daysAgoIso(2), delivered: true, read: true, note: null, loggedBy: "System" },
  { id: "log-2", customerId: "cust-uwase", channel: "call", step: null, sentAt: daysAgoIso(1), delivered: null, read: null, note: "Promised to pay by Friday.", loggedBy: ALPHONSE_USER_NAME },
];

// ---------------------------------------------------------------------------
// Customer segments (saved filters — live member counts computed by the API layer)
// ---------------------------------------------------------------------------

export const SEGMENTS: CustomerSegment[] = [
  { id: "seg-overdue", name: "Overdue accounts", filterSpec: { status: "overdue" }, memberCount: 0 },
  { id: "seg-near-limit", name: "Near credit limit (75%+)", filterSpec: { minUsagePercent: 75 }, memberCount: 0 },
  { id: "seg-all", name: "All customers", filterSpec: {}, memberCount: 0 },
];

// ---------------------------------------------------------------------------
// Cash Box — money locations, movements, MoMo transactions
// ---------------------------------------------------------------------------

export const MONEY_LOCATIONS: MoneyLocation[] = [
  { id: "loc-money-till", accountKey: "till", displayName: "TILL", kind: "till", balanceMinor: rwf(340_500), todaysMovementMinor: rwf(45_000), connectionStatus: "manual", lastSyncedAt: null },
  { id: "loc-money-momo", accountKey: "momo", displayName: "MOMO (MTN — 0788 000 142)", kind: "momo", balanceMinor: rwf(1_240_000), todaysMovementMinor: rwf(180_000), connectionStatus: "connected", lastSyncedAt: new Date(Date.now() - 4 * 60_000).toISOString() },
  { id: "loc-money-bank", accountKey: "bank", displayName: "BANK (BK ••4192)", kind: "bank", balanceMinor: rwf(3_800_000), todaysMovementMinor: rwf(0), connectionStatus: "manual", lastSyncedAt: null },
];

export const MONEY_MOVEMENTS: MoneyMovement[] = [
  { id: "mm-1", accountKey: "till", accountDisplayName: "TILL", type: "sale", amountMinor: rwf(45_000), balanceAfterMinor: rwf(340_500), userId: CURRENT_USER_ID, userName: CURRENT_USER_NAME, reference: "Sale #00187", timestamp: daysAgoIso(0) },
  { id: "mm-2", accountKey: "momo", accountDisplayName: "MOMO (MTN — 0788 000 142)", type: "payment_received", amountMinor: rwf(180_000), balanceAfterMinor: rwf(1_240_000), userId: CURRENT_USER_ID, userName: CURRENT_USER_NAME, reference: "Payment from Kigali Builders Ltd", timestamp: daysAgoIso(0) },
  { id: "mm-3", accountKey: "till", accountDisplayName: "TILL", type: "expense", amountMinor: rwf(-12_000), balanceAfterMinor: rwf(295_500), userId: ALPHONSE_USER_ID, userName: ALPHONSE_USER_NAME, reference: "Moto transport — supplier pickup", timestamp: daysAgoIso(1) },
  { id: "mm-4", accountKey: "bank", accountDisplayName: "BANK (BK ••4192)", type: "transfer", amountMinor: rwf(500_000), balanceAfterMinor: rwf(3_800_000), userId: CURRENT_USER_ID, userName: CURRENT_USER_NAME, reference: "Till to bank deposit", timestamp: daysAgoIso(1) },
  { id: "mm-5", accountKey: "till", accountDisplayName: "TILL", type: "transfer", amountMinor: rwf(-500_000), balanceAfterMinor: rwf(307_500), userId: CURRENT_USER_ID, userName: CURRENT_USER_NAME, reference: "Till to bank deposit", timestamp: daysAgoIso(1) },
  { id: "mm-6", accountKey: "momo", accountDisplayName: "MOMO (MTN — 0788 000 142)", type: "expense", amountMinor: rwf(-28_000), balanceAfterMinor: rwf(1_060_000), userId: ALPHONSE_USER_ID, userName: ALPHONSE_USER_NAME, reference: "Internet bill", timestamp: daysAgoIso(2) },
  { id: "mm-7", accountKey: "till", accountDisplayName: "TILL", type: "manual_adjustment", amountMinor: rwf(-5_000), balanceAfterMinor: rwf(302_500), userId: CURRENT_USER_ID, userName: CURRENT_USER_NAME, reference: "Miscount correction after close", timestamp: daysAgoIso(3) },
];

export const MOMO_TRANSACTIONS: MomoTransaction[] = [
  { id: "momo-1", provider: "mtn", externalId: "8814QK", phone: "+250788111222", amountMinor: rwf(300_000), direction: "in", occurredAt: daysAgoIso(30), status: "matched", matchedCustomerId: "cust-kigali-builders", matchedCustomerName: "Kigali Builders Ltd", matchConfidence: "high" },
  { id: "momo-2", provider: "mtn", externalId: "9921LM", phone: "+250788555666", amountMinor: rwf(120_000), direction: "in", occurredAt: daysAgoIso(5), status: "matched", matchedCustomerId: "cust-umutoni", matchedCustomerName: "Divine Umutoni Hardware Supplies", matchConfidence: "medium" },
  { id: "momo-3", provider: "mtn", externalId: "7742PX", phone: "+250788882233", amountMinor: rwf(340_000), direction: "in", occurredAt: daysAgoIso(2), status: "matched", matchedCustomerId: "cust-gasana", matchedCustomerName: "Emmanuel Gasana", matchConfidence: "high" },
  { id: "momo-4", provider: "mtn", externalId: "3305RT", phone: "+250788771122", amountMinor: rwf(45_000), direction: "in", occurredAt: daysAgoIso(1), status: "unmatched", matchedCustomerId: null, matchedCustomerName: null, matchConfidence: null },
  { id: "momo-5", provider: "airtel", externalId: "AT-6610", phone: "+250738220091", amountMinor: rwf(120_000), direction: "in", occurredAt: daysAgoIso(1), status: "unmatched", matchedCustomerId: null, matchedCustomerName: null, matchConfidence: null },
  { id: "momo-6", provider: "mtn", externalId: "5588VN", phone: "+250788993344", amountMinor: rwf(75_000), direction: "in", occurredAt: daysAgoIso(0), status: "unmatched", matchedCustomerId: null, matchedCustomerName: null, matchConfidence: null },
  { id: "momo-7", provider: "mtn", externalId: "1123WQ", phone: "+250788006677", amountMinor: rwf(200_000), direction: "in", occurredAt: daysAgoIso(0), status: "unmatched", matchedCustomerId: null, matchedCustomerName: null, matchConfidence: null },
  { id: "momo-8", provider: "mtn", externalId: "4471YZ", phone: "+250788009900", amountMinor: rwf(15_500), direction: "in", occurredAt: daysAgoIso(0), status: "unmatched", matchedCustomerId: null, matchedCustomerName: null, matchConfidence: null },
];

// ---------------------------------------------------------------------------
// Expenses (D.7.4) — approval-threshold gate demonstrated on both sides
// ---------------------------------------------------------------------------

export const EXPENSE_APPROVAL_THRESHOLD_MINOR = rwf(50_000);

export const EXPENSES: Expense[] = [
  { id: "exp-1", amountMinor: rwf(350_000), category: "rent", moneyLocationAccountKey: "bank", payee: "Nyabugogo Plaza Landlord", date: new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10), note: "August rent", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "pending_approval", approvedBy: null, createdBy: ALPHONSE_USER_NAME, createdAt: daysAgoIso(1) },
  { id: "exp-2", amountMinor: rwf(12_000), category: "transport", moneyLocationAccountKey: "till", payee: "Moto rider — supplier pickup", date: new Date().toISOString().slice(0, 10), note: "", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "posted", approvedBy: null, createdBy: ALPHONSE_USER_NAME, createdAt: daysAgoIso(1) },
  { id: "exp-3", amountMinor: rwf(28_000), category: "utilities", moneyLocationAccountKey: "momo", payee: "MTN Internet", date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10), note: "Monthly data bundle", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "posted", approvedBy: null, createdBy: CURRENT_USER_NAME, createdAt: daysAgoIso(2) },
  { id: "exp-4", amountMinor: rwf(95_000), category: "maintenance", moneyLocationAccountKey: "till", payee: "Roofing repair — storage room", date: new Date().toISOString().slice(0, 10), note: "Leak after last week's rain", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "pending_approval", approvedBy: null, createdBy: ALPHONSE_USER_NAME, createdAt: daysAgoIso(0) },
  { id: "exp-5", amountMinor: rwf(8_000), category: "supplies", moneyLocationAccountKey: "till", payee: "Stationery", date: new Date().toISOString().slice(0, 10), note: "", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "posted", approvedBy: null, createdBy: CURRENT_USER_NAME, createdAt: daysAgoIso(0) },
  { id: "exp-6", amountMinor: rwf(450_000), category: "salaries", moneyLocationAccountKey: "bank", payee: "Casual labour — stock unloading", date: daysAgoIso(6).slice(0, 10), note: "Rejected: needs owner sign-off first, per shop policy", receiptPhotoUrl: null, ocrStatus: "not_attempted", status: "rejected", approvedBy: CURRENT_USER_NAME, createdBy: ALPHONSE_USER_NAME, createdAt: daysAgoIso(6) },
];

export const RECURRING_EXPENSES: RecurringExpense[] = [
  {
    id: "rec-1",
    template: { amountMinor: rwf(350_000), category: "rent", moneyLocationAccountKey: "bank", payee: "Nyabugogo Plaza Landlord", date: "", note: "Monthly rent" },
    interval: "monthly",
    nextRunDate: new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10),
    active: true,
  },
  {
    id: "rec-2",
    template: { amountMinor: rwf(28_000), category: "utilities", moneyLocationAccountKey: "momo", payee: "MTN Internet", date: "", note: "Monthly data bundle" },
    interval: "monthly",
    nextRunDate: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10),
    active: true,
  },
];
