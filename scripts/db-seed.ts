/**
 * Seed PostgreSQL with the synthetic lab company.
 * Usage: npm run db:seed   (requires DATABASE_URL; run `db:push` and `db:rls` first)
 *
 * Environment: TAU_SYNTHETIC_SEED (default 20260101), TAU_AS_OF_DATE (default today, UTC).
 * Audit history already in the database is retained (reset() never truncates audit_events).
 */
import { generateSyntheticCompany } from "@/lib/synthetic";
import { PrismaStore } from "@/lib/db/prisma-store";
import { disconnectPrisma } from "@/lib/db/prisma-client";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const seed = Number(process.env.TAU_SYNTHETIC_SEED ?? "20260101");
  const asOfDate = process.env.TAU_AS_OF_DATE ?? new Date().toISOString().slice(0, 10);

  const dataset = generateSyntheticCompany({ seed, asOfDate });
  if (!dataset.profile.isSynthetic) throw new Error("Refusing to seed: dataset is not labelled synthetic");

  const store = new PrismaStore();
  const started = Date.now();
  await store.reset(dataset);
  const counts = Object.entries(dataset)
    .filter(([k]) => k !== "profile")
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
    .join(" ");
  console.log(`Seeded ${dataset.profile.displayName} (seed=${seed}, asOf=${asOfDate}) in ${Date.now() - started}ms`);
  console.log(counts);
}

main()
  .then(() => disconnectPrisma())
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await disconnectPrisma();
    process.exit(1);
  });
