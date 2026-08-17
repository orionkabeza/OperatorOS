import { prisma } from "../db";
import { serializeCustomer } from "../serialize";

export async function listCustomers() {
  const customers = await prisma.customer.findMany({
    include: { orders: true },
    orderBy: { name: "asc" },
  });
  return customers.map(serializeCustomer);
}

export async function findOrCreateCustomerByPhone(phone: string, name?: string) {
  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing) return existing;
  return prisma.customer.create({ data: { phone, name: name || phone } });
}
