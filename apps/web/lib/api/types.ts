import type { MinorUnits } from "@operatoros/shared";

/**
 * Phase 1 API contract types — the frontend's typed layer over the backend
 * documented in docs/plans/phase-1.md §3. apps/api is being built in
 * parallel in a different worktree on the same target branch; these
 * interfaces are what this app codes against until the real OpenAPI spec
 * lands (see packages/shared/src/index.ts's note on Zod-from-OpenAPI being
 * a placeholder). Money is always `MinorUnits` (integer minor units, never
 * a float — spec E.5). Quantities are decimal strings end to end, per the
 * backend contract, to avoid float drift on fractional units (e.g. 12.5kg
 * of rebar cut to length) — see lib/decimal.ts for the arithmetic helpers
 * that operate on them.
 */

export type QtyString = string;
export type Iso8601 = string;

export type PaymentMethod = "cash" | "momo" | "airtel" | "bank" | "card" | "cheque" | "credit";

export type ReceiptChannel = "print" | "whatsapp" | "sms" | "none";

// ---------------------------------------------------------------------------
// Catalog: categories, units, products
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
}

export interface Unit {
  id: string;
  name: string;
  /** How many base units one of this unit equals, e.g. "box" -> 12 "piece". */
  factorToBase: number;
  isBase: boolean;
}

export interface ProductLocationStock {
  locationId: string;
  locationName: string;
  onHand: QtyString;
  reserved: QtyString;
}

export interface UnitConversion {
  unitId: string;
  unitName: string;
  /** How many base units (product.unitId) one of `unitId` equals. */
  factorToBase: number;
}

export interface Product {
  id: string;
  name: string;
  aliases: string[];
  sku: string;
  barcode: string | null;
  categoryId: string;
  categoryName: string;
  unitId: string;
  unitName: string;
  /** Every unit this product can be sold in at the Counter, base unit included at factor 1. */
  unitConversions: UnitConversion[];
  costMinor: MinorUnits;
  priceMinor: MinorUnits;
  wholesalePriceMinor: MinorUnits | null;
  minSellPriceMinor: MinorUnits | null;
  taxClass: "standard" | "zero" | "exempt";
  imageUrl: string | null;
  notes: string;
  reorderPoint: QtyString;
  reorderQty: QtyString;
  locations: ProductLocationStock[];
  /** Sum of `locations[].onHand` — convenience for the Counter's single-location default. */
  onHand: QtyString;
  archived: boolean;
}

export interface ProductFilters {
  search?: string | undefined;
  categoryId?: string | undefined;
  quickFilter?: "low-stock" | "out-of-stock" | "negative-stock" | "expiring-30d" | "no-movement-90d" | "below-cost" | undefined;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  barcode?: string;
  categoryId: string;
  unitId: string;
  costMinor: MinorUnits;
  priceMinor: MinorUnits;
  openingQty?: QtyString;
}

export interface ImportRow {
  rowNumber: number;
  name: string;
  sku: string;
  unit: string;
  costMinor: MinorUnits;
  priceMinor: MinorUnits;
  openingQty: QtyString;
  errors: string[];
  isDuplicate: boolean;
}

export interface ImportPreview {
  rows: ImportRow[];
  validCount: number;
  errorCount: number;
  duplicateCount: number;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  phone: string;
  creditLimitMinor: MinorUnits;
  balanceMinor: MinorUnits;
  termsDays: number;
  onHold: boolean;
  /** Business/site name distinct from the contact's own name (e.g. "Jean Bosco Habimana" / "Habimana Construction") — Phase 2, per design-reference/debt-book-stock-room.dc.html's `trade` field. Optional: not every customer is a business. */
  trade?: string | undefined;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  creditLimitMinor?: MinorUnits;
  termsDays?: number;
}

// ---------------------------------------------------------------------------
// Day / till sessions (D.3 / D.7.5 / D.11)
// ---------------------------------------------------------------------------

export type VarianceReason =
  | "miscount_at_close"
  | "cash_taken_overnight"
  | "float_added"
  | "theft_suspected"
  | "other";

export interface DenominationCount {
  value: number; // e.g. 5000, 2000, 1000, 500, 100, 50 (RWF major units)
  isCoin: boolean;
  count: number;
}

