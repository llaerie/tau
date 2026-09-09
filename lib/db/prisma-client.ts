import { PrismaClient } from "@prisma/client";

/**
 * Singleton PrismaClient. Next.js dev mode hot-reloads modules, which would otherwise open a
 * new connection pool on every reload — so the instance is cached on `globalThis`.
 */
const globalForPrisma = globalThis as unknown as { __tauPrisma?: PrismaClient };

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.__tauPrisma) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set; the postgres store requires a PostgreSQL connection string");
    }
    globalForPrisma.__tauPrisma = new PrismaClient({
      log: process.env.TAU_PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
    });
  }
  return globalForPrisma.__tauPrisma;
}

/** Disconnect and drop the cached client (tests / scripts). */
export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.__tauPrisma;
  if (!client) return;
  globalForPrisma.__tauPrisma = undefined;
  await client.$disconnect();
}
