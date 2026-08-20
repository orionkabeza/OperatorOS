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
  search?: string;
  categoryId?: string;
  quickFilter?: "low-stock" | "out-of-stock" | "negative-stock" | "expiring-30d" | "no-movement-90d" | "below-cost";
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
  productId?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
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
