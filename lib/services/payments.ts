import crypto from "node:crypto";
import { prisma } from "../db";
import { optionalEnv } from "../env";
import * as airtel from "../integrations/airtel";
import * as momo from "../integrations/momo";
import type { MomoTransaction } from "../integrations/momo";

/** Builds a callback URL MTN can hit, embedding the reference id + a shared secret since MTN callbacks aren't signed. */
function buildMomoCallbackUrl(referenceId: string): string | undefined {
  const base = process.env.MOMO_CALLBACK_URL;
  if (!base) return undefined;
  const url = new URL(base);
  url.searchParams.set("ref", referenceId);
  if (process.env.MOMO_CALLBACK_SECRET) {
    url.searchParams.set("secret", process.env.MOMO_CALLBACK_SECRET);
  }
  return url.toString();
}

/**
 * Kicks off an MTN MoMo request-to-pay for an order. The customer approves
 * the prompt on their phone; confirmation arrives later via the
 * /api/webhooks/momo callback (or `syncMomoPayment` if you'd rather poll).
 *
 * The AWAITING Payment row is created BEFORE the MTN call so a fast callback
 * always has a row to match; if the MTN call then fails, the row is marked
 * UNPAID. Re-sending is rejected while a payment is already outstanding or
 * settled, so a customer can't be double-prompted (and double-charged).
 */
export async function initiateMomoPayment(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { customer: true, payments: true },
  });

  if (order.paymentStatus === "PAID") {
    throw new Error("Order is already paid.");
  }
  const outstanding = order.payments.find((p) => p.provider === "MTN_MOMO" && p.status === "AWAITING");
  if (outstanding) {
    // Reuse the existing request instead of firing a second prompt.
    return { referenceId: outstanding.providerRef ?? "", reused: true };
  }

  const referenceId = crypto.randomUUID();

  // Reserve the row + flip the order first, in one transaction.
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "MTN_MOMO",
        providerRef: referenceId,
        status: "AWAITING",
        amount: order.total,
      },
    }),
    prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "AWAITING" } }),
  ]);

  try {
    await momo.requestToPay({
      amount: order.total,
      currency: optionalEnv("MOMO_CURRENCY", "GHS"),
      payerPhone: order.customer.phone,
      externalId: order.id,
      payerMessage: `Order #${order.number} at Auntie Efua's Kitchen`,
      payeeNote: `Order #${order.number}`,
      referenceId,
      callbackUrl: buildMomoCallbackUrl(referenceId),
    });
  } catch (err) {
    // MTN rejected the request — roll the reservation back so the order isn't
    // stuck AWAITING a prompt that never reached the customer.
    await prisma.$transaction([
      prisma.payment.updateMany({ where: { providerRef: referenceId }, data: { status: "UNPAID" } }),
      prisma.order.updateMany({
        where: { id: order.id, paymentStatus: "AWAITING" },
        data: { paymentStatus: "UNPAID" },
      }),
    ]);
    throw err;
  }

  return { referenceId, reused: false };
}

/** Same shape as `initiateMomoPayment`, for the not-yet-connected Airtel path. */
export async function initiateAirtelPayment(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
  const { referenceId } = await airtel.requestToPay({
    amount: order.total,
    payerPhone: order.customer.phone,
    externalId: order.id,
    payerMessage: `Order #${order.number} at Auntie Efua's Kitchen`,
    payeeNote: `Order #${order.number}`,
  });
  return { referenceId };
}

/**
 * Applies a MoMo status update (from the webhook or a manual poll) to the
 * matching Payment + Order.
 *
 * - A confirmed (PAID) order is terminal: a later FAILED/PENDING callback
 *   can never reverse it (guards against a late timeout wiping a real
 *   payment, or an attacker replaying FAILED).
 * - The order write is scoped to the payment it actually belongs to, so it
 *   can't clobber a status set by a different payment (e.g. a cash confirm).
 * - The raw callback is persisted for audit.
 */
export async function applyMomoStatus(
  referenceId: string,
  status: "PENDING" | "SUCCESSFUL" | "FAILED",
  rawPayload?: unknown
) {
  const payment = await prisma.payment.findFirst({
    where: { providerRef: referenceId, provider: "MTN_MOMO" },
    include: { order: true },
  });
  if (!payment) return null;

  // Once a payment is PAID, inbound callbacks cannot move it.
  if (payment.status === "PAID") {
    return payment;
  }

  const payloadData = rawPayload !== undefined ? { rawPayload: rawPayload as object } : {};

  if (status === "SUCCESSFUL") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "PAID", ...payloadData } }),
      // Only advance the order if it's still awaiting this payment; never
      // downgrade an order that's already been settled another way.
      prisma.order.updateMany({
        where: { id: payment.orderId, paymentStatus: "AWAITING" },
        data: { paymentStatus: "PAID" },
      }),
    ]);
  } else if (status === "FAILED") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "UNPAID", ...payloadData } }),
      prisma.order.updateMany({
        where: { id: payment.orderId, paymentStatus: "AWAITING" },
        data: { paymentStatus: "UNPAID" },
      }),
    ]);
  } else if (rawPayload !== undefined) {
    await prisma.payment.update({ where: { id: payment.id }, data: payloadData });
  }

  return payment;
}

/**
 * Polls MTN directly instead of trusting a callback body — used by the
 * webhook (defence in depth) and for manual reconciliation.
 */
export async function syncMomoPayment(referenceId: string): Promise<MomoTransaction> {
  const tx = await momo.getTransactionStatus(referenceId);
  await applyMomoStatus(referenceId, tx.status, tx);
  return tx;
}
