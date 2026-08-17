import { prisma } from "../db";
import type { InboundWhatsAppMessage } from "../integrations/whatsapp";
import { findOrCreateCustomerByPhone } from "./customers";

/**
 * Persists an inbound WhatsApp message against its customer.
 *
 * This is also the hook point for an AI auto-reply: after saving the
 * message, a future `generateAndSendReply(customer, message)` call would
 * go here, using the "Front desk (AI)" TeamMember as `repliedById`. Not
 * implemented yet — inbound messages currently just land in the inbox.
 */
export async function recordInboundWhatsAppMessage(msg: InboundWhatsAppMessage) {
  const customer = await findOrCreateCustomerByPhone(msg.from, msg.contactName);
  return prisma.message.create({
    data: {
      customerId: customer.id,
      direction: "INBOUND",
      body: msg.body,
      whatsappMessageId: msg.whatsappMessageId,
      createdAt: new Date(Number(msg.timestamp) * 1000),
    },
  });
}

export async function recordOutboundWhatsAppMessage(opts: {
  customerId: string;
  body: string;
  whatsappMessageId?: string;
  repliedById?: string;
}) {
  return prisma.message.create({
    data: {
      customerId: opts.customerId,
      direction: "OUTBOUND",
      body: opts.body,
      whatsappMessageId: opts.whatsappMessageId,
      repliedById: opts.repliedById,
    },
  });
}

export async function listRecentActivity(limit = 10) {
  return prisma.message.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { customer: true },
  });
}

/** A customer thread is "unanswered" when its most recent message is inbound. */
export async function countUnansweredThreads(): Promise<number> {
  const latestPerCustomer = await prisma.message.findMany({
    orderBy: { createdAt: "desc" },
    distinct: ["customerId"],
    select: { direction: true },
  });
  return latestPerCustomer.filter((m) => m.direction === "INBOUND").length;
}
