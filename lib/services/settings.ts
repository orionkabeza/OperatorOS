import { prisma } from "../db";

export async function getSettings() {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: 1 } });
}

export async function updateSettings(patch: {
  currency?: string;
  showAiLabels?: boolean;
  openingHours?: string;
  languages?: string;
}) {
  await getSettings();
  return prisma.settings.update({ where: { id: 1 }, data: patch });
}
