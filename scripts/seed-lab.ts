/**
 * Seed (or reseed) the Phase One training lab with the synthetic company.
 * Usage: npm run lab:seed -- [--seed 20260101] [--as-of 2026-09-09]
 */
import { generateSyntheticCompany } from "@/lib/synthetic";
import { createLabRuntime, seedKnowledgeInto } from "@/lib/db/runtime";
import { LAB_SNAPSHOT_PATH, MemoryStore } from "@/lib/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const seed = arg("seed") ? Number(arg("seed")) : undefined;
  const asOfDate = arg("as-of");
  const dataset = seedKnowledgeInto(generateSyntheticCompany({ seed, asOfDate }));
  const store = new MemoryStore(dataset, LAB_SNAPSHOT_PATH);
  const rt = await createLabRuntime({ store, skipRetrieval: true });
  const integrity = rt.ledger.runIntegrityChecks(rt.asOfDate);
  await store.flush();
  console.log(`Seeded synthetic company "${dataset.profile.displayName}" as of ${rt.asOfDate}`);
  console.log(`  accounts=${dataset.accounts.length} entries=${dataset.journalEntries.length} transactions=${dataset.transactions.length} invoices=${dataset.invoices.length} bills=${dataset.bills.length} payrollRuns=${dataset.payrollRuns.length} documents=${dataset.documents.length}`);
  console.log(`  integrity: ${integrity.passed ? "PASSED" : "FAILED"} (${integrity.checks.filter((c) => !c.passed).map((c) => c.key).join(", ") || "no failures"})`);
  console.log(`  snapshot: ${LAB_SNAPSHOT_PATH}`);
  console.log("  NOTE: this is SYNTHETIC lab data. No live financial accounts are connected.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
