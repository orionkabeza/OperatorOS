import crypto from "node:crypto";
import { prisma } from "../db";
import * as airtel from "../integrations/airtel";
import * as momo from "../integrations/momo";

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
 */
export async function initiateMomoPayment(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { customer: true },
  });

  const referenceId = crypto.randomUUID();
  await momo.requestToPay({
    amount: order.total,
    payerPhone: order.customer.phone,
    externalId: order.id,
    payerMessage: `Order #${order.number} at Auntie Efua's Kitchen`,
    payeeNote: `Order #${order.number}`,
    referenceId,
    callbackUrl: buildMomoCallbackUrl(referenceId),
  });

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

  return { referenceId };
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

/** Applies a MoMo status update (from the webhook or a manual poll) to the matching Payment + Order. */
export async function applyMomoStatus(referenceId: string, status: "PENDING" | "SUCCESSFUL" | "FAILED") {
  const payment = await prisma.payment.findFirst({ where: { providerRef: referenceId, provider: "MTN_MOMO" } });
  if (!payment) return null;

  if (status === "SUCCESSFUL") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "PAID" } }),
      prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "PAID" } }),
    ]);
  } else if (status === "FAILED") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "UNPAID" } }),
      prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "UNPAID" } }),
    ]);
  }

  return payment;
}

/** Polls MTN directly instead of waiting for the callback — useful when no public callback URL is configured. */
export async function syncMomoPayment(referenceId: string) {
  const tx = await momo.getTransactionStatus(referenceId);
  await applyMomoStatus(referenceId, tx.status);
  return tx;
}
