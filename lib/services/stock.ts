import { prisma } from "../db";

export async function listStock() {
  return prisma.stockItem.findMany({ orderBy: { name: "asc" } });
}

export async function setStockQuantity(id: string, quantity: number) {
  return prisma.stockItem.update({ where: { id }, data: { quantity } });
}
