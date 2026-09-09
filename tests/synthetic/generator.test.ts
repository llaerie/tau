import { describe, expect, it } from "vitest";
import { Ledger } from "@/lib/accounting/ledger";
import { monthEnd } from "@/lib/core/dates";
import { stableStringify } from "@/lib/core/ids";
import { DEFAULT_AS_OF_DATE, LOCK_APPROVAL_ID, SYNTHETIC_DISPLAY_NAME, generateSyntheticCompany } from "@/lib/synthetic";
import { defaultDataset } from "./fixture";

describe("generateSyntheticCompany — shape and determinism", () => {
  it("is fully deterministic for the same seed and asOfDate", () => {
    const a = generateSyntheticCompany({ seed: 20260101 });
    const b = generateSyntheticCompany({ seed: 20260101 });
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different jittered amounts for a different seed but the same structure", () => {
    const a = defaultDataset();
    const b = generateSyntheticCompany({ seed: 7 });
    expect(b.transactions.length).toBeGreaterThan(0);
    expect(b.profile.displayName).toBe(a.profile.displayName);
    const awsA = a.transactions.filter((t) => t.descriptionRaw.startsWith("AMAZON WEB SERVICES")).map((t) => t.amount);
    const awsB = b.transactions.filter((t) => t.descriptionRaw.startsWith("AMAZON WEB SERVICES")).map((t) => t.amount);
    expect(awsA.length).toBe(awsB.length);
    expect(awsA).not.toEqual(awsB);
  });

  it("labels the company and entity facts as synthetic", () => {
    const ds = defaultDataset();
    expect(ds.profile.displayName).toBe(SYNTHETIC_DISPLAY_NAME);
    expect(ds.profile.displayName).toBe("Northlight AI Services LLC (SYNTHETIC)");
    expect(ds.profile.isSynthetic).toBe(true);
    expect(ds.profile.asOfDate).toBe(DEFAULT_AS_OF_DATE);
    for (const f of [ds.profile.entityType, ds.profile.taxElection, ds.profile.state, ds.profile.fiscalYearEnd, ds.profile.accountingMethod]) {
      expect(f.status).toBe("CONFIRMED");
      expect(f.synthetic).toBe(true);
      expect(f.value).not.toBeNull();
    }
    expect(ds.profile.state.value).toBe("CA");
    expect(ds.profile.taxElection.value).toBe("S_CORPORATION");
    expect(ds.profile.accountingMethod.value).toBe("ACCRUAL");
    expect(ds.profile.functionalCurrency).toBe("USD");
    expect(ds.bankAccounts.every((b) => b.isSynthetic)).toBe(true);
    expect(ds.cards.every((c) => c.isSynthetic)).toBe(true);
    expect(ds.workers.every((w) => w.isSynthetic)).toBe(true);
    expect(ds.documents.every((d) => d.isSynthetic)).toBe(true);
    expect(ds.transactions.every((t) => t.meta?.isSynthetic === true)).toBe(true);
    expect(ds.configFields).toEqual([]);
    expect(ds.taxRules).toEqual([]);
    expect(ds.forecasts).toEqual([]);
    expect(ds.scenarios).toEqual([]);
    expect(ds.policies).toEqual([]);
    expect(ds.calculations).toEqual([]);
  });

  it("covers at least 12 full months of transactions plus the current partial month", () => {
    const ds = defaultDataset();
    const months = new Set(ds.transactions.map((t) => t.date.slice(0, 7)));
    const full = [...months].filter((m) => monthEnd(`${m}-01`) <= ds.profile.asOfDate);
    expect(full.length).toBeGreaterThanOrEqual(12);
    expect(months.has("2025-06")).toBe(true);
    expect(months.has("2026-09")).toBe(true);
    expect(ds.transactions.every((t) => t.date <= ds.profile.asOfDate)).toBe(true);
    expect(ds.transactions.every((t) => t.date >= "2025-06-01")).toBe(true);
    expect(ds.periods.map((p) => p.id)).toEqual([
      "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
  });

  it("has the expected company shape", () => {
    const ds = defaultDataset();
    expect(ds.bankAccounts.map((b) => b.glAccountId).sort()).toEqual(["acct_1000", "acct_1010"]);
    expect(ds.cards.map((c) => c.glAccountId)).toEqual(["acct_2050"]);
    expect(ds.workers).toHaveLength(5);
    expect(ds.customers).toHaveLength(2);
    const harbor = ds.customers.find((c) => c.name === "Harbor Analytics Group")!;
    expect(harbor.relatedParty).toBe(true);
    expect(harbor.relatedPartyNote).toBe("payer associated with CEO's father — related-party review");
    expect(harbor.contractDocumentId).toBeDefined();
    expect(ds.documents.find((d) => d.id === harbor.contractDocumentId)?.kind).toBe("CONTRACT");
    expect(ds.vendors.some((v) => v.taxDocStatus === "UNKNOWN")).toBe(true);
    expect(ds.fixedAssets).toHaveLength(2);
    expect(ds.budgets.map((b) => b.fiscalYear).sort()).toEqual([2025, 2026]);
    expect(ds.budgets.every((b) => b.status === "APPROVED")).toBe(true);
    expect(ds.taxObligations.filter((t) => t.status === "UNKNOWN").every((t) => t.dueDate === null)).toBe(true);
    const ftb = ds.taxObligations.find((t) => t.kind === "CA_FRANCHISE_TAX")!;
    expect(ftb.status).toBe("PAID");
    expect(ftb.amount).toBe("800.0000");
    expect(ftb.ruleSourceId).toBeUndefined();
    expect(ftb.notes).toContain("amount taken from bank record, not from a rule");
    const nec = ds.taxObligations.find((t) => t.kind === "1099_NEC")!;
    expect(nec.requiresCpaReview).toBe(true);
    expect(nec.notes).toContain("worker classification unresolved");
  });

  it("closes history: two earliest months LOCKED with an approval, older months SOFT_CLOSED, current and prior OPEN", () => {
    const ds = defaultDataset();
    const status = Object.fromEntries(ds.periods.map((p) => [p.id, p.status]));
    expect(status["2025-06"]).toBe("LOCKED");
    expect(status["2025-07"]).toBe("LOCKED");
    for (const m of ["2025-08", "2025-12", "2026-03", "2026-07"]) expect(status[m]).toBe("SOFT_CLOSED");
    expect(status["2026-08"]).toBe("OPEN");
    expect(status["2026-09"]).toBe("OPEN");
    for (const p of ds.periods.filter((x) => x.status === "LOCKED")) {
      expect(p.lockApprovalId).toBe(LOCK_APPROVAL_ID);
      const approval = ds.approvals.find((a) => a.id === p.lockApprovalId);
      expect(approval?.status).toBe("APPROVED");
      expect(approval?.action.kind).toBe("LOCK_PERIOD");
      expect(p.lockedAt).toBeDefined();
      for (const e of ds.journalEntries.filter((e) => e.periodId === p.id)) expect(e.postedAt! < p.lockedAt!).toBe(true);
    }
    const ledger = new Ledger(ds);
    expect(() => ledger.createEntry({ date: "2025-06-15", description: "late", source: "MANUAL", lines: [{ accountCode: "7000", debit: "1" }, { accountCode: "1000", credit: "1" }], post: true }, { type: "USER", id: "x", role: "OWNER" })).toThrow();
  });

  it("has statements, receipts, entity documents and payroll reports", () => {
    const ds = defaultDataset();
    const kinds = (k: string) => ds.documents.filter((d) => d.kind === k);
    expect(kinds("BANK_STATEMENT").length).toBe(15 * 2);
    expect(kinds("CARD_STATEMENT").length).toBe(15);
    expect(kinds("BANK_STATEMENT").every((d) => d.storagePath.startsWith("synthetic://statements/"))).toBe(true);
    expect(kinds("PAYROLL_REPORT").length).toBe(ds.payrollRuns.length);
    expect(kinds("ENTITY_DOCUMENT").length).toBe(2);
    expect(kinds("INSURANCE").length).toBe(1);
    expect(kinds("CPA_CORRESPONDENCE").length).toBe(1);
    expect(kinds("CUSTOMER_INVOICE").length).toBe(ds.invoices.length);
    expect(kinds("VENDOR_BILL").length).toBe(ds.bills.length);
    expect(kinds("W9").length).toBe(0);
    const card = ds.cards[0];
    const bigCharges = ds.transactions.filter((t) => t.sourceAccountId === card.id && Number(t.amount) < -75 && !t.flags.includes("TRANSFER"));
    const withReceipt = bigCharges.filter((t) => t.documentIds.some((id) => ds.documents.find((d) => d.id === id)?.kind === "RECEIPT"));
    const coverage = withReceipt.length / bigCharges.length;
    expect(coverage).toBeGreaterThan(0.7);
    expect(coverage).toBeLessThan(1);
    for (const d of ds.documents) {
      for (const txId of d.linkedTransactionIds) expect(ds.transactions.find((t) => t.id === txId)?.documentIds).toContain(d.id);
    }
  });

  it("supports a different asOfDate end to end", () => {
    const ds = generateSyntheticCompany({ seed: 3, asOfDate: "2026-03-31" });
    expect(ds.profile.asOfDate).toBe("2026-03-31");
    expect(ds.periods[0].id).toBe("2024-12");
    const report = new Ledger(ds).runIntegrityChecks("2026-03-31");
    expect(report.checks.filter((c) => !c.passed && c.severity === "ERROR")).toEqual([]);
    expect(ds.groundTruth.length).toBeGreaterThan(20);
  });
});
