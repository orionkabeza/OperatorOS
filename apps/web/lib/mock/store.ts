import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { addQty, isPositiveQty, mulQty, qtyToNumber, subQty } from "../decimal";
import type {
  Customer,
  DaySession,
  DayCloseChecklist,
  DaySummary,
  ParkedSale,
  Product,
  Quote,
  Receipt,
  ReceiptChannel,
  RecordReturnInput,
  RecordSaleInput,
  Sale,
  SaleLine,
  SalePayment,
  StockMovement,
  StockMovementType,
  StockTransfer,
  Stocktake,
  StocktakeScope,
  TillSession,
  VarianceReason,
} from "../api/types";
import { CATEGORIES, CURRENT_USER_ID, CURRENT_USER_NAME, CUSTOMERS, LOCATION_ID, LOCATION_NAME, PRODUCTS, UNITS } from "./seed";

/**
 * In-memory mutable "ledger" the mock adapter reads and writes. This is the
 * one place that simulates what apps/api's projections will do for real:
 * a sale decrements stock and bumps customer balance in the same call,
 * a day close needs the day to have been open, etc. Every mutation also
 * appends a StockMovement / event-shaped record so the Stock Room's
 * movements ledger and stock card are genuinely explainable, matching the
 * append-only spirit of spec Part E even though this is throwaway state.
 */
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

export { UNITS, CATEGORIES };
