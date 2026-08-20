import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { addQty, isPositiveQty, mulQty, qtyToNumber, subQty } from "../decimal";
import { accountStatus, autoAllocate, bucketTotals, daysOverdue, validateManualAllocation, type AllocatableInvoice } from "../debt-math";
import { renderTemplate } from "../template-merge";
import type {
  AllocationInput,
  BroadcastSend,
  ChaseQueueItem,
  ContactLogEntry,
  Customer,
  CustomerSegment,
  CustomerSegmentFilterSpec,
  DayCloseChecklist,
  DaySession,
  DaySummary,
  DebtAccountSummary,
  DebtBookHeader,
  Expense,
  Invoice,
  MatchMomoTransactionInput,
  MomoProviderConnection,
  MomoTransaction,
  MoneyLocation,
  MoneyMovement,
  MoneyMovementFilters,
  MoneyMovementType,
  ParkedSale,
  PayLinkDetails,
  PayLinkStatus,
  Product,
  Quote,
  Receipt,
  ReceiptChannel,
  RecordExpenseInput,
  RecordReturnInput,
  RecordSaleInput,
  RecurringExpense,
  ReminderDigestItem,
  ReminderSchedule,
  Sale,
  SaleLine,
  SalePayment,
  StatementEntry,
  StockMovement,
  StockMovementType,
  StockTransfer,
  Stocktake,
  StocktakeScope,
  TakePaymentInput,
  TakePaymentResult,
  TillSession,
  VarianceReason,
  WriteOffInput,
} from "../api/types";
import { CATEGORIES, CURRENT_USER_ID, CURRENT_USER_NAME, CUSTOMERS, LOCATION_ID, LOCATION_NAME, PRODUCTS, UNITS, rwf } from "./seed";
import {
  CONTACT_LOG,
  EXPENSE_APPROVAL_THRESHOLD_MINOR,
  EXPENSES,
  INVOICES,
  MOMO_TRANSACTIONS,
  MONEY_LOCATIONS,
  MONEY_MOVEMENTS,
  RECURRING_EXPENSES,
  REMINDER_SCHEDULE,
  SEGMENTS,
  STATEMENTS,
} from "./seed-phase2";

export { EXPENSE_APPROVAL_THRESHOLD_MINOR };

// ---------------------------------------------------------------------------
// Phase 2 — small Customer-entity mutations the Debt Book's row actions need
// (put on hold, adjust credit limit) — live here alongside the rest of
// Phase 1's direct customer CRUD in this file, not in the debt-specific
// section below, since `Customer` itself is still a Phase 1 entity.
// ---------------------------------------------------------------------------

export function setCustomerHold(customerId: string, onHold: boolean): Customer {
  const customer = db.customers.find((c) => c.id === customerId);
  if (!customer) throw new Error(`Mock: customer ${customerId} not found`);
  customer.onHold = onHold;
  return customer;
}

export function setCustomerCreditLimit(customerId: string, creditLimitMinor: MinorUnits): Customer {
  const customer = db.customers.find((c) => c.id === customerId);
  if (!customer) throw new Error(`Mock: customer ${customerId} not found`);
  customer.creditLimitMinor = creditLimitMinor;
  return customer;
}

/**
 * In-memory mutable "ledger" the mock adapter reads and writes. This is the
 * one place that simulates what apps/api's projections will do for real:
 * a sale decrements stock and bumps customer balance in the same call,
 * a day close needs the day to have been open, etc. Every mutation also
 * appends a StockMovement / event-shaped record so the Stock Room's
 * movements ledger and stock card are genuinely explainable, matching the
 * append-only spirit of spec Part E even though this is throwaway state.
 */
/** Internal storage shape for a pay link — `PayLinkDetails` (lib/api/types.ts) is the public read model derived from this. */
interface PayLinkRecord {
  token: string;
  businessName: string;
  customerId: string;
  amountMinor: MinorUnits;
  invoiceRef: string | null;
  status: PayLinkStatus;
  expiresAt: string;
}

