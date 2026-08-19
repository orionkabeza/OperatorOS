/**
 * Airtel Money integration — not wired up yet (matches the "Not connected
 * yet" state shown in Settings). Same call shape as `lib/integrations/momo.ts`
 * so swapping a payment onto Airtel later is a matter of implementing these
 * against Airtel's Collections API (https://developers.airtel.africa), not
 * restructuring callers.
 */

export interface RequestToPayInput {
  amount: number;
  currency?: string;
  payerPhone: string;
  externalId: string;
  payerMessage: string;
  payeeNote: string;
}

export async function requestToPay(_input: RequestToPayInput): Promise<{ referenceId: string }> {
  throw new Error("Airtel Money is not connected yet. Set up API credentials to enable it.");
}

export async function getTransactionStatus(_referenceId: string): Promise<never> {
  throw new Error("Airtel Money is not connected yet. Set up API credentials to enable it.");
}
