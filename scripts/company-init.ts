/**
 * Initialise the owners' real company workspace (`TAU_WORKSPACE=company`).
 *
 * Creates `.tau/company-snapshot.json` from `buildCompanyWorkspace()` — an EMPTY set of books
 * with the finance bible's unknowns left explicit — and prints the setup checklist summary.
 * Refuses to overwrite an existing snapshot unless `--force` is passed (that discards every
 * entry the owners have made).
 *
 * Usage: npm run company:init -- [--force] [--as-of 2026-09-11]
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { COMPANY_SNAPSHOT_PATH, buildCompanyWorkspace, hasBookData } from "@/lib/db/workspace";
import { createLabRuntime, seedKnowledgeInto } from "@/lib/db/runtime";
import { MemoryStore } from "@/lib/db/memory-store";
import { bibleSummary, blockedCapabilities, unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { mergedConfigFields } from "@/lib/ui/config";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const force = flag("force");
  const asOfDate = arg("as-of");
  if (existsSync(COMPANY_SNAPSHOT_PATH) && !force) {
    const existing = MemoryStore.fromSnapshot(COMPANY_SNAPSHOT_PATH);
    const ds = existing ? await existing.load() : null;
    console.log(`Company snapshot already exists at ${COMPANY_SNAPSHOT_PATH}`);
    if (ds) console.log(`  ${ds.transactions.length} transactions · ${ds.journalEntries.length} journal entries · ${ds.bankAccounts.length} bank accounts · ${ds.cards.length} cards · ${ds.auditEvents.length} audit events`);
    console.log("  Refusing to overwrite. Re-run with --force to discard these entries and start over.");
    process.exit(2);
  }
  if (existsSync(COMPANY_SNAPSHOT_PATH) && force) {
    const backup = `${COMPANY_SNAPSHOT_PATH}.${Date.now()}.bak`;
    renameSync(COMPANY_SNAPSHOT_PATH, backup);
    console.log(`--force: previous company snapshot moved to ${backup}`);
  }
  mkdirSync(dirname(COMPANY_SNAPSHOT_PATH), { recursive: true });
  const dataset = seedKnowledgeInto(buildCompanyWorkspace({ asOfDate }));
  const store = new MemoryStore(dataset, COMPANY_SNAPSHOT_PATH);
  const rt = await createLabRuntime({ store, skipRetrieval: true, asOfDate });
  await rt.audit.record({ actor: { type: "SYSTEM", id: "company-init", role: "SYSTEM" }, workflowVersion: "company-init:v1", eventType: "COMPANY_WORKSPACE_INITIALISED", explanation: "Company workspace created empty: no bank, card, payroll or accounting connection; books contain only what the owners enter or import." });
  await store.flush();

  const merged = mergedConfigFields(rt.bible, dataset.configFields);
  const registry = unknownsRegistry(merged);
  const open = registry.filter((r) => r.status !== "CONFIRMED");
  const blocked = blockedCapabilities(merged);
  const summary = bibleSummary(merged);

  console.log(`Company workspace initialised as of ${rt.asOfDate}`);
  console.log(`  snapshot: ${COMPANY_SNAPSHOT_PATH}`);
  console.log(`  profile:  ${dataset.profile.displayName} (isSynthetic=${dataset.profile.isSynthetic})`);
  console.log(`  books:    ${hasBookData(dataset) ? "posted entries present" : "EMPTY — cash and balances are UNKNOWN until data is entered or imported"}`);
  console.log(`  chart:    ${dataset.accounts.length} accounts (PROPOSED template, UNCONFIRMED until the CPA confirms)`);
  console.log(`  workers:  ${dataset.workers.length} placeholders (${dataset.workers.filter((w) => w.classificationStatus !== "CONFIRMED").length} awaiting cross-border professional review)`);
  console.log(`  bible:    ${summary.total} fields — ${summary.CONFIRMED} confirmed · ${summary.UNCONFIRMED} unconfirmed · ${summary.PROFESSIONAL_REVIEW_REQUIRED} professional review`);
  console.log(`\nSetup checklist: ${registry.length - open.length}/${registry.length} items confirmed, ${open.length} open; ${Object.keys(blocked).length} capabilities blocked.`);
  const byWho = new Map<string, string[]>();
  for (const item of open) byWho.set(item.whoCanAnswer, [...(byWho.get(item.whoCanAnswer) ?? []), item.label]);
  for (const [who, labels] of byWho) console.log(`  ${who} (${labels.length}): ${labels.join("; ")}`);
  console.log("\nNext steps:");
  console.log("  1. Start the console with TAU_WORKSPACE=company (e.g. `TAU_WORKSPACE=company npm run dev`).");
  console.log("  2. On /company add your bank accounts and cards, then answer the OWNER setup items.");
  console.log("  3. On /transactions use “Add transaction” (or an import) to enter bank/card activity; categorise from the exception queue.");
  console.log("  4. On /accounting → Journal use “New entry” for opening balances (DRAFT; posting goes through approval).");
  console.log("  5. Send the CPA list from /company to your CPA. Nothing is assumed until confirmed.");
  console.log("  NOTE: Phase Two is read-only — no bank, card, payroll or accounting connection exists; nothing moves money.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
