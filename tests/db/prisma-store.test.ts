/**
 * PrismaStore integration test. Skips itself when no database is configured or reachable:
 *   TAU_TEST_DATABASE_URL=postgresql://tau:tau@localhost:5432/tau_cfo npx vitest run tests/db
 * (DATABASE_URL is used as a fallback.) WARNING: reset() truncates every data table except
 * audit_events in the target database — point it at the lab database, never at real data.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionName, CompanyDataset } from "@/lib/core/types";
import { PrismaStore } from "@/lib/db/prisma-store";
import { RLS_SQL_PATH, splitSqlStatements } from "../../scripts/db-apply-rls";
import { makeAuditEvent, makeTinyDataset } from "./fixture";

const url = process.env.TAU_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
let client: PrismaClient | null = null;
if (url) {
  const candidate = new PrismaClient({ datasourceUrl: url });
  try {
    await candidate.$queryRaw`SELECT 1`;
    client = candidate;
  } catch {
    await candidate.$disconnect();
  }
}
if (!client) console.warn("[tests/db] DATABASE_URL unset or unreachable — skipping PrismaStore integration tests");

const COLLECTIONS = Object.keys(makeTinyDataset()).filter((k) => k !== "profile") as CollectionName[];

function keyOf(collection: CollectionName, e: unknown): string {
  const r = e as Record<string, unknown>;
  if (collection === "configFields") return `${r.section}::${r.key}`;
  if (collection === "competencyScores") return String(r.capabilityKey);
  return String(r.id);
}
const sorted = (collection: CollectionName, arr: unknown[]) =>
  [...arr].sort((a, b) => keyOf(collection, a).localeCompare(keyOf(collection, b)));

/** Unique-per-run audit event so repeated test runs never collide on the immutable log. */
const runStamp = Date.now();
const runAudit = (n: number) =>
  makeAuditEvent(1_000_000 + (runStamp % 1_000_000) * 10 + n, {
    id: `aud_run_${runStamp}_${n}`,
    hash: `hash_run_${runStamp}_${n}`,
    previousHash: n === 0 ? "hash_0002" : `hash_run_${runStamp}_${n - 1}`,
  });