interface MockDb {
  products: Product[];
  customers: Customer[];
  daySession: DaySession | null;
  tillSessions: TillSession[];
  sales: Sale[];
  parkedSales: ParkedSale[];
  quotes: Quote[];
  stockMovements: StockMovement[];
  stocktakes: Stocktake[];
  transfers: StockTransfer[];
  receiptSeq: number;
  quoteSeq: number;
  // Phase 2 — Debt Book
  invoices: Invoice[];
  statements: StatementEntry[];
  reminderSchedule: ReminderSchedule;
  contactLog: ContactLogEntry[];
  segments: CustomerSegment[];
  broadcastSends: BroadcastSend[];
  snoozedUntil: Record<string, string>; // customerId -> ISO date, for the chase queue
  writeOffs: { customerId: string; amountMinor: MinorUnits; reason: string; at: string }[];
  paymentSeq: number;
  // Phase 2 — Cash Box
  moneyLocations: MoneyLocation[];
  moneyMovements: MoneyMovement[];
  momoTransactions: MomoTransaction[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  payLinks: PayLinkRecord[];
  expenseApprovalThresholdMinor: MinorUnits;
  momoConnection: MomoProviderConnection;
}

function freshDb(): MockDb {
  return {
    products: PRODUCTS.map((p) => ({ ...p, locations: p.locations.map((l) => ({ ...l })) })),
    customers: CUSTOMERS.map((c) => ({ ...c })),
    daySession: null,
    tillSessions: [],
    sales: [],
    parkedSales: [],
    quotes: [],
    stockMovements: [],
    stocktakes: [],
    transfers: [],
    receiptSeq: 183, // so the first receipt this session reads like a real running series
    quoteSeq: 40,
    invoices: INVOICES.map((i) => ({ ...i })),
    statements: STATEMENTS.map((s) => ({ ...s })),
    reminderSchedule: { ...REMINDER_SCHEDULE, steps: REMINDER_SCHEDULE.steps.map((s) => ({ ...s, channels: [...s.channels] })) },
    contactLog: CONTACT_LOG.map((c) => ({ ...c })),
    segments: SEGMENTS.map((s) => ({ ...s })),
    broadcastSends: [],
    snoozedUntil: {},
    writeOffs: [],
    paymentSeq: 1190, // continues design-reference's "PAY-1190" seed reference number
    moneyLocations: MONEY_LOCATIONS.map((m) => ({ ...m })),
    moneyMovements: MONEY_MOVEMENTS.map((m) => ({ ...m })),
    momoTransactions: MOMO_TRANSACTIONS.map((m) => ({ ...m })),
    expenses: EXPENSES.map((e) => ({ ...e })),
    recurringExpenses: RECURRING_EXPENSES.map((r) => ({ ...r, template: { ...r.template } })),
    payLinks: [
      {
        token: "demo-pay-kigali",
        businessName: "Kigali Hardware Supplies",
        customerId: "cust-kigali-builders",
        amountMinor: rwf(560_000),
        invoiceRef: "INV-2977",
        status: "pending",
        expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
      },
    ],
    expenseApprovalThresholdMinor: EXPENSE_APPROVAL_THRESHOLD_MINOR,
    momoConnection: { provider: "mtn", status: "connected", merchantCode: "774411" },
  };
}

// Module-level singleton — deliberately not persisted anywhere (localStorage,
// IndexedDB); a full page reload resets the demo, which is fine for Phase 1's
// purpose (Playwright drives one flow per test, fresh navigation each time).
let db = freshDb();

export function resetMockDb() {
  db = freshDb();
}

export function getDb(): MockDb {
  return db;
}

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const mockDelay = delay;

// ---------------------------------------------------------------------------
// Products / stock
// ---------------------------------------------------------------------------

export function findProduct(id: string): Product {
  const p = db.products.find((x) => x.id === id);
  if (!p) throw new Error(`Mock: product ${id} not found`);
  return p;
}

function recomputeOnHand(product: Product) {
  const total = product.locations.reduce((sum, l) => addQty(sum, l.onHand), "0");
  product.onHand = total;
}

export function appendStockMovement(params: {
  productId: string;
  type: StockMovementType;
  qtyDelta: string;
  locationId?: string;
  reference?: string | null;
}) {
  const product = findProduct(params.productId);
  const locationId = params.locationId ?? LOCATION_ID;
  const loc = product.locations.find((l) => l.locationId === locationId);
  if (loc) {
    loc.onHand = addQty(loc.onHand, params.qtyDelta);
  }
  recomputeOnHand(product);
  const movement: StockMovement = {
    id: `mv-${crypto.randomUUID()}`,
    productId: product.id,
    productName: product.name,
    type: params.type,
    qtyDelta: params.qtyDelta,
    balanceAfter: product.onHand,
    fromLocationId: qtyToNumber(params.qtyDelta) < 0 ? locationId : null,
    toLocationId: qtyToNumber(params.qtyDelta) > 0 ? locationId : null,
    userId: CURRENT_USER_ID,
    userName: CURRENT_USER_NAME,
    reference: params.reference ?? null,
    timestamp: new Date().toISOString(),
  };
  db.stockMovements.unshift(movement);
  return movement;
}

export function lowStockCount(): number {
  return db.products.filter((p) => !p.archived && qtyToNumber(p.onHand) <= qtyToNumber(p.reorderPoint)).length;
}

// ---------------------------------------------------------------------------
// Day / till sessions
// ---------------------------------------------------------------------------

function todayBusinessDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDaySession(): DaySession {
  if (!db.daySession) {
    db.daySession = {
      id: "day-none",
      businessDate: todayBusinessDate(),
      locationId: LOCATION_ID,
      status: "closed",
      openedAt: null,
      openedBy: null,
      closedAt: null,
      closedBy: null,
      countedMinor: null,
      expectedMinor: minorUnits(340_500 * 100),
      varianceMinor: null,
      reason: null,
      reasonNote: null,
    };
  }
  return db.daySession;
}

export function openDay(input: { countedMinor: MinorUnits; reason?: VarianceReason | undefined; reasonNote?: string | undefined }): DaySession {
  const prior = getDaySession();
  const expected = prior.expectedMinor ?? minorUnits(340_500 * 100);
  const variance = minorUnits(input.countedMinor - expected);
  db.daySession = {
    id: `day-${crypto.randomUUID()}`,
    businessDate: todayBusinessDate(),
    locationId: LOCATION_ID,
    status: "open",
    openedAt: new Date().toISOString(),
    openedBy: CURRENT_USER_NAME,
    closedAt: null,
    closedBy: null,
    countedMinor: input.countedMinor,
    expectedMinor: expected,
    varianceMinor: variance,
    reason: variance === 0 ? null : (input.reason ?? null),
    reasonNote: input.reasonNote ?? null,
  };
  return db.daySession;
}

export function closeDay(input: { countedMinor: MinorUnits; reason?: VarianceReason | undefined; reasonNote?: string | undefined }): DaySession {
  const session = getDaySession();
  const expected = expectedTillMinor();
  const variance = minorUnits(input.countedMinor - expected);
  db.daySession = {
    ...session,
    status: "closed",
    closedAt: new Date().toISOString(),
    closedBy: CURRENT_USER_NAME,
    countedMinor: input.countedMinor,
    expectedMinor: expected,
    varianceMinor: variance,
    reason: variance === 0 ? null : (input.reason ?? session.reason),
    reasonNote: input.reasonNote ?? session.reasonNote,
  };
  // Next day starts expecting today's actual close count.
  return db.daySession;
}

export function reopenDay(): DaySession {
  if (db.daySession) db.daySession.status = "open";
  return getDaySession();
}

export function dayCloseChecklist(): DayCloseChecklist {
  return {
    parkedSales: db.parkedSales.length,
    unsentQuotes: db.quotes.filter((q) => q.status === "open").length,
    unreconciledMomo: 0, // Cash Box / MoMo reconciliation is Phase 2 — genuinely zero, not faked.
    unpostedStocktakes: db.stocktakes.filter((s) => s.status !== "posted").length,
  };
}

export function daySummary(): DaySummary {
  const cashSales = todaysSales();
  const byMethodMap = new Map<string, number>();
  let creditMinor = 0;
  for (const sale of cashSales) {
    for (const payment of sale.payments) {
      byMethodMap.set(payment.method, (byMethodMap.get(payment.method) ?? 0) + payment.amountMinor);
      if (payment.method === "credit") creditMinor += payment.amountMinor;
    }
  }
  const takenMinor = cashSales.reduce((sum, s) => sum + s.totalMinor, 0);
  const productCounts = new Map<string, number>();
  for (const sale of cashSales) {
    for (const line of sale.lines) {
      productCounts.set(line.name, (productCounts.get(line.name) ?? 0) + qtyToNumber(line.qty));
    }
  }
  let topProductName: string | null = null;
  let topQty = 0;
  for (const [name, qty] of productCounts) {
    if (qty > topQty) {
      topQty = qty;
      topProductName = name;
    }
  }
  const postedTake = db.stocktakes.find((s) => s.status === "posted");
  const shrinkageMinor = postedTake
    ? minorUnits(
        postedTake.lines.reduce((sum, l) => sum + (l.varianceValueMinor && l.varianceValueMinor < 0 ? l.varianceValueMinor : 0), 0),
      )
    : null;

  return {
    takenMinor: minorUnits(takenMinor),
    byMethod: [...byMethodMap.entries()].map(([method, amountMinor]) => ({
      method: method as DaySummary["byMethod"][number]["method"],
      amountMinor: minorUnits(amountMinor),
    })),
    onCreditMinor: minorUnits(creditMinor),
    expensesMinor: minorUnits(0),
    netMinor: minorUnits(takenMinor),
    transactionCount: cashSales.length,
    busiestHour: cashSales.length ? new Date(cashSales[cashSales.length - 1]!.createdAt).getHours() : null,
    topProductName,
    shrinkageMinor,
  };
}

export function expectedTillMinor(): MinorUnits {
  const session = getDaySession();
  const opening = session.countedMinor ?? 0;
  const cashIn = todaysSales().reduce((sum, sale) => {
    const cash = sale.payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountMinor, 0);
    const changeGiven = sale.payments
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + (p.changeDueMinor ?? 0), 0);
    return sum + cash - changeGiven;
  }, 0);
  return minorUnits(opening + cashIn);
}

