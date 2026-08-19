import { prisma } from "../db";

export async function listTeamWithTodayReplyCounts() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const members = await prisma.teamMember.findMany({
    orderBy: [{ isAi: "desc" }, { name: "asc" }],
    include: {
      _count: {
        select: { messages: { where: { direction: "OUTBOUND", createdAt: { gte: startOfDay } } } },
      },
    },
  });

  return members.map((m) => ({
    id: m.id,
    name: m.name,
    isAi: m.isAi,
    active: m.active,
    repliesToday: m._count.messages,
  }));
}
