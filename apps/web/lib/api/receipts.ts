import { apiRequest, notSupportedByBackend, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import { schemas } from "./generated/client";
import type { Receipt, ReceiptChannel } from "./types";

/**
 * The real receipts router is keyed by `receipt_number` (a small sequential
 * integer, `SaleOut.receipt_number`), NOT `sale_id` (a UUID) — there is no
 * sale_id-keyed receipts route, and no lookup endpoint between the two
 * identifier spaces (schemas/receipts.py, api/routers/receipts.py). Both
 * functions below keep their existing `saleId` parameter name (there are no
 * component call sites today to break — grep confirms these are unused so
 * far) but the real branch requires the caller to actually pass a receipt
 * number string; a non-numeric value fails loudly rather than silently
 * hitting the wrong resource.
 */
function requireReceiptNumber(saleId: string): number {
  const n = Number(saleId);
  if (!Number.isInteger(n)) {
    throw new Error(
      `receipts.ts's real-API branch needs a receipt number (SaleOut.receipt_number), not a sale id — got ${JSON.stringify(saleId)}. See this file's top-of-file comment.`,
    );
  }
  return n;
}

export async function sendReceipt(saleId: string, channel: ReceiptChannel): Promise<Receipt> {
  if (USE_MOCK_API) return mockDelay(store.makeReceipt(saleId, channel));
  const receiptNumber = requireReceiptNumber(saleId);
  const receiptRaw = await apiRequest<unknown>("GET", `/api/v1/receipts/${receiptNumber}`);
  const receipt = schemas.ReceiptOut.parse(receiptRaw);
  await apiRequest<unknown>("POST", `/api/v1/receipts/${receiptNumber}/send`, { body: { channel } });
  return {
    saleId: receipt.sale_id,
    receiptNumber: String(receipt.receipt_number),
    // No PDF-rendering endpoint exists (api/routers/receipts.py's own
    // docstring discloses this as a known Phase 1 gap — no binary PDF, only
    // `rendered_text`) — never a real pdfUrl to hand back.
    pdfUrl: "",
    sentChannel: channel,
  };
}

/** No PDF endpoint exists — `GET /{receipt_number}` returns `rendered_text` (an HTML/plain-text representation), not a binary PDF or a URL to one. Disclosed in api/routers/receipts.py's own docstring as a known Phase 1 gap, not new to this pass. */
export async function getReceiptPdfUrl(saleId: string): Promise<string> {
  if (USE_MOCK_API) return mockDelay(store.makeReceipt(saleId, "print").pdfUrl);
  return notSupportedByBackend(`Getting a PDF download URL for receipt ${saleId} (no PDF-rendering endpoint exists)`);
}
