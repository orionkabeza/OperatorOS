import { prisma } from "../db";

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { name: "asc" } });
}

export async function setProductHidden(id: string, hidden: boolean) {
  return prisma.product.update({ where: { id }, data: { hidden } });
}