export function openTill(input: { openingFloatMinor: MinorUnits }): TillSession {
  const day = getDaySession();
  const session: TillSession = {
    id: `till-${crypto.randomUUID()}`,
    daySessionId: day.id,
    cashierId: CURRENT_USER_ID,
    cashierName: CURRENT_USER_NAME,
    status: "open",
    openedAt: new Date().toISOString(),
    openingFloatMinor: input.openingFloatMinor,
    closedAt: null,
    expectedMinor: null,
    countedMinor: null,
    varianceMinor: null,
    reason: null,
    reasonNote: null,
  };
  db.tillSessions.push(session);
  return session;
}

export function getOpenTillSession(): TillSession | null {
  return db.tillSessions.find((t) => t.status === "open" && t.cashierId === CURRENT_USER_ID) ?? null;
}

export function closeTill(input: { countedMinor: MinorUnits; reason?: VarianceReason | undefined; reasonNote?: string | undefined }): TillSession {
  const open = getOpenTillSession();
  if (!open) throw new Error("Mock: no open till session for this cashier");
  const cashSalesSinceOpen = db.sales.filter((s) => s.createdAt >= open.openedAt);
  const cashIn = cashSalesSinceOpen.reduce((sum, sale) => {
    const cash = sale.payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountMinor, 0);
    const change = sale.payments.filter((p) => p.method === "cash").reduce((s, p) => s + (p.changeDueMinor ?? 0), 0);
    return sum + cash - change;
  }, 0);
  const expected = minorUnits(open.openingFloatMinor + cashIn);
  const variance = minorUnits(input.countedMinor - expected);
  open.status = "closed";
  open.closedAt = new Date().toISOString();
  open.expectedMinor = expected;
  open.countedMinor = input.countedMinor;
  open.varianceMinor = variance;
  open.reason = variance === 0 ? null : (input.reason ?? null);
  open.reasonNote = input.reasonNote ?? null;
  return open;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

function todaysSales(): Sale[] {
  const day = getDaySession();
  if (!day.openedAt) return [];
  return db.sales.filter((s) => s.createdAt >= day.openedAt!);
}

export function todaysTakenMinor(): MinorUnits {
  return minorUnits(todaysSales().reduce((sum, s) => sum + s.totalMinor, 0));
}

export function todaysCreditMinor(): MinorUnits {
  return minorUnits(
    todaysSales().reduce((sum, s) => sum + s.payments.filter((p) => p.method === "credit").reduce((a, p) => a + p.amountMinor, 0), 0),
  );
}

export function inTheTillMinor(): MinorUnits {
  const day = getDaySession();
  if (day.status !== "open") return day.countedMinor ?? minorUnits(0);
  return expectedTillMinor();
}

export function checkCreditLimit(customerId: string, addMinor: MinorUnits) {
  const customer = db.customers.find((c) => c.id === customerId);
  if (!customer) throw new Error(`Mock: customer ${customerId} not found`);
  const newBalance = minorUnits(customer.balanceMinor + addMinor);
  return {
    allowed: newBalance <= customer.creditLimitMinor,
    currentBalanceMinor: customer.balanceMinor,
    creditLimitMinor: customer.creditLimitMinor,
    newBalanceMinor: newBalance,
  };
}

function nextReceiptNumber(): string {
  db.receiptSeq += 1;
  return String(db.receiptSeq).padStart(5, "0");
}

export function recordSale(input: RecordSaleInput): Sale {
  const day = getDaySession();
  if (day.status !== "open") {
    throw new Error("The shop isn't open yet — open the day before recording a sale.");
  }

  // Stock check per line — mirrors the spec's "Stock check failed" error copy.
  for (const line of input.lines) {
    const product = findProduct(line.productId);
    const unitConv = product.unitConversions.find((u) => u.unitId === line.unitId) ?? {
      unitId: product.unitId,
      unitName: product.unitName,
      factorToBase: 1,
    };
    const qtyInBase = mulQty(line.qty, unitConv.factorToBase);
    void qtyInBase; // stock allowed to go negative with permission per spec D.4 — not blocked here, only surfaced.
  }

  const saleLines: SaleLine[] = input.lines.map((line) => {
    const product = findProduct(line.productId);
    const unitConv = product.unitConversions.find((u) => u.unitId === line.unitId) ?? {
      unitId: product.unitId,
      unitName: product.unitName,
      factorToBase: 1,
    };
    const lineTotal = minorUnits(Math.round(qtyToNumber(line.qty) * line.unitPriceMinor) - line.lineDiscountMinor);
    return {
      productId: product.id,
      name: product.name,
      qty: line.qty,
      unitId: line.unitId,
      unitName: unitConv.unitName,
      unitPriceMinor: line.unitPriceMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      lineTotalMinor: lineTotal,
    };
  });

  const subtotalMinor = saleLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  const totalMinor = minorUnits(subtotalMinor - input.discountMinor);
  const payments: SalePayment[] = input.payments.map((p) => ({
    method: p.method,
    amountMinor: p.amountMinor,
    cashGivenMinor: p.cashGivenMinor ?? null,
    changeDueMinor: p.cashGivenMinor != null ? minorUnits(Math.max(0, p.cashGivenMinor - p.amountMinor)) : null,
    transactionRef: p.transactionRef ?? null,
  }));
  const changeDueMinor = minorUnits(payments.reduce((sum, p) => sum + (p.changeDueMinor ?? 0), 0));

  const sale: Sale = {
    id: `sale-${crypto.randomUUID()}`,
    receiptNumber: nextReceiptNumber(),
    createdAt: new Date().toISOString(),
    createdBy: CURRENT_USER_NAME,
    customerId: input.customerId,
    customerName: input.customerId ? db.customers.find((c) => c.id === input.customerId)?.name ?? null : null,
    lines: saleLines,
    payments,
    subtotalMinor: minorUnits(subtotalMinor),
    discountMinor: input.discountMinor,
    vatMinor: minorUnits(0),
    totalMinor,
    changeDueMinor,
    status: "completed",
  };

  // Stock out per line (this IS the projection write, atomically here).
  for (const line of input.lines) {
    const product = findProduct(line.productId);
    const unitConv = product.unitConversions.find((u) => u.unitId === line.unitId) ?? { factorToBase: 1 };
    const qtyInBase = mulQty(line.qty, unitConv.factorToBase);
    appendStockMovement({
      productId: line.productId,
      type: "sale",
      qtyDelta: `-${qtyInBase}`,
      reference: `Sale #${sale.receiptNumber}`,
    });
  }

  // Customer balance for credit lines.
  const creditAmount = payments.filter((p) => p.method === "credit").reduce((s, p) => s + p.amountMinor, 0);
  if (creditAmount > 0 && input.customerId) {
    const customer = db.customers.find((c) => c.id === input.customerId);
    if (customer) customer.balanceMinor = minorUnits(customer.balanceMinor + creditAmount);
  }

  db.sales.push(sale);
  return sale;
}