export interface DaySession {
  id: string;
  businessDate: string; // YYYY-MM-DD
  locationId: string;
  status: "open" | "closed";
  openedAt: Iso8601 | null;
  openedBy: string | null;
  closedAt: Iso8601 | null;
  closedBy: string | null;
  countedMinor: MinorUnits | null;
  expectedMinor: MinorUnits | null;
  varianceMinor: MinorUnits | null;
  reason: VarianceReason | null;
  reasonNote: string | null;
}

export interface OpenDayInput {
  countedMinor: MinorUnits;
  denominations?: DenominationCount[] | undefined;
  reason?: VarianceReason | undefined;
  reasonNote?: string | undefined;
}

export interface TillSession {
  id: string;
  daySessionId: string;
  cashierId: string;
  cashierName: string;
  status: "open" | "closed";
  openedAt: Iso8601;
  openingFloatMinor: MinorUnits;
  closedAt: Iso8601 | null;
  expectedMinor: MinorUnits | null;
  countedMinor: MinorUnits | null;
  varianceMinor: MinorUnits | null;
  reason: VarianceReason | null;
  reasonNote: string | null;
}

export interface OpenTillInput {
  openingFloatMinor: MinorUnits;
  denominations?: DenominationCount[];
}

export interface CloseTillInput {
  countedMinor: MinorUnits;
  denominations?: DenominationCount[] | undefined;
  reason?: VarianceReason | undefined;
  reasonNote?: string | undefined;
}

export interface DayCloseChecklist {
  parkedSales: number;
  unsentQuotes: number;
  unreconciledMomo: number;
  unpostedStocktakes: number;
}

export interface DaySummary {
  takenMinor: MinorUnits;
  byMethod: { method: PaymentMethod; amountMinor: MinorUnits }[];
  onCreditMinor: MinorUnits;
  expensesMinor: MinorUnits;
  netMinor: MinorUnits;
  transactionCount: number;
  busiestHour: number | null;
  topProductName: string | null;
  shrinkageMinor: MinorUnits | null;
}

// ---------------------------------------------------------------------------
// Sales, basket, payments (D.4)
// ---------------------------------------------------------------------------

export interface BasketLineInput {
  productId: string;
  name: string;
  qty: QtyString;
  unitId: string;
  unitPriceMinor: MinorUnits;
  lineDiscountMinor: MinorUnits;
  note?: string;
}

export interface PaymentLineInput {
  method: PaymentMethod;
  amountMinor: MinorUnits;
  cashGivenMinor?: MinorUnits;
  phone?: string;
  transactionRef?: string;
  dueDate?: string;
  managerPinOverride?: string;
  overrideReason?: string;
}

export interface RecordSaleInput {
  lines: BasketLineInput[];
  customerId: string | null;
  discountMinor: MinorUnits;
  discountManagerPin?: string;
  payments: PaymentLineInput[];
  receiptChannel: ReceiptChannel;
}

export interface SaleLine {
  productId: string;
  name: string;
  qty: QtyString;
  unitId: string;
  unitName: string;
  unitPriceMinor: MinorUnits;
  lineDiscountMinor: MinorUnits;
  lineTotalMinor: MinorUnits;
}

export interface SalePayment {
  method: PaymentMethod;
  amountMinor: MinorUnits;
  cashGivenMinor: MinorUnits | null;
  changeDueMinor: MinorUnits | null;
  transactionRef: string | null;
}

export interface Sale {
  id: string;
  receiptNumber: string;
  createdAt: Iso8601;
  createdBy: string;
  customerId: string | null;
  customerName: string | null;
  lines: SaleLine[];
  payments: SalePayment[];
  subtotalMinor: MinorUnits;
  discountMinor: MinorUnits;
  vatMinor: MinorUnits;
  totalMinor: MinorUnits;
  changeDueMinor: MinorUnits;
  status: "completed" | "reversed";
}

export interface CreditLimitCheck {
  allowed: boolean;
  currentBalanceMinor: MinorUnits;
  creditLimitMinor: MinorUnits;
  newBalanceMinor: MinorUnits;
}

