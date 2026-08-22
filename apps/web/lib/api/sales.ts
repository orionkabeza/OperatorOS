import { minorUnits, type MinorUnits } from "@operatoros/shared";
import { apiRequest, getDefaultLocationId, newIdempotencyKey, notSupportedByBackend, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { schemas } from "./generated/client";
import { listProducts } from "./products";
import { z } from "zod";
import type {
  BasketLineInput,
  CreditLimitCheck,
  ParkedSale,
  Product,
  Quote,
  RecordReturnInput,
  RecordSaleInput,
  Sale,
} from "./types";

async function mapSaleOut(s: z.infer<typeof schemas.SaleOut>, products: Product[]): Promise<Sale> {
  const productById = new Map(products.map((p) => [p.id, p]));
  return {
    id: s.id,
    receiptNumber: String(s.receipt_number),
    // SaleOut carries no timestamp field at all — "now" is only accurate
    // immediately after a `recordSale`/`convertQuote` call, which is the
    // only place this mapper is used.
    createdAt: new Date().toISOString(),
    createdBy: "", // not on the wire
    customerId: s.customer_id,
    customerName: null, // not on the wire — would need a separate customer fetch
    lines: s.lines.map((l) => {
      const product = productById.get(l.product_id);
      return {
        productId: l.product_id,
        name: product?.name ?? l.product_id,
        qty: l.quantity,
        unitId: product?.unitId ?? "",
        unitName: product?.unitName ?? "",
        unitPriceMinor: minorUnits(l.unit_price_minor),
        lineDiscountMinor: minorUnits(l.line_discount_minor),
        lineTotalMinor: minorUnits(l.line_total_minor),
      };
    }),
    payments: s.payments.map((p) => ({
      method: p.method as Sale["payments"][number]["method"],
      amountMinor: minorUnits(p.amount_minor),
      // "Change due" is deliberately not stored server-side (api/routers/
      // sales.py's own docstring: a client-side-only UI computation from
      // "cash given") — SalePaymentOut carries no cash-given/change field.
      cashGivenMinor: null,
      changeDueMinor: null,
      transactionRef: p.reference,
    })),
    subtotalMinor: minorUnits(s.subtotal_minor),
    discountMinor: minorUnits(s.discount_minor),
    vatMinor: minorUnits(s.tax_minor),
    totalMinor: minorUnits(s.total_minor),
    changeDueMinor: minorUnits(0), // not tracked server-side, see above
    status: s.status === "reversed" ? "reversed" : "completed",
  };
}

/**
 * The Counter's basket-to-sale call — atomic in the real backend (spec D.4:
 * one transaction).
 *
 * `manager_override_user_id` used to be hard-coded `null` here because the
 * frontend captured a PIN but never WHICH manager entered it, and
 * `_verify_manager_override` returns False without both — so every
 * PIN-gated override (min-price, over-threshold discount, over-credit-
 * limit) was rejected 422 by the real backend while appearing to work
 * against the mock. The Counter now asks who is approving (backed by
 * `GET /api/v1/users/approvers`) and that id is carried through here.
 */
export async function recordSale(input: RecordSaleInput): Promise<Sale> {
  if (USE_MOCK_API) return mockDelay(store.recordSale(input), 250);
  const raw = await apiRequest<unknown>("POST", "/api/v1/sales", {
    body: {
      location_id: await getDefaultLocationId(),
      customer_id: input.customerId,
      discount_minor: input.discountMinor,
      lines: input.lines.map((l) => ({
        product_id: l.productId,
        quantity: l.qty,
        unit_price_minor: l.unitPriceMinor,
        line_discount_minor: l.lineDiscountMinor,
      })),
      payments: input.payments.map((p) => ({ method: p.method, amount_minor: p.amountMinor, reference: p.transactionRef ?? null })),
      manager_override_user_id: input.discountManagerUserId ?? null,
      manager_override_pin: input.discountManagerPin ?? null,
      override_reason: null,
      allow_negative_stock: false,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const products = await listProducts();
  return mapSaleOut(schemas.SaleOut.parse(raw), products);
}

/** No backend counterpart — grep of api/routers/sales.py confirms no `/reverse` or any other undo route exists for a completed sale. Genuinely unsupported, not a naming mismatch. */
export async function undoSale(saleId: string): Promise<void> {
  if (USE_MOCK_API) {
    store.reverseSale(saleId);
    await mockDelay(undefined);
    return;
  }
  notSupportedByBackend(`Undoing sale ${saleId}`);
}

/** No `/credit-check` endpoint exists — derived from the real `GET /api/v1/customers/{id}` figures (`balance_minor`/`credit_limit_minor`) using the same allowed-if-under-limit rule the real `create_sale` endpoint itself enforces (api/routers/sales.py's credit-limit check), rather than a separate invented endpoint. */
export async function checkCreditLimit(customerId: string, addMinor: MinorUnits): Promise<CreditLimitCheck> {
  if (USE_MOCK_API) return mockDelay(store.checkCreditLimit(customerId, addMinor));
  const raw = await apiRequest<unknown>("GET", `/api/v1/customers/${customerId}`);
  const c = schemas.CustomerOut.parse(raw);
  const newBalanceMinor = c.balance_minor + addMinor;
  return {
    allowed: newBalanceMinor <= c.credit_limit_minor,
    currentBalanceMinor: minorUnits(c.balance_minor),
    creditLimitMinor: minorUnits(c.credit_limit_minor),
    newBalanceMinor: minorUnits(newBalanceMinor),
  };
}

/** No backend counterpart — sales.py has no park/resume routes at all (only sales, quotes, returns). Genuinely unsupported, kept mock-only. See docs/DECISIONS.md. */
export async function parkSale(label: string, lines: BasketLineInput[], customerId: string | null): Promise<ParkedSale> {
  if (USE_MOCK_API) return mockDelay(store.parkSale(label, lines, customerId));
  return notSupportedByBackend("Parking a sale");
}

export async function listParkedSales(): Promise<ParkedSale[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().parkedSales);
  return notSupportedByBackend("Listing parked sales");
}

export async function resumeParkedSale(id: string): Promise<ParkedSale | undefined> {
  if (USE_MOCK_API) return mockDelay(store.unparkSale(id));
  return notSupportedByBackend(`Resuming parked sale ${id}`);
}

function mapQuoteOut(q: z.infer<typeof schemas.QuoteOut>, products: Product[]): Quote {
  const productById = new Map(products.map((p) => [p.id, p]));
  return {
    id: q.id,
    quoteNumber: String(q.quote_number),
    lines: (q.lines ?? []).map((l) => ({
      productId: l.product_id,
      name: productById.get(l.product_id)?.name ?? l.product_id,
      qty: l.quantity,
      unitId: productById.get(l.product_id)?.unitId ?? "",
      unitPriceMinor: minorUnits(l.unit_price_minor),
      lineDiscountMinor: minorUnits(0), // QuoteLineOut has no per-line discount
    })),
    customerId: q.customer_id,
    customerName: null, // not on the wire
    totalMinor: minorUnits(q.total_minor),
    issuedAt: new Date().toISOString(), // QuoteOut has no issued-at timestamp; only accurate right after creation
    expiresAt: q.expires_at,
    status: q.status as Quote["status"],
  };
}

/** Real path is `/api/v1/sales/quotes`, not `/api/v1/quotes`. */
export async function issueQuote(lines: BasketLineInput[], customerId: string | null, totalMinor: MinorUnits): Promise<Quote> {
  if (USE_MOCK_API) return mockDelay(store.issueQuote(lines, customerId, totalMinor));
  void totalMinor; // the real endpoint computes totals server-side from unit prices, same as before
  const raw = await apiRequest<unknown>("POST", "/api/v1/sales/quotes", {
    body: {
      location_id: await getDefaultLocationId(),
      customer_id: customerId,
      discount_minor: 0,
      lines: lines.map((l) => ({ product_id: l.productId, quantity: l.qty, unit_price_minor: l.unitPriceMinor })),
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const products = await listProducts();
  return mapQuoteOut(schemas.QuoteOut.parse(raw), products);
}

/** No `GET /api/v1/sales/quotes` LIST endpoint exists — only create and get-by-id (`GET /api/v1/sales/quotes/{quote_id}`). Genuinely unsupported as a bulk list, not a naming mismatch. */
export async function listQuotes(): Promise<Quote[]> {
  if (USE_MOCK_API) return mockDelay(store.getDb().quotes);
  return notSupportedByBackend("Listing quotes (no list endpoint exists — only create and get-by-id)");
}

/** No `GET /api/v1/sales` (or any sales list) endpoint exists at all — sales.py only has POST /sales, POST /sales/quotes[...], POST /sales/returns. Genuinely unsupported. */
export async function listTodaysSales(): Promise<Sale[]> {
  if (USE_MOCK_API) {
    const day = store.getDaySession();
    const rows = day.openedAt ? store.getDb().sales.filter((s) => s.createdAt >= day.openedAt!) : [];
    return mockDelay(rows);
  }
  return notSupportedByBackend("Listing today's sales (no sales-list endpoint exists)");
}

/** Real backend has no sale_id-keyed lookup and no sale_id -> receipt_number index — the ONLY way to look up a completed sale by a human-facing number is `GET /api/v1/receipts/{receipt_number}`, which this function's `receiptNumber` parameter already matches. Several `Sale` fields (customerId, createdBy, status) have no source on `ReceiptOut` and are disclosed as null/defaulted rather than guessed. */
export async function findSaleByReceipt(receiptNumber: string): Promise<Sale | undefined> {
  if (USE_MOCK_API) {
    return mockDelay(store.getDb().sales.find((s) => s.receiptNumber === receiptNumber));
  }
  const n = Number(receiptNumber);
  if (!Number.isInteger(n)) return undefined;
  let raw: unknown;
  try {
    raw = await apiRequest<unknown>("GET", `/api/v1/receipts/${n}`);
  } catch {
    return undefined;
  }
  const r = schemas.ReceiptOut.parse(raw);
  // ReceiptOut.lines/.payments are typed `list[dict]` server-side
  // (api/routers/receipts.py::_load_receipt builds them as raw dicts, not
  // a Pydantic submodel) — the generated Zod schema can only validate them
  // as `Record<string, unknown>`, so they're re-validated here against the
  // actual shape that handler produces, rather than blindly cast.
  const receiptLine = z.object({ product_id: z.string(), quantity: z.string(), unit_price_minor: z.number(), line_total_minor: z.number() });
  const receiptPayment = z.object({ method: z.string(), amount_minor: z.number(), reference: z.string().nullable() });
  const lines = receiptLine.array().parse(r.lines);
  const payments = receiptPayment.array().parse(r.payments);
  const products = await listProducts();
  const productById = new Map(products.map((p) => [p.id, p]));
  return {
    id: r.sale_id,
    receiptNumber: String(r.receipt_number),
    createdAt: "", // ReceiptOut has no timestamp
    createdBy: "",
    customerId: null, // ReceiptOut has no customer reference
    customerName: null,
    lines: lines.map((l) => ({
      productId: l.product_id,
      name: productById.get(l.product_id)?.name ?? l.product_id,
      qty: l.quantity,
      unitId: productById.get(l.product_id)?.unitId ?? "",
      unitName: productById.get(l.product_id)?.unitName ?? "",
      unitPriceMinor: minorUnits(l.unit_price_minor),
      lineDiscountMinor: minorUnits(0), // ReceiptOut's line shape carries no per-line discount
      lineTotalMinor: minorUnits(l.line_total_minor),
    })),
    payments: payments.map((p) => ({
      method: p.method as Sale["payments"][number]["method"],
      amountMinor: minorUnits(p.amount_minor),
      cashGivenMinor: null,
      changeDueMinor: null,
      transactionRef: p.reference,
    })),
    subtotalMinor: minorUnits(r.subtotal_minor),
    discountMinor: minorUnits(r.discount_minor),
    vatMinor: minorUnits(r.tax_minor),
    totalMinor: minorUnits(r.total_minor),
    changeDueMinor: minorUnits(0),
    status: "completed",
  };
}

/**
 * No backend counterpart today — the real `ReturnCreateRequest` requires
 * each line's `unit_price_minor` (schemas/sales.py), but there is NO
 * `GET /api/v1/sales/{sale_id}` (or any sale_id-keyed lookup) endpoint to
 * recover a sale's original line prices from just a `sale_id`, and
 * `RecordReturnInput`/`ReturnLineInput` don't carry them either — the
 * frontend genuinely has nowhere to get an authoritative price from at
 * this call site without guessing, which would misrecord a real refund
 * amount. A correct fix needs either a new/extended endpoint or the
 * return flow's caller to carry the sale's line prices through from
 * wherever it already has the `Sale` object on screen — flagged here
 * rather than invented. See docs/DECISIONS.md.
 */
export async function recordReturn(input: RecordReturnInput): Promise<{ refundMinor: MinorUnits }> {
  if (USE_MOCK_API) return mockDelay(store.recordReturn(input));
  return notSupportedByBackend(
    `Recording a return for sale ${input.saleId} (no way to recover the sale's original line prices, which the real return endpoint requires)`,
  );
}