export function reverseSale(saleId: string) {
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale || sale.status !== "completed") return;
  sale.status = "reversed";
  for (const line of sale.lines) {
    const product = findProduct(line.productId);
    const unitConv = product.unitConversions.find((u) => u.unitId === line.unitId) ?? { factorToBase: 1 };
    const qtyInBase = mulQty(line.qty, unitConv.factorToBase);
    appendStockMovement({ productId: line.productId, type: "return", qtyDelta: qtyInBase, reference: `Undo sale #${sale.receiptNumber}` });
  }
  const creditAmount = sale.payments.filter((p) => p.method === "credit").reduce((s, p) => s + p.amountMinor, 0);
  if (creditAmount > 0 && sale.customerId) {
    const customer = db.customers.find((c) => c.id === sale.customerId);
    if (customer) customer.balanceMinor = minorUnits(customer.balanceMinor - creditAmount);
  }
}

export function makeReceipt(saleId: string, channel: ReceiptChannel): Receipt {
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale) throw new Error(`Mock: sale ${saleId} not found`);
  return {
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    pdfUrl: `data:text/plain,Receipt%20%23${sale.receiptNumber}`,
    sentChannel: channel,
  };
}

// ---------------------------------------------------------------------------
// Park / quotes / returns
// ---------------------------------------------------------------------------

export function parkSale(label: string, lines: ParkedSale["lines"], customerId: string | null): ParkedSale {
  const parked: ParkedSale = { id: `park-${crypto.randomUUID()}`, label, lines, customerId, parkedAt: new Date().toISOString() };
  db.parkedSales.push(parked);
  return parked;
}

export function unparkSale(id: string): ParkedSale | undefined {
  const idx = db.parkedSales.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const [parked] = db.parkedSales.splice(idx, 1);
  return parked;
}

export function issueQuote(lines: Quote["lines"], customerId: string | null, totalMinor: MinorUnits): Quote {
  db.quoteSeq += 1;
  const quote: Quote = {
    id: `quote-${crypto.randomUUID()}`,
    quoteNumber: `Q-${String(db.quoteSeq).padStart(5, "0")}`,
    lines,
    customerId,
    customerName: customerId ? db.customers.find((c) => c.id === customerId)?.name ?? null : null,
    totalMinor,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    status: "open",
  };
  db.quotes.push(quote);
  return quote;
}

export function recordReturn(input: RecordReturnInput) {
  const sale = db.sales.find((s) => s.id === input.saleId);
  if (!sale) throw new Error(`Mock: sale ${input.saleId} not found`);
  let refundMinor = 0;
  for (const line of input.lines) {
    const saleLine = sale.lines.find((l) => l.productId === line.productId);
    if (!saleLine) continue;
    const unitValue = saleLine.unitPriceMinor;
    refundMinor += Math.round(qtyToNumber(line.qty) * unitValue);
    if (line.restock) {
      appendStockMovement({ productId: line.productId, type: "return", qtyDelta: line.qty, reference: `Return of sale #${sale.receiptNumber}` });
    } else {
      appendStockMovement({ productId: line.productId, type: "write_off", qtyDelta: "0", reference: `Damaged return of sale #${sale.receiptNumber}` });
    }
  }
  return { refundMinor: minorUnits(refundMinor) };
}

// ---------------------------------------------------------------------------
// Stocktakes
// ---------------------------------------------------------------------------

export function startStocktake(scope: StocktakeScope, freezeItems: boolean): Stocktake {
  const products = db.products.filter((p) => {
    if (scope === "all") return true;
    if ("categoryId" in scope) return p.categoryId === scope.categoryId;
    return true;
  });
  const scopeLabel = scope === "all" ? "Whole shop" : "categoryId" in scope ? `Category: ${CATEGORIES.find((c) => c.id === scope.categoryId)?.name ?? scope.categoryId}` : "One location";
  const stocktake: Stocktake = {
    id: `st-${crypto.randomUUID()}`,
    status: "counting",
    scopeLabel,
    freezeItems,
    startedAt: new Date().toISOString(),
    postedAt: null,
    lines: products.map((p) => ({
      productId: p.id,
      productName: p.name,
      expectedQty: p.onHand,
      countedQty: null,
      countedBy: null,
      countedAt: null,
      varianceQty: null,
      varianceValueMinor: null,
      reason: null,
    })),
  };
  db.stocktakes.push(stocktake);
  return stocktake;
}

export function countStocktakeLine(stocktakeId: string, productId: string, countedQty: string): Stocktake {
  const take = db.stocktakes.find((t) => t.id === stocktakeId);
  if (!take) throw new Error(`Mock: stocktake ${stocktakeId} not found`);
  const line = take.lines.find((l) => l.productId === productId);
  if (!line) throw new Error(`Mock: stocktake line ${productId} not found`);
  line.countedQty = countedQty;
  line.countedBy = CURRENT_USER_NAME;
  line.countedAt = new Date().toISOString();
  const variance = subQty(countedQty, line.expectedQty);
  line.varianceQty = variance;
  const product = findProduct(productId);
  line.varianceValueMinor = minorUnits(Math.round(qtyToNumber(variance) * product.costMinor));
  return take;
}

export function moveStocktakeToReview(stocktakeId: string): Stocktake {
  const take = db.stocktakes.find((t) => t.id === stocktakeId);
  if (!take) throw new Error(`Mock: stocktake ${stocktakeId} not found`);
  take.status = "review";
  return take;
}

export function postStocktake(stocktakeId: string): Stocktake {
  const take = db.stocktakes.find((t) => t.id === stocktakeId);
  if (!take) throw new Error(`Mock: stocktake ${stocktakeId} not found`);
  for (const line of take.lines) {
    if (line.varianceQty && isPositiveQty(line.varianceQty.replace("-", "")) && line.varianceQty !== "0") {
      appendStockMovement({ productId: line.productId, type: "stocktake_correction", qtyDelta: line.varianceQty, reference: `Stock-take ${take.id}` });
    }
  }
  take.status = "posted";
  take.postedAt = new Date().toISOString();
  return take;
}

