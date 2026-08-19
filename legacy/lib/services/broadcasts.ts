import { prisma } from "../db";

export async function listSegments() {
  return prisma.broadcastSegment.findMany({
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });
}

/**
 * Records a broadcast as sent. Segment membership (which customers are
 * actually in "Friday regulars", etc.) isn't modeled yet — this is a Todo
 * for whenever that targeting logic gets built — so this stores the
 * message but doesn't fan it out over WhatsApp on its own.
 */
export async function createBroadcastMessage(segmentId: string, body: string) {
  return prisma.broadcastMessage.create({
    data: { segmentId, body, status: "sent", sentAt: new Date() },
  });
}