describe.skipIf(!client)("PrismaStore (PostgreSQL)", () => {
  const prisma = client as PrismaClient;
  let store: PrismaStore;
  let dataset: CompanyDataset;

  beforeAll(async () => {
    // Safety: reset() truncates data tables. Never run against a database holding a real company.
    const existing = await prisma.companyProfile.findFirst();
    if (existing && !existing.isSynthetic) throw new Error("Refusing to run: database company profile is not synthetic");
    const statements = splitSqlStatements(readFileSync(RLS_SQL_PATH, "utf8"));
    for (const s of statements) await prisma.$executeRawUnsafe(s);
    store = new PrismaStore(prisma);
    dataset = makeTinyDataset();
    await store.reset(dataset);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reset → load round-trips every collection exactly (fresh store, no cache)", async () => {
    const fresh = new PrismaStore(prisma);
    const loaded = await fresh.load();
    const expected = makeTinyDataset();
    expect(loaded.profile).toEqual(expected.profile);
    for (const c of COLLECTIONS) {
      if (c === "auditEvents") continue; // never truncated; checked separately
      expect(sorted(c, loaded[c]), c).toEqual(sorted(c, expected[c]));
    }
    expect(loaded.auditEvents).toEqual(expect.arrayContaining(expected.auditEvents));
    // journal lines: exact decimal strings, exact order
    expect(loaded.journalEntries.map((e) => e.lines.map((l) => [l.accountId, l.debit, l.credit]))).toEqual(
      expected.journalEntries.map((e) => e.lines.map((l) => [l.accountId, l.debit, l.credit])),
    );
    expect(loaded.journalEntries[0].lines[0].debit).toBe("123456789012.3456");
    expect(await fresh.load()).toBe(loaded); // cached object identity
  });

  it("stores money as NUMERIC(19,4) and journal lines in their own table", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string; data_type: string; numeric_precision: number; numeric_scale: number }[]>`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns WHERE table_name = 'journal_lines' AND column_name IN ('debit', 'credit')`;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect([r.data_type, r.numeric_precision, r.numeric_scale]).toEqual(["numeric", 19, 4]);
    expect(await prisma.journalLine.count()).toBe(5);
  });

  it("upsert replaces nested journal lines in a transaction and updates the live dataset", async () => {
    const live = await store.load();
    const entry = live.journalEntries.find((e) => e.id === "je_0002")!;
    entry.status = "POSTED";
    entry.postedAt = "2026-02-15T00:00:00.000Z";
    entry.lines = [
      { id: "jl_0002_1", accountId: "acct_7300", debit: "50.0000", credit: "0.0000", currency: "USD" },
      { id: "jl_0002_9", accountId: "acct_2000", debit: "0.0000", credit: "50.0000", currency: "USD", memo: "replaced" },
    ];
    await store.upsert("journalEntries", entry);
    await store.upsertMany("vendors", [{ ...live.vendors[0], id: "vendor_new", name: "New Vendor" }]);
    expect(live.vendors.map((v) => v.id)).toEqual(["vendor_saas", "vendor_new"]);

    const reloaded = await new PrismaStore(prisma).load();
    expect(reloaded.journalEntries.find((e) => e.id === "je_0002")).toEqual(entry);
    expect(await prisma.journalLine.count({ where: { entryId: "je_0002" } })).toBe(2);
    expect(reloaded.vendors.map((v) => v.id).sort()).toEqual(["vendor_new", "vendor_saas"]);

    await expect(store.upsert("auditEvents", makeAuditEvent(1))).rejects.toThrow(/append-only/);
  });

  it("appendAudit is insert-only: the same id can never be appended twice", async () => {
    const evt = runAudit(0);
    await store.appendAudit(evt);
    await expect(store.appendAudit(evt)).rejects.toThrow(/already exists/);
    // A fresh store instance (empty cache) hits the database unique constraint instead.
    await expect(new PrismaStore(prisma).appendAudit(evt)).rejects.toThrow(/immutable log/);
    // Same hash under a different id is also refused (hash-chain integrity).
    await expect(store.appendAudit({ ...runAudit(1), hash: evt.hash })).rejects.toThrow(/immutable log/);
    expect((await store.load()).auditEvents.some((e) => e.id === evt.id)).toBe(true);
  });

  it("raw UPDATE / DELETE / TRUNCATE on audit_events raise via trigger", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_events SET explanation = 'tampered' WHERE id = 'aud_0001'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE id = 'aud_0001'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events`)).rejects.toThrow(/append-only/);
    const row = await prisma.auditEvent.findUnique({ where: { id: "aud_0001" } });
    expect(row?.explanation).toBe("Proposed categorization");
  });

  it("reset retains the audit trail and merges it into the new dataset", async () => {
    const appended = runAudit(2);
    await store.appendAudit(appended);
    const next = makeTinyDataset();
    next.auditEvents = [];
    await store.reset(next);
    const live = await store.load();
    expect(live).toBe(next);
    expect(live.auditEvents.map((e) => e.id)).toEqual(expect.arrayContaining(["aud_0001", "aud_0002", appended.id]));
    expect(live.auditEvents.every((e, i, arr) => i === 0 || arr[i - 1].seq <= e.seq)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { id: appended.id } })).toBe(1);
  });

  it("row-level security hides payroll detail from roles without VIEW_PAYROLL_DETAIL", async () => {
    const countAs = (role: string | null) =>
      prisma.$transaction(async (tx) => {
        if (role) await tx.$executeRawUnsafe(`SET LOCAL app.role = '${role}'`);
        const [runs, workers, liabilities, accounts] = await Promise.all([
          tx.payrollRun.count(),
          tx.worker.count(),
          tx.payrollLiability.count(),
          tx.account.count(),
        ]);
        return { runs, workers, liabilities, accounts };
      });
    expect(await countAs(null)).toEqual({ runs: 1, workers: 2, liabilities: 1, accounts: 6 });
    expect(await countAs("CPA")).toEqual({ runs: 1, workers: 2, liabilities: 1, accounts: 6 });
    expect(await countAs("PAYROLL_PROFESSIONAL")).toEqual({ runs: 1, workers: 2, liabilities: 1, accounts: 6 });
    expect(await countAs("VIEWER")).toEqual({ runs: 0, workers: 0, liabilities: 0, accounts: 6 });
    expect(await countAs("FINANCE_OPERATOR")).toEqual({ runs: 0, workers: 0, liabilities: 0, accounts: 6 });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.role = 'VIEWER'`);
        await tx.payrollRun.update({ where: { id: "pr_2026_01" }, data: { providerRef: "leak" } });
      }),
    ).rejects.toThrow();
    expect((await prisma.payrollRun.findUnique({ where: { id: "pr_2026_01" } }))?.providerRef).toBe("SYN-PR-1");
  });
});