export function getStocktake(id: string): Stocktake {
  const take = db.stocktakes.find((t) => t.id === id);
  if (!take) throw new Error(`Mock: stocktake ${id} not found`);
  return take;
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export function createTransfer(fromLocationId: string, toLocationId: string, lines: { productId: string; qty: string }[]): StockTransfer {
  for (const line of lines) {
    appendStockMovement({ productId: line.productId, type: "transfer", qtyDelta: `-${line.qty}`, locationId: fromLocationId, reference: "Transfer out" });
  }
  const transfer: StockTransfer = {
    id: `tr-${crypto.randomUUID()}`,
    fromLocationId,
    fromLocationName: fromLocationId === LOCATION_ID ? LOCATION_NAME : "Kimironko branch",
    toLocationId,
    toLocationName: toLocationId === LOCATION_ID ? LOCATION_NAME : "Kimironko branch",
    status: "in_transit",
    lines: lines.map((l) => ({ productId: l.productId, productName: findProduct(l.productId).name, qty: l.qty, receivedQty: null })),
    createdAt: new Date().toISOString(),
    receivedAt: null,
  };
  db.transfers.push(transfer);
  return transfer;
}

export function receiveTransfer(transferId: string, received: { productId: string; qty: string }[]): StockTransfer {
  const transfer = db.transfers.find((t) => t.id === transferId);
  if (!transfer) throw new Error(`Mock: transfer ${transferId} not found`);
  let discrepancy = false;
  for (const r of received) {
    const line = transfer.lines.find((l) => l.productId === r.productId);
    if (line) {
      line.receivedQty = r.qty;
      if (r.qty !== line.qty) discrepancy = true;
    }
    appendStockMovement({ productId: r.productId, type: "transfer", qtyDelta: r.qty, locationId: transfer.toLocationId, reference: "Transfer in" });
  }
  transfer.status = discrepancy ? "discrepancy" : "received";
  transfer.receivedAt = new Date().toISOString();
  return transfer;
}

// ---------------------------------------------------------------------------
// Phase 2 — Debt Book (D.6)
// ---------------------------------------------------------------------------

function findCustomer(id: string): Customer {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw new Error(`Mock: customer ${id} not found`);
  return c;
}

export function listInvoices(customerId: string): Invoice[] {
  return [...db.invoices.filter((i) => i.customerId === customerId)].sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime());
}

