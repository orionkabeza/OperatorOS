import { apiRequest, USE_MOCK_API } from "./config";
import * as store from "../mock/store";
import { mockDelay } from "../mock/store";
import type { Receipt, ReceiptChannel } from "./types";

export async function sendReceipt(saleId: string, channel: ReceiptChannel): Promise<Receipt> {
  if (USE_MOCK_API) return mockDelay(store.makeReceipt(saleId, channel));
  return apiRequest<Receipt>("POST", `/api/v1/receipts/${saleId}/send`, { body: { channel } });
}

export async function getReceiptPdfUrl(saleId: string): Promise<string> {
  if (USE_MOCK_API) return mockDelay(store.makeReceipt(saleId, "print").pdfUrl);
  return apiRequest<string>("GET", `/api/v1/receipts/${saleId}/pdf`);
}
