import { prisma } from "../db";

export async function getSettings() {
  // Upsert rather than find-then-create: two servers hitting a fresh DB
  // simultaneously would both see null and both insert id=1, one hitting a
  // unique-constraint 500. Upsert collapses that race.
  return prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function updateSettings(patch: {
  currency?: string;
  showAiLabels?: boolean;
  openingHours?: string;
  languages?: string;
}) {
  return prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...patch }, update: patch });
}