export function listStatement(customerId: string): StatementEntry[] {
  return [...db.statements.filter((s) => s.customerId === customerId)].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function openInvoicesFor(customerId: string): Invoice[] {
  return db.invoices.filter((i) => i.customerId === customerId && i.remainingMinor > 0);
}

function oldestDueDateFor(customerId: string): string | null {
  const open = openInvoicesFor(customerId);
  if (open.length === 0) return null;
  return open.reduce((oldest, inv) => (new Date(inv.dueDateAt) < new Date(oldest) ? inv.dueDateAt : oldest), open[0]!.dueDateAt);
}

export function debtAccountSummary(customer: Customer): DebtAccountSummary {
  const oldestDueDateAt = oldestDueDateFor(customer.id);
  const oldestDaysOverdue = oldestDueDateAt ? daysOverdue(oldestDueDateAt) : null;
  const status = accountStatus({ balanceMinor: customer.balanceMinor, creditLimitMinor: customer.creditLimitMinor, oldestDueDateAt });
  return { customer, oldestDueDateAt, oldestDaysOverdue, status, hasWriteOff: db.writeOffs.some((w) => w.customerId === customer.id) };
}

export function listDebtAccounts(): DebtAccountSummary[] {
  return db.customers.filter((c) => c.id !== "cust-walkin").map(debtAccountSummary);
}

export function debtBookHeader(): DebtBookHeader {
  const accounts = listDebtAccounts();
  const allOpenInvoices = db.invoices.filter((i) => i.remainingMinor > 0);
  const owedToYouMinor = minorUnits(allOpenInvoices.reduce((s, i) => s + i.remainingMinor, 0));
  const owedToYouAccountCount = accounts.filter((a) => a.customer.balanceMinor > 0).length;

  const overdueInvoices = allOpenInvoices.filter((i) => daysOverdue(i.dueDateAt) > 0);
  const overdueMinor = minorUnits(overdueInvoices.reduce((s, i) => s + i.remainingMinor, 0));
  const overdueAccountCount = new Set(overdueInvoices.map((i) => i.customerId)).size;
  const overdueOldestDays = overdueInvoices.reduce((max, i) => Math.max(max, daysOverdue(i.dueDateAt)), 0);

  const dueThisWeekInvoices = allOpenInvoices.filter((i) => {
    const d = daysOverdue(i.dueDateAt);
    return d <= 0 && d >= -7;
  });
  const dueThisWeekMinor = minorUnits(dueThisWeekInvoices.reduce((s, i) => s + i.remainingMinor, 0));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const collectedThisMonth = db.statements.filter((s) => s.kind === "payment" && new Date(s.date) >= monthStart);
  const collectedThisMonthMinor = minorUnits(collectedThisMonth.reduce((s, e) => s + e.creditMinor, 0));
  const invoicedThisMonth = db.statements.filter((s) => s.kind === "invoice" && new Date(s.date) >= monthStart);
  const invoicedThisMonthMinor = invoicedThisMonth.reduce((s, e) => s + e.debitMinor, 0);
  const collectedThisMonthPercentOfCredit = invoicedThisMonthMinor > 0 ? Math.round((collectedThisMonthMinor / invoicedThisMonthMinor) * 100) : 0;

  const ageing = bucketTotals(allOpenInvoices, now);

  return {
    owedToYouMinor,
    owedToYouAccountCount,
    overdueMinor,
    overdueAccountCount,
    overdueOldestDays,
    dueThisWeekMinor,
    dueThisWeekInvoiceCount: dueThisWeekInvoices.length,
    collectedThisMonthMinor,
    collectedThisMonthPercentOfCredit,
    ageing,
  };
}

export function takePayment(input: TakePaymentInput): TakePaymentResult {
  const customer = findCustomer(input.customerId);
  const openInvoices: AllocatableInvoice[] = openInvoicesFor(input.customerId).map((i) => ({ id: i.id, remainingMinor: i.remainingMinor, dueDateAt: i.dueDateAt }));

  let allocations: AllocationInput[];
  let unallocatedMinor: MinorUnits;

  if (input.allocationMode === "manual") {
    const lines = input.manualAllocations ?? [];
    const validation = validateManualAllocation(input.amountMinor, lines, openInvoices);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    allocations = lines;
    unallocatedMinor = minorUnits(0);
  } else {
    const result = autoAllocate(input.amountMinor, openInvoices);
    allocations = result.allocations;
    unallocatedMinor = result.unallocatedMinor;
  }

  for (const alloc of allocations) {
    const invoice = db.invoices.find((i) => i.id === alloc.invoiceId);
    if (invoice) {
      invoice.remainingMinor = minorUnits(invoice.remainingMinor - alloc.amountMinor);
      if (invoice.remainingMinor <= 0) invoice.status = "paid";
    }
  }

  customer.balanceMinor = minorUnits(Math.max(0, customer.balanceMinor - input.amountMinor));

  db.paymentSeq += 1;
  const ref = `PAY-${db.paymentSeq}`;
  const entryDate = input.backdatedTo ?? new Date().toISOString();
  db.statements.push({
    id: `st-${crypto.randomUUID()}`,
    customerId: customer.id,
    date: entryDate,
    kind: "payment",
    ref,
    detail: `${input.method.toUpperCase()} payment${input.transactionRef ? ` · ref ${input.transactionRef}` : ""}${input.backdateReason ? ` · back-dated: ${input.backdateReason}` : ""}`,
    debitMinor: minorUnits(0),
    creditMinor: input.amountMinor,
    runningBalanceMinor: customer.balanceMinor,
  });

  const location = db.moneyLocations.find((l) => l.accountKey === input.moneyLocationAccountKey);
  if (location) {
    location.balanceMinor = minorUnits(location.balanceMinor + input.amountMinor);
    location.todaysMovementMinor = minorUnits(location.todaysMovementMinor + input.amountMinor);
    db.moneyMovements.unshift({
      id: `mm-${crypto.randomUUID()}`,
      accountKey: location.accountKey,
      accountDisplayName: location.displayName,
      type: "payment_received",
      amountMinor: input.amountMinor,
      balanceAfterMinor: location.balanceMinor,
      userId: CURRENT_USER_ID,
      userName: CURRENT_USER_NAME,
      reference: `Payment from ${customer.name}`,
      timestamp: new Date().toISOString(),
    });
  }

  return { paymentId: ref, allocations, unallocatedMinor, customer };
}

export function writeOffDebt(input: WriteOffInput): Customer {
  const customer = findCustomer(input.customerId);
  const amount = minorUnits(Math.min(input.amountMinor, customer.balanceMinor));
  const open = [...openInvoicesFor(customer.id)].sort((a, b) => new Date(a.dueDateAt).getTime() - new Date(b.dueDateAt).getTime());
  let remaining: number = amount;
  for (const inv of open) {
    if (remaining <= 0) break;
    const record = db.invoices.find((i) => i.id === inv.id)!;
    const take = Math.min(remaining, record.remainingMinor);
    record.remainingMinor = minorUnits(record.remainingMinor - take);
    remaining -= take;
  }
  customer.balanceMinor = minorUnits(customer.balanceMinor - amount);
  db.writeOffs.push({ customerId: customer.id, amountMinor: amount, reason: input.reason, at: new Date().toISOString() });
  db.statements.push({
    id: `st-${crypto.randomUUID()}`,
    customerId: customer.id,
    date: new Date().toISOString(),
    kind: "write_off",
    ref: `WO-${db.writeOffs.length}`,
    detail: `Written off: ${input.reason}`,
    debitMinor: minorUnits(0),
    creditMinor: amount,
    runningBalanceMinor: customer.balanceMinor,
  });
  return customer;
}

function isSnoozed(customerId: string, now: Date): boolean {
  const until = db.snoozedUntil[customerId];
  if (!until) return false;
  return new Date(until) > now;
}

function lastContactAt(customerId: string): string | null {
  const entries = [...db.contactLog.filter((c) => c.customerId === customerId)].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  return entries[0]?.sentAt ?? null;
}

/** Which enabled step a customer has "reached" given their current days-overdue — the most-advanced step whose offset has passed, approximating the schedule engine without a real per-customer send history to replay. */
function nextStepFor(d: number): string | null {
  const steps = [...db.reminderSchedule.steps].filter((s) => s.enabled).sort((a, b) => a.offsetDays - b.offsetDays);
  if (steps.length === 0) return null;
  let candidate = steps[0]!;
  for (const s of steps) {
    if (s.offsetDays <= d) candidate = s;
  }
  return candidate.tone;
}

export function chaseQueue(): ChaseQueueItem[] {
  const now = new Date();
  return listDebtAccounts()
    .filter((a) => a.oldestDaysOverdue !== null && a.oldestDaysOverdue >= 0 && !isSnoozed(a.customer.id, now))
    .map((a) => ({
      customer: a.customer,
      balanceMinor: a.customer.balanceMinor,
      daysOverdue: a.oldestDaysOverdue ?? 0,
      nextReminderStep: nextStepFor(a.oldestDaysOverdue ?? 0),
      lastContactAt: lastContactAt(a.customer.id),
      snoozedUntil: db.snoozedUntil[a.customer.id] ?? null,
    }))
    .sort((x, y) => y.daysOverdue - x.daysOverdue);
}

export function logContact(customerId: string, note: string, channel: ContactLogEntry["channel"] = "manual_note"): ContactLogEntry {
  const entry: ContactLogEntry = {
    id: `log-${crypto.randomUUID()}`,
    customerId,
    channel,
    step: null,
    sentAt: new Date().toISOString(),
    delivered: null,
    read: null,
    note,
    loggedBy: CURRENT_USER_NAME,
  };
  db.contactLog.unshift(entry);
  return entry;
}

export function snoozeCustomer(customerId: string, untilIso: string) {
  db.snoozedUntil[customerId] = untilIso;
}

export function listContactLog(customerId: string): ContactLogEntry[] {
  return [...db.contactLog.filter((c) => c.customerId === customerId)].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

export function getReminderSchedule(): ReminderSchedule {
  return db.reminderSchedule;
}

export function updateReminderSchedule(patch: Partial<Omit<ReminderSchedule, "steps">>): ReminderSchedule {
  db.reminderSchedule = { ...db.reminderSchedule, ...patch };
  return db.reminderSchedule;
}

export function updateReminderStep(stepId: string, patch: Partial<ReminderSchedule["steps"][number]>): ReminderSchedule {
  db.reminderSchedule = { ...db.reminderSchedule, steps: db.reminderSchedule.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
  return db.reminderSchedule;
}

function payLinkUrlFor(customerId: string): string {
  const link = db.payLinks.find((p) => p.customerId === customerId && p.status === "pending");
  return link ? `https://pay.example/${link.token}` : "";
}

/** Approval-mode digest (D.6.5): every account whose oldest-overdue days exactly matches an enabled step's offset today — real schedule evaluation, real templates, not faked, per docs/plans/phase-2.md §0.4. */
export function reminderDigest(): ReminderDigestItem[] {
  const items: ReminderDigestItem[] = [];
  for (const account of listDebtAccounts()) {
    if (account.oldestDaysOverdue === null) continue;
    const step = db.reminderSchedule.steps.find((s) => s.enabled && s.offsetDays === account.oldestDaysOverdue);
    if (!step) continue;
    const rendered = renderTemplate(step.template, {
      customer: account.customer.name,
      amount: (account.customer.balanceMinor / 100).toLocaleString("en-US"),
      days_overdue: String(Math.max(0, account.oldestDaysOverdue)),
      oldest_invoice_date: account.oldestDueDateAt ? new Date(account.oldestDueDateAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "",
      pay_link: payLinkUrlFor(account.customer.id),
    });
    items.push({ id: `digest-${account.customer.id}-${step.id}`, customer: account.customer, step, renderedMessage: rendered.text, checked: true });
  }
  return items;
}

export function sendReminders(customerIds: string[]): number {
  let count = 0;
  for (const id of customerIds) {
    const customer = db.customers.find((c) => c.id === id);
    if (!customer) continue;
    db.contactLog.unshift({
      id: `log-${crypto.randomUUID()}`,
      customerId: id,
      channel: "whatsapp",
      step: null,
      sentAt: new Date().toISOString(),
      delivered: true,
      read: false,
      note: null,
      loggedBy: "System",
    });
    count += 1;
  }
  return count;
}

function matchesSegment(account: DebtAccountSummary, filter: CustomerSegmentFilterSpec): boolean {
  if (filter.minBalanceMinor !== undefined && account.customer.balanceMinor < filter.minBalanceMinor) return false;
  if (filter.maxBalanceMinor !== undefined && account.customer.balanceMinor > filter.maxBalanceMinor) return false;
  if (filter.status !== undefined && account.status !== filter.status) return false;
  if (filter.onHold !== undefined && account.customer.onHold !== filter.onHold) return false;
  if (filter.minUsagePercent !== undefined) {
    const pct = account.customer.creditLimitMinor > 0 ? (account.customer.balanceMinor / account.customer.creditLimitMinor) * 100 : 0;
    if (pct < filter.minUsagePercent) return false;
  }
  return true;
}

/** Segment member counts are computed live against the current account list every call — never materialised/stale, per docs/plans/phase-2.md §0.7. */
export function listSegments(): CustomerSegment[] {
  const accounts = listDebtAccounts();
  return db.segments.map((s) => ({ ...s, memberCount: accounts.filter((a) => matchesSegment(a, s.filterSpec)).length }));
}

export function createSegment(name: string, filterSpec: CustomerSegmentFilterSpec): CustomerSegment {
  db.segments.push({ id: `seg-${crypto.randomUUID()}`, name, filterSpec, memberCount: 0 });
  return listSegments().find((s) => s.name === name)!;
}

export function segmentMembers(segmentId: string): DebtAccountSummary[] {
  const seg = db.segments.find((s) => s.id === segmentId);
  if (!seg) throw new Error(`Mock: segment ${segmentId} not found`);
  return listDebtAccounts().filter((a) => matchesSegment(a, seg.filterSpec));
}

export function sendBroadcast(segmentId: string | null, message: string): BroadcastSend {
  const members = segmentId ? segmentMembers(segmentId) : listDebtAccounts();
  const segment = segmentId ? db.segments.find((s) => s.id === segmentId) : null;
  const recipientCount = members.length;
  const deliveredCount = Math.round(recipientCount * 0.9);
  const readCount = Math.round(recipientCount * 0.6);
  const send: BroadcastSend = {
    id: `bc-${crypto.randomUUID()}`,
    segmentId,
    segmentName: segment?.name ?? "All customers",
    message,
    sentAt: new Date().toISOString(),
    sentBy: CURRENT_USER_NAME,
    recipientCount,
    deliveredCount,
    readCount,
  };
  db.broadcastSends.unshift(send);
  return send;
}

export function listBroadcasts(): BroadcastSend[] {
  return db.broadcastSends;
}

// ---------------------------------------------------------------------------
// Phase 2 — Cash Box (D.7.1–D.7.3)
// ---------------------------------------------------------------------------

export function listMoneyLocations(): MoneyLocation[] {
  return db.moneyLocations;
}

export function updateMoneyLocationBalance(accountKey: string, countedMinor: MinorUnits, reason?: string): MoneyLocation {
  const loc = db.moneyLocations.find((l) => l.accountKey === accountKey);
  if (!loc) throw new Error(`Mock: money location ${accountKey} not found`);
  const delta = minorUnits(countedMinor - loc.balanceMinor);
  loc.balanceMinor = countedMinor;
  loc.todaysMovementMinor = minorUnits(loc.todaysMovementMinor + delta);
  db.moneyMovements.unshift({
    id: `mm-${crypto.randomUUID()}`,
    accountKey,
    accountDisplayName: loc.displayName,
    type: "manual_adjustment",
    amountMinor: delta,
    balanceAfterMinor: loc.balanceMinor,
    userId: CURRENT_USER_ID,
    userName: CURRENT_USER_NAME,
    reference: reason ?? "Manual balance update",
    timestamp: new Date().toISOString(),
  });
  return loc;
}

export function listMoneyMovements(filters?: MoneyMovementFilters): MoneyMovement[] {
  let rows = db.moneyMovements;
  if (filters?.accountKey) rows = rows.filter((m) => m.accountKey === filters.accountKey);
  if (filters?.type) rows = rows.filter((m) => m.type === filters.type);
  if (filters?.userId) rows = rows.filter((m) => m.userId === filters.userId);
  if (filters?.from) rows = rows.filter((m) => m.timestamp >= filters.from!);
  if (filters?.to) rows = rows.filter((m) => m.timestamp <= filters.to!);
  return rows;
}

// ---------------------------------------------------------------------------
// Phase 2 — MoMo reconciliation (D.7.3)
// ---------------------------------------------------------------------------

export function listMomoTransactions(): MomoTransaction[] {
  return db.momoTransactions;
}

export function unmatchedMomoTotal(): { totalMinor: MinorUnits; count: number } {
  const unmatched = db.momoTransactions.filter((t) => t.status === "unmatched");
  return { totalMinor: minorUnits(unmatched.reduce((s, t) => s + t.amountMinor, 0)), count: unmatched.length };
}

export function matchMomoTransaction(input: MatchMomoTransactionInput): MomoTransaction {
  const txn = db.momoTransactions.find((t) => t.id === input.momoTransactionId);
  if (!txn) throw new Error(`Mock: momo transaction ${input.momoTransactionId} not found`);
  const customer = findCustomer(input.customerId);
  txn.status = "matched";
  txn.matchedCustomerId = customer.id;
  txn.matchedCustomerName = customer.name;
  txn.matchConfidence = "high";
  takePayment({ customerId: customer.id, amountMinor: txn.amountMinor, method: "momo", transactionRef: txn.externalId, moneyLocationAccountKey: "momo", allocationMode: "auto" });
  return txn;
}

export function markMomoAsCash(momoTransactionId: string): MomoTransaction {
  const txn = db.momoTransactions.find((t) => t.id === momoTransactionId);
  if (!txn) throw new Error(`Mock: momo transaction ${momoTransactionId} not found`);
  txn.status = "ignored";
  return txn;
}

export function voidMomoTransaction(momoTransactionId: string): MomoTransaction {
  const txn = db.momoTransactions.find((t) => t.id === momoTransactionId);
  if (!txn) throw new Error(`Mock: momo transaction ${momoTransactionId} not found`);
  txn.status = "ignored";
  return txn;
}

/**
 * SandboxMomoProvider stand-in (docs/DECISIONS.md "mobile money is a real
 * signed-webhook seam behind a sandbox provider"): simulates a customer
 * approving a USSD push a few seconds later, landing as a new momo
 * transaction that's then auto-matched — the frontend-only approximation of
 * the real webhook round-trip apps/api will own.
 */
export function requestMomoPayment(customerId: string, amountMinor: MinorUnits, phone: string): { requestId: string } {
  const requestId = `req-${crypto.randomUUID()}`;
  setTimeout(() => {
    const txn: MomoTransaction = {
      id: `momo-${crypto.randomUUID()}`,
      provider: "mtn",
      externalId: requestId.slice(4, 12).toUpperCase(),
      phone,
      amountMinor,
      direction: "in",
      occurredAt: new Date().toISOString(),
      status: "unmatched",
      matchedCustomerId: null,
      matchedCustomerName: null,
      matchConfidence: null,
    };
    db.momoTransactions.unshift(txn);
    matchMomoTransaction({ momoTransactionId: txn.id, customerId });
  }, 3_000);
  return { requestId };
}

// ---------------------------------------------------------------------------
// Phase 2 — Pay link (public, unauthenticated — docs/DECISIONS.md §0.5)
// ---------------------------------------------------------------------------

export function getPayLink(token: string): PayLinkDetails {
  const link = db.payLinks.find((p) => p.token === token);
  if (!link) return { status: "invalid", businessName: "", customerName: "", amountMinor: minorUnits(0), invoiceRef: null, expiresAt: null };
  if (link.status === "pending" && new Date(link.expiresAt) < new Date()) link.status = "expired";
  const customer = db.customers.find((c) => c.id === link.customerId);
  return {
    status: link.status,
    businessName: link.businessName,
    customerName: customer?.name ?? "",
    amountMinor: link.amountMinor,
    invoiceRef: link.invoiceRef,
    expiresAt: link.expiresAt,
  };
}

export function submitPayLink(token: string, method: "momo" | "airtel", phone: string): { status: "pending_confirmation" } {
  const link = db.payLinks.find((p) => p.token === token);
  if (!link) throw new Error("This pay link doesn't exist.");
  if (link.status === "expired" || (link.status === "pending" && new Date(link.expiresAt) < new Date())) {
    link.status = "expired";
    throw new Error("This pay link has expired.");
  }
  if (link.status !== "pending") throw new Error("This pay link is no longer active.");
  void phone;
  const customerId = link.customerId;
  const amountMinor = link.amountMinor;
  setTimeout(() => {
    takePayment({ customerId, amountMinor, method: "momo", moneyLocationAccountKey: "momo", allocationMode: "auto" });
    link.status = "paid";
  }, 2_500);
  return { status: "pending_confirmation" };
}

export function payLinkStatusOnly(token: string): PayLinkStatus {
  return db.payLinks.find((p) => p.token === token)?.status ?? "invalid";
}

// ---------------------------------------------------------------------------
// Phase 2 — Expenses (D.7.4)
// ---------------------------------------------------------------------------

function postExpenseMoneyMovement(expense: Expense) {
  const loc = db.moneyLocations.find((l) => l.accountKey === expense.moneyLocationAccountKey);
  if (!loc) return;
  loc.balanceMinor = minorUnits(loc.balanceMinor - expense.amountMinor);
  loc.todaysMovementMinor = minorUnits(loc.todaysMovementMinor - expense.amountMinor);
  db.moneyMovements.unshift({
    id: `mm-${crypto.randomUUID()}`,
    accountKey: expense.moneyLocationAccountKey,
    accountDisplayName: loc.displayName,
    type: "expense",
    amountMinor: minorUnits(-expense.amountMinor),
    balanceAfterMinor: loc.balanceMinor,
    userId: CURRENT_USER_ID,
    userName: CURRENT_USER_NAME,
    reference: expense.payee,
    timestamp: new Date().toISOString(),
  });
}

export function listExpenses(): Expense[] {
  return db.expenses;
}

export function recordExpense(input: RecordExpenseInput): Expense {
  const aboveThreshold = input.amountMinor >= db.expenseApprovalThresholdMinor;
  const expense: Expense = {
    id: `exp-${crypto.randomUUID()}`,
    amountMinor: input.amountMinor,
    category: input.category,
    moneyLocationAccountKey: input.moneyLocationAccountKey,
    payee: input.payee,
    date: input.date,
    note: input.note ?? "",
    receiptPhotoUrl: input.receiptPhotoUrl ?? null,
    ocrStatus: "not_attempted",
    status: aboveThreshold ? "pending_approval" : "posted",
    approvedBy: null,
    createdBy: CURRENT_USER_NAME,
    createdAt: new Date().toISOString(),
  };
  db.expenses.unshift(expense);
  if (!aboveThreshold) postExpenseMoneyMovement(expense);
  return expense;
}

export function approveExpense(id: string): Expense {
  const expense = db.expenses.find((e) => e.id === id);
  if (!expense) throw new Error(`Mock: expense ${id} not found`);
  if (expense.status !== "pending_approval") throw new Error("Only expenses pending approval can be approved.");
  expense.status = "posted";
  expense.approvedBy = CURRENT_USER_NAME;
  postExpenseMoneyMovement(expense);
  return expense;
}

export function rejectExpense(id: string, note?: string): Expense {
  const expense = db.expenses.find((e) => e.id === id);
  if (!expense) throw new Error(`Mock: expense ${id} not found`);
  expense.status = "rejected";
  expense.approvedBy = CURRENT_USER_NAME;
  if (note) expense.note = note;
  return expense;
}

export function listRecurringExpenses(): RecurringExpense[] {
  return db.recurringExpenses;
}

export function createRecurringExpense(template: RecordExpenseInput, interval: "weekly" | "monthly"): RecurringExpense {
  const rec: RecurringExpense = {
    id: `rec-${crypto.randomUUID()}`,
    template,
    interval,
    nextRunDate: new Date(Date.now() + (interval === "weekly" ? 7 : 30) * 86_400_000).toISOString().slice(0, 10),
    active: true,
  };
  db.recurringExpenses.push(rec);
  return rec;
}

export function toggleRecurringExpense(id: string, active: boolean): RecurringExpense {
  const rec = db.recurringExpenses.find((r) => r.id === id);
  if (!rec) throw new Error(`Mock: recurring expense ${id} not found`);
  rec.active = active;
  return rec;
}

// ---------------------------------------------------------------------------
// Phase 2 — Back Office additions: expense approval threshold, MoMo "Connect now"
// ---------------------------------------------------------------------------

export function getExpenseApprovalThreshold(): MinorUnits {
  return db.expenseApprovalThresholdMinor;
}

export function setExpenseApprovalThreshold(amountMinor: MinorUnits): MinorUnits {
  db.expenseApprovalThresholdMinor = amountMinor;
  return db.expenseApprovalThresholdMinor;
}

export function getMomoConnection(): MomoProviderConnection {
  return db.momoConnection;
}

/** D.7/plan §0.3 — "Connect now" against the sandbox MoMo provider (real for the sandbox, per docs/DECISIONS.md's "mobile money is a real signed-webhook seam behind a sandbox provider"). */
export function setMomoConnection(status: "connected" | "not_connected", merchantCode?: string): MomoProviderConnection {
  db.momoConnection = { ...db.momoConnection, status, merchantCode: status === "connected" ? (merchantCode ?? db.momoConnection.merchantCode) : null };
  const loc = db.moneyLocations.find((l) => l.accountKey === "momo");
  if (loc) loc.connectionStatus = status === "connected" ? "connected" : "manual";
  return db.momoConnection;
}

export { UNITS, CATEGORIES };