export interface ParkedSale {
  id: string;
  label: string;
  lines: BasketLineInput[];
  customerId: string | null;
  parkedAt: Iso8601;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  lines: BasketLineInput[];
  customerId: string | null;
  customerName: string | null;
  totalMinor: MinorUnits;
  issuedAt: Iso8601;
  expiresAt: Iso8601;
  status: "open" | "accepted" | "expired" | "converted";
}

export interface ReturnLineInput {
  productId: string;
  qty: QtyString;
  restock: boolean;
}

export interface RecordReturnInput {
  saleId: string;
  lines: ReturnLineInput[];
  refundMethod: PaymentMethod;
  reason: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Stock (D.5)
// ---------------------------------------------------------------------------

export type StockMovementType =
  | "sale"
  | "purchase_receipt"
  | "return"
  | "adjustment"
  | "transfer"
  | "write_off"
  | "stocktake_correction";

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  qtyDelta: QtyString;
  balanceAfter: QtyString;
  fromLocationId: string | null;
  toLocationId: string | null;
  userId: string;
  userName: string;
  reference: string | null;
  timestamp: Iso8601;
}

export interface StockMovementFilters {
  productId?: string | undefined;
  type?: StockMovementType | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface AdjustStockInput {
  productId: string;
  qtyDelta: QtyString;
  reason: string;
}

export type StocktakeScope = "all" | { categoryId: string } | { locationId: string };

export interface StocktakeLine {
  productId: string;
  productName: string;
  expectedQty: QtyString;
  countedQty: QtyString | null;
  countedBy: string | null;
  countedAt: Iso8601 | null;
  varianceQty: QtyString | null;
  varianceValueMinor: MinorUnits | null;
  reason: string | null;
}

export interface Stocktake {
  id: string;
  status: "counting" | "review" | "posted";
  scopeLabel: string;
  freezeItems: boolean;
  startedAt: Iso8601;
  postedAt: Iso8601 | null;
  lines: StocktakeLine[];
}

export interface StartStocktakeInput {
  scope: StocktakeScope;
  freezeItems: boolean;
}

export interface TransferLine {
  productId: string;
  productName: string;
  qty: QtyString;
  receivedQty: QtyString | null;
}

export interface StockTransfer {
  id: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  status: "in_transit" | "received" | "discrepancy";
  lines: TransferLine[];
  createdAt: Iso8601;
  receivedAt: Iso8601 | null;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface Receipt {
  saleId: string;
  receiptNumber: string;
  pdfUrl: string;
  sentChannel: ReceiptChannel;
}

// ---------------------------------------------------------------------------
// Overview (D.10.1)
// ---------------------------------------------------------------------------

export interface OverviewToday {
  takenMinor: MinorUnits;
  onCreditMinor: MinorUnits;
  expensesMinor: MinorUnits;
  netMinor: MinorUnits;
  vsWeekdayAverageMinor: MinorUnits;
}

export interface OverviewNeedsYouItem {
  label: string;
  count: number;
  href: string;
  severity: "out" | "watch";
}

export interface OverviewMoneyPosition {
  tillMinor: MinorUnits;
  momoMinor: MinorUnits;
  bankMinor: MinorUnits;
  owedToYouMinor: MinorUnits;
  owedByYouMinor: MinorUnits;
  workingCapitalMinor: MinorUnits;
}

export interface OverviewThisMonth {
  revenueMinor: MinorUnits;
  grossProfitMinor: MinorUnits;
  expensesMinor: MinorUnits;
  netProfitMinor: MinorUnits;
  lastMonthNetProfitMinor: MinorUnits;
  sparkline: number[];
}

export interface OverviewProductRow {
  productId: string;
  name: string;
  valueMinor: MinorUnits;
}

export interface OverviewTopBottom {
  bestSelling: OverviewProductRow[];
  bestMargin: OverviewProductRow[];
  dead: OverviewProductRow[];
}

export interface Overview {
  today: OverviewToday;
  needsYouToday: OverviewNeedsYouItem[];
  moneyPosition: OverviewMoneyPosition;
  thisMonth: OverviewThisMonth;
  topAndBottom: OverviewTopBottom;
  businessHistoryDays: number;
}

// ---------------------------------------------------------------------------
// Onboarding (D.2)
// ---------------------------------------------------------------------------

export type BusinessType =
  | "retail_shop"
  | "hardware_store"
  | "wholesaler"
  | "pharmacy"
  | "agro_dealer"
  | "auto_parts"
  | "building_supplies"
  | "other";

export interface OnboardingBusiness {
  tradingName: string;
  legalName: string;
  businessType: BusinessType;
  tin: string;
  address: string;
  phone: string;
  currency: "RWF";
  financialYearStart: string; // MM-DD
}

export interface OnboardingPaymentMethods {
  cash: boolean;
  momo: { enabled: boolean; merchantCode: string; connected: boolean };
  airtel: { enabled: boolean; merchantCode: string; connected: boolean };
  bank: boolean;
  card: boolean;
  cheque: boolean;
  credit: boolean;
}

export interface OnboardingStaffInvite {
  name: string;
  phone: string;
  role: "owner" | "manager" | "cashier" | "stock_clerk";
}

export interface OnboardingOpeningDebtor {
  customerName: string;
  phone: string;
  amountOwedMinor: MinorUnits;
  since: string;
}

export interface OnboardingOpeningBalances {
  tillCashMinor: MinorUnits;
  bankCashMinor: MinorUnits;
  debtors: OnboardingOpeningDebtor[];
  payables: { supplierName: string; amountOwedMinor: MinorUnits }[];
}

export interface OnboardingState {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  business: Partial<OnboardingBusiness>;
  paymentMethods: Partial<OnboardingPaymentMethods>;
  stockPath: "upload" | "type_in" | "start_empty" | null;
  productsAdded: number;
  staff: OnboardingStaffInvite[];
  openingBalances: Partial<OnboardingOpeningBalances>;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Phase 2 — Debt Book (D.6)
//
// Per docs/DECISIONS.md "Phase 2: invoices modeled as credit-bearing sales":
// there is no separate Invoice entity server-side — a credit-bearing Sale
// *is* the invoice. The frontend's `Invoice` shape below is the read model
// the Debt Book screens consume (whether it's later served by a real
// `/api/v1/debt/*` endpoint reading `sales` + `payment_allocations`, or by
// the mock store standing in for that today) — never treated as a second
// source of truth to write to directly.
// ---------------------------------------------------------------------------

export type InvoiceStatus = "open" | "overdue" | "paid";

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. "INV-2977" — the underlying sale's receipt number, credit-book-formatted
  customerId: string;
  saleId: string;
  issuedAt: Iso8601;
  /** Snapshotted at sale time (occurred_at + customer.termsDays at that moment) — never recomputed from the customer's current terms. */
  dueDateAt: Iso8601;
  totalMinor: MinorUnits;
  /** totalMinor - sum(payment_allocations for this invoice). */
  remainingMinor: MinorUnits;
  status: InvoiceStatus;
}

export type StatementEntryKind = "invoice" | "payment" | "write_off";

export interface StatementEntry {
  id: string;
  customerId: string;
  date: Iso8601;
  kind: StatementEntryKind;
  ref: string; // "INV-2841" or "PAY-1190"
  detail: string;
  debitMinor: MinorUnits; // taken on credit (0 for payment rows)
  creditMinor: MinorUnits; // paid / written off (0 for invoice rows)
  runningBalanceMinor: MinorUnits;
}

export interface AllocationInput {
  invoiceId: string;
  amountMinor: MinorUnits;
}

export interface TakePaymentInput {
  customerId: string;
  amountMinor: MinorUnits;
  method: PaymentMethod;
  /** Present only when method needs one (momo/airtel/bank/cheque transaction ref). */
  transactionRef?: string | undefined;
  moneyLocationAccountKey: string;
  allocationMode: "auto" | "manual";
  /** Required when allocationMode is "manual"; ignored (server computes) when "auto". */
  manualAllocations?: AllocationInput[] | undefined;
  /** Back-dating the payment date away from "now" — permission-gated (D.6.4), requires a reason when used. */
  backdatedTo?: Iso8601 | undefined;
  backdateReason?: string | undefined;
}

export interface TakePaymentResult {
  paymentId: string;
  allocations: AllocationInput[];
  unallocatedMinor: MinorUnits;
  customer: Customer;
}

export interface WriteOffInput {
  customerId: string;
  amountMinor: MinorUnits;
  reason: string;
  /** Required (typed exact customer name) above a configurable threshold — enforced client-side via ConfirmDialog's `typedConfirmation`, re-validated by the real backend. */
  typedConfirmationName?: string | undefined;
}

export interface DebtAccountSummary {
  customer: Customer;
  oldestDueDateAt: string | null;
  oldestDaysOverdue: number | null;
  status: "current" | "due_this_week" | "overdue" | "over_limit";
  /** True if this account has had any amount written off — the customer stays visible in the Debt Book, chip-marked, per D.6's write-off flow requirement (plan §5: "appears as a loss with the customer still visible and chip-marked"). */
  hasWriteOff: boolean;
}

export interface DebtBookHeader {
  owedToYouMinor: MinorUnits;
  owedToYouAccountCount: number;
  overdueMinor: MinorUnits;
  overdueAccountCount: number;
  overdueOldestDays: number;
  dueThisWeekMinor: MinorUnits;
  dueThisWeekInvoiceCount: number;
  collectedThisMonthMinor: MinorUnits;
  collectedThisMonthPercentOfCredit: number;
  ageing: Record<"current" | "1-30" | "31-60" | "61-90" | "90+", MinorUnits>;
}

export type ChaseAction = "call" | "reminder_sent" | "snoozed";

export interface ChaseQueueItem {
  customer: Customer;
  balanceMinor: MinorUnits;
  daysOverdue: number;
  nextReminderStep: string | null;
  lastContactAt: Iso8601 | null;
  snoozedUntil: Iso8601 | null;
}

export type ReminderChannel = "whatsapp" | "sms" | "call_task";

export interface ReminderScheduleStep {
  id: string;
  order: number;
  /** Negative = days before due date, positive = days after. */
  offsetDays: number;
  tone: string; // short human label, e.g. "Friendly nudge", "Final before credit hold"
  channels: ReminderChannel[];
  template: string;
  enabled: boolean;
}

export interface ReminderSchedule {
  id: string;
  businessId: string;
  steps: ReminderScheduleStep[];
  /** Approval mode: reminders are queued into a daily digest and require an explicit "Send N reminders" click rather than sending automatically. */
  approvalMode: boolean;
  paused: boolean;
  quietHoursStart: string; // "HH:MM"
  quietHoursEnd: string;
  maxPerCustomerPerWeek: number;
}

export interface ReminderDigestItem {
  id: string;
  customer: Customer;
  step: ReminderScheduleStep;
  renderedMessage: string;
  checked: boolean;
}

export type ContactLogChannel = "whatsapp" | "sms" | "call" | "manual_note";

export interface ContactLogEntry {
  id: string;
  customerId: string;
  channel: ContactLogChannel;
  step: string | null;
  sentAt: Iso8601;
  delivered: boolean | null;
  read: boolean | null;
  note: string | null;
  loggedBy: string;
}

export interface CustomerSegmentFilterSpec {
  minBalanceMinor?: MinorUnits;
  maxBalanceMinor?: MinorUnits;
  status?: DebtAccountSummary["status"];
  onHold?: boolean;
  /** Credit-limit usage percent (balance/limit × 100) at or above this value — "near credit limit" style segments. */
  minUsagePercent?: number;
}

export interface CustomerSegment {
  id: string;
  name: string;
  filterSpec: CustomerSegmentFilterSpec;
  /** Computed live against the current customer list — never materialised/stale, per docs/plans/phase-2.md §0.7. */
  memberCount: number;
}

export interface BroadcastSend {
  id: string;
  segmentId: string | null;
  segmentName: string;
  message: string;
  sentAt: Iso8601;
  sentBy: string;
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
}

// ---------------------------------------------------------------------------
// Phase 2 — Cash Box (D.7.1–D.7.5)
// ---------------------------------------------------------------------------

export type MoneyLocationKind = "till" | "momo" | "airtel" | "bank" | "card";

export interface MoneyLocation {
  id: string;
  accountKey: string; // matches money_location_balance's account_key (e.g. "till", "momo", "bank")
  displayName: string; // "BANK (BK ••4192)"
  kind: MoneyLocationKind;
  balanceMinor: MinorUnits;
  todaysMovementMinor: MinorUnits;
  connectionStatus: "manual" | "connected";
  lastSyncedAt: Iso8601 | null;
}

export interface UpdateBalanceInput {
  accountKey: string;
  countedMinor: MinorUnits;
  reason?: string | undefined;
}

export type MoneyMovementType = "sale" | "payment_received" | "expense" | "transfer" | "manual_adjustment";

export interface MoneyMovement {
  id: string;
  accountKey: string;
  accountDisplayName: string;
  type: MoneyMovementType;
  amountMinor: MinorUnits; // signed
  balanceAfterMinor: MinorUnits;
  userId: string;
  userName: string;
  reference: string | null;
  timestamp: Iso8601;
}

export interface MoneyMovementFilters {
  accountKey?: string | undefined;
  type?: MoneyMovementType | undefined;
  from?: string | undefined;
  to?: string | undefined;
  userId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Phase 2 — Mobile money (D.7.3, per docs/DECISIONS.md's sandbox-provider seam)
// ---------------------------------------------------------------------------

export type MomoDirection = "in" | "out";
export type MomoTransactionStatus = "unmatched" | "matched" | "ignored";

export interface MomoTransaction {
  id: string;
  provider: "mtn" | "airtel";
  externalId: string;
  phone: string;
  amountMinor: MinorUnits;
  direction: MomoDirection;
  occurredAt: Iso8601;
  status: MomoTransactionStatus;
  /** Set once matched — which customer/sale/expense this transaction was reconciled against. */
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
}

export interface MomoReconciliationSummary {
  unmatchedTotalMinor: MinorUnits;
  unmatchedCount: number;
  transactions: MomoTransaction[];
}

export interface MatchMomoTransactionInput {
  momoTransactionId: string;
  customerId: string;
}

export interface RequestMomoPaymentInput {
  customerId: string;
  amountMinor: MinorUnits;
  phone: string;
}

export interface MomoProviderConnection {
  provider: "mtn" | "airtel";
  status: "connected" | "not_connected";
  merchantCode: string | null;
}

// ---------------------------------------------------------------------------
// Phase 2 — Expenses (D.7.4)
// ---------------------------------------------------------------------------

export type ExpenseStatus = "draft" | "pending_approval" | "approved" | "rejected" | "posted";
export type ExpenseCategory = "rent" | "utilities" | "transport" | "supplies" | "salaries" | "maintenance" | "other";

export interface Expense {
  id: string;
  amountMinor: MinorUnits;
  category: ExpenseCategory;
  moneyLocationAccountKey: string;
  payee: string;
  date: string; // YYYY-MM-DD
  note: string;
  receiptPhotoUrl: string | null;
  ocrStatus: "not_attempted";
  status: ExpenseStatus;
  approvedBy: string | null;
  createdBy: string;
  createdAt: Iso8601;
}

export interface RecordExpenseInput {
  amountMinor: MinorUnits;
  category: ExpenseCategory;
  moneyLocationAccountKey: string;
  payee: string;
  date: string;
  note?: string;
  receiptPhotoUrl?: string | null;
}

export interface RecurringExpense {
  id: string;
  template: RecordExpenseInput;
  interval: "weekly" | "monthly";
  nextRunDate: string; // YYYY-MM-DD
  active: boolean;
}

export interface ApprovalThreshold {
  amountMinor: MinorUnits;
}

// ---------------------------------------------------------------------------
// Phase 2 — Pay link (public, unauthenticated, per docs/DECISIONS.md §0.5)
// ---------------------------------------------------------------------------

export type PayLinkStatus = "pending" | "paid" | "expired" | "invalid";

export interface PayLinkDetails {
  status: PayLinkStatus;
  businessName: string;
  customerName: string;
  amountMinor: MinorUnits;
  invoiceRef: string | null;
  expiresAt: Iso8601 | null;
}

export interface SubmitPayLinkInput {
  token: string;
  method: "momo" | "airtel";
  phone: string;
}

export interface SubmitPayLinkResult {
  status: "pending_confirmation" | "paid";
}
