import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  // Cap the per-process connection pool. This app runs as two load-balanced
  // instances against a shared Supabase Session pooler whose total client
  // limit is 15; an uncapped pg pool (default max 10) across both processes
  // can exceed that and get connections rejected (EMAXCONNSESSION). DB_POOL_MAX
  // lets ops tune it; the default keeps 2 instances × 5 = 10 under the cap.
  const max = Number(process.env.DB_POOL_MAX) || 5;
  const adapter = new PrismaPg({ connectionString, max, connectionTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
