/**
 * Company workspace: the owners' real (empty) books. Nothing synthetic may leak in, nothing may be
 * fabricated, and resetting it must be an explicit, deliberate act.
 */
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDataset } from "@/lib/core/types";
import { CN_REVIEW_FIELDS } from "@/lib/knowledge/international-review";
import { unknownsRegistry, UNKNOWN_ITEM_SPECS } from "@/lib/knowledge/finance-bible";
import { buildCompanyProfile, buildCompanyWorkspace, CHART_TEMPLATE_STATUS_KEY, COMPANY_DISPLAY_NAME, currentWorkspace, hasBookData } from "@/lib/db/workspace";
import { createLabRuntime, resetRuntime, seedKnowledgeInto, snapshotPathFor } from "@/lib/db/runtime";
import { MemoryStore } from "@/lib/db/memory-store";
import { addFinancialAccount, addManualTransaction, createManualJournalEntry, requireManualEntryRole } from "@/lib/ui/manual-entry";
import { getField } from "@/lib/knowledge/finance-bible";
import type { Actor } from "@/lib/core/types";

const AS_OF = "2026-09-11";

describe("buildCompanyWorkspace", () => {
  const ds = buildCompanyWorkspace({ asOfDate: AS_OF });

  it("is the real company: not synthetic, name unconfirmed, confirmed facts only where the bible confirms them", () => {
    expect(ds.profile.isSynthetic).toBe(false);
    expect(ds.profile.id).toBe("company");
    expect(ds.profile.displayName).toBe(COMPANY_DISPLAY_NAME);
    expect(ds.profile.entityType).toMatchObject({ value: "LLC", status: "CONFIRMED", synthetic: false });
    expect(ds.profile.taxElection).toMatchObject({ value: "S_CORPORATION", status: "CONFIRMED" });
    expect(ds.profile.state).toMatchObject({ value: "CA", status: "CONFIRMED" });
    expect(ds.profile.fiscalYearEnd).toMatchObject({ value: null, status: "UNCONFIRMED" });
    expect(ds.profile.accountingMethod).toMatchObject({ value: null, status: "UNCONFIRMED" });
    expect(ds.profile.functionalCurrency).toBe("USD");
    expect(ds.profile.asOfDate).toBe(AS_OF);
  });

  it("holds no transactions, entries, periods, bank accounts, cards, payroll or invoices — nothing fabricated", () => {
    for (const key of ["transactions", "journalEntries", "periods", "bankAccounts", "cards", "invoices", "bills", "payments", "payrollRuns", "payrollLiabilities", "documents", "budgets", "forecasts", "fixedAssets", "vendors", "approvals", "auditEvents"] as const) {
      expect(ds[key], key).toEqual([]);
    }
    expect(hasBookData(ds)).toBe(false);
  });

  it("uses the proposed chart of accounts and records that it is an UNCONFIRMED template", () => {
    expect(ds.accounts.length).toBeGreaterThan(30);
    const flag = ds.configFields.find((f) => f.key === CHART_TEMPLATE_STATUS_KEY);
    expect(flag).toMatchObject({ status: "UNCONFIRMED", value: "PROPOSED_TEMPLATE", synthetic: false, requiredConfirmer: "CPA" });
  });

  it("carries the REAL finance bible (no synthetic fields) with the 26 setup unknowns still open", () => {
    expect(ds.configFields.every((f) => f.synthetic === false)).toBe(true);
    expect(ds.configFields.some((f) => f.updatedBy === "SYNTHETIC_GENERATOR")).toBe(false);
    const registry = unknownsRegistry(ds.configFields);
    expect(registry).toHaveLength(26);
    expect(UNKNOWN_ITEM_SPECS).toHaveLength(26);
    expect(registry.filter((r) => r.status !== "CONFIRMED")).toHaveLength(26);
    expect(registry.every((r) => r.status === "UNCONFIRMED" || r.status === "PROFESSIONAL_REVIEW_REQUIRED")).toBe(true);
    // Null means unknown — never zero.
    const unknownFields = ds.configFields.filter((f) => f.status === "UNCONFIRMED" && f.value === null);
    expect(unknownFields.length).toBeGreaterThan(30);
    expect(ds.configFields.some((f) => f.value === 0 || f.value === "0" || f.value === "0.00")).toBe(false);
  });

  it("has the five known workers as placeholders, with compensation per the bible and no invented amounts", () => {
    expect(ds.workers.map((w) => w.displayName)).toEqual(["Owner", "Finance Operator (fiancée)", "US employee 1", "China-based worker 1", "China-based worker 2"]);
    expect(ds.workers.every((w) => w.isSynthetic === false && w.roleTitle === "UNCONFIRMED")).toBe(true);
    const [owner, fiancee, us, cn1, cn2] = ds.workers;
    expect(owner).toMatchObject({ isOwner: true, relatedParty: true, compensation: { amount: "3000.0000", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED" } });
    expect(fiancee).toMatchObject({ relatedParty: true, compensation: { amount: "3000.0000", basis: "GROSS", status: "UNCONFIRMED" } });
    expect(us.compensation).toMatchObject({ amount: "", basis: "UNKNOWN", status: "UNCONFIRMED" });
    for (const cn of [cn1, cn2]) {
      expect(cn).toMatchObject({ country: "CN", workerType: "UNRESOLVED", classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW", payMethod: "UNKNOWN" });
      expect(cn.compensation).toMatchObject({ amount: "", basis: "UNKNOWN", status: "UNCONFIRMED" });
      expect(cn.internationalReview?.status).toBe("INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED");
      expect(cn.internationalReview?.fields).toHaveLength(CN_REVIEW_FIELDS.length);
      expect(cn.internationalReview?.fields.map((f) => f.key.split(".").pop())).toEqual(CN_REVIEW_FIELDS.map((f) => f.key));
      expect(cn.internationalReview?.fields.every((f) => f.value === null && f.status === "PROFESSIONAL_REVIEW_REQUIRED" && f.synthetic === false)).toBe(true);
    }
  });

  it("has exactly one customer: the related-party payer with its disclosure note", () => {
    expect(ds.customers).toHaveLength(1);
    expect(ds.customers[0]).toMatchObject({ name: "Primary services customer (entity unconfirmed)", relatedParty: true, active: true });
    expect(ds.customers[0].relatedPartyNote).toMatch(/father/);
  });

  it("defaults asOfDate to today and is JSON round-trippable", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(buildCompanyWorkspace().profile.asOfDate).toBe(today);
    expect(JSON.parse(JSON.stringify(ds))).toEqual(ds);
  });
});

describe("seedKnowledgeInto", () => {
  it("never injects the synthetic profile or synthetic guidance into a non-synthetic dataset", () => {
    const ds = seedKnowledgeInto(buildCompanyWorkspace({ asOfDate: AS_OF }));
    expect(ds.configFields.some((f) => f.synthetic)).toBe(false);
    expect(ds.professionalGuidance).toEqual([]);
    expect(ds.knowledgeSources.length).toBeGreaterThan(0);
    expect(ds.policies.length).toBeGreaterThan(0);
  });

  it("seeds the real bible (not the synthetic profile) when a non-synthetic dataset has no config fields", () => {
    const ds = seedKnowledgeInto(emptyDataset(buildCompanyProfile(AS_OF)));
    expect(ds.configFields.length).toBeGreaterThan(50);
    expect(ds.configFields.every((f) => f.synthetic === false)).toBe(true);
  });

  it("still seeds the synthetic profile and example guidance for the synthetic lab", () => {
    const profile = { ...buildCompanyProfile(AS_OF), id: "synthetic", displayName: "Synthetic Co", isSynthetic: true };
    const ds = seedKnowledgeInto(emptyDataset(profile));
    expect(ds.configFields.some((f) => f.synthetic)).toBe(true);
    expect(ds.professionalGuidance).toHaveLength(1);
  });
});

describe("workspace selection and reset guard", () => {
  const prev = process.env.TAU_WORKSPACE;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tau-workspace-test-"));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.TAU_WORKSPACE;
    else process.env.TAU_WORKSPACE = prev;
  });

  it("defaults to the lab and maps snapshot paths per workspace", () => {
    delete process.env.TAU_WORKSPACE;
    expect(currentWorkspace()).toBe("lab");
    process.env.TAU_WORKSPACE = "company";
    expect(currentWorkspace()).toBe("company");
    process.env.TAU_WORKSPACE = "COMPANY ";
    expect(currentWorkspace()).toBe("company");
    process.env.TAU_WORKSPACE = "something-else";
    expect(currentWorkspace()).toBe("lab");
    expect(snapshotPathFor("company")).toMatch(/company-snapshot\.json$/);
    expect(snapshotPathFor("lab")).toMatch(/lab-snapshot\.json$/);
    expect(snapshotPathFor("company")).not.toBe(snapshotPathFor("lab"));
  });

  it("company mode falls back to the empty company workspace, never the synthetic generator, and marks the runtime", async () => {
    process.env.TAU_WORKSPACE = "company";
    const snapshotPath = join(dir, "company-snapshot.json");
    const rt = await createLabRuntime({ storeOptions: { snapshotPath }, skipRetrieval: true, asOfDate: AS_OF });
    expect(rt.workspace).toBe("company");
    expect(rt.dataset.profile.isSynthetic).toBe(false);
    expect(rt.dataset.transactions).toEqual([]);
    expect(rt.dataset.configFields.some((f) => f.synthetic)).toBe(false);
    expect(rt.asOfDate).toBe(AS_OF);
    await rt.flush();
    expect(existsSync(snapshotPath)).toBe(true);
    // A restart restores the company snapshot rather than regenerating anything.
    const again = await createLabRuntime({ storeOptions: { snapshotPath }, skipRetrieval: true });
    expect(again.dataset.profile.id).toBe("company");
    expect(again.dataset.profile.isSynthetic).toBe(false);
  });

  it("a real company's as-of date is today — the lab's TAU_AS_OF_DATE never freezes it", async () => {
    const prevAsOf = process.env.TAU_AS_OF_DATE;
    const prevCompanyAsOf = process.env.TAU_COMPANY_AS_OF_DATE;
    process.env.TAU_AS_OF_DATE = "2026-01-15";
    delete process.env.TAU_COMPANY_AS_OF_DATE;
    try {
      const rt = await createLabRuntime({ store: new MemoryStore(buildCompanyWorkspace({ asOfDate: "2026-01-01" })), skipRetrieval: true });
      expect(rt.asOfDate).toBe(new Date().toISOString().slice(0, 10));
      process.env.TAU_COMPANY_AS_OF_DATE = "2026-03-03";
      const pinned = await createLabRuntime({ store: new MemoryStore(buildCompanyWorkspace({ asOfDate: "2026-01-01" })), skipRetrieval: true });
      expect(pinned.asOfDate).toBe("2026-03-03");
    } finally {
      if (prevAsOf === undefined) delete process.env.TAU_AS_OF_DATE;
      else process.env.TAU_AS_OF_DATE = prevAsOf;
      if (prevCompanyAsOf === undefined) delete process.env.TAU_COMPANY_AS_OF_DATE;
      else process.env.TAU_COMPANY_AS_OF_DATE = prevCompanyAsOf;
    }
  });

  it("resetRuntime refuses in the company workspace without explicit confirmation", async () => {
    process.env.TAU_WORKSPACE = "company";
    const snapshotPath = join(dir, "company-snapshot.json");
    await expect(resetRuntime({ storeOptions: { snapshotPath }, skipRetrieval: true })).rejects.toThrow(/Refusing to reset the company workspace/);
    await expect(resetRuntime({ storeOptions: { snapshotPath }, skipRetrieval: true, confirmCompanyReset: false })).rejects.toThrow(/confirmCompanyReset/);
    const rt = await resetRuntime({ storeOptions: { snapshotPath }, skipRetrieval: true, confirmCompanyReset: true, asOfDate: AS_OF });
    expect(rt.workspace).toBe("company");
    expect(rt.dataset.journalEntries).toEqual([]);
  });

  it("resetRuntime in the lab does not need the company confirmation", async () => {
    process.env.TAU_WORKSPACE = "lab";
    const snapshotPath = join(dir, "lab-snapshot.json");
    const rt = await resetRuntime({ storeOptions: { snapshotPath, fallbackDataset: seedKnowledgeInto(buildCompanyWorkspace({ asOfDate: AS_OF })) }, skipRetrieval: true, asOfDate: AS_OF });
    expect(rt.asOfDate).toBe(AS_OF);
  });
});

describe("manual entry path (company workspace)", () => {
  const OWNER: Actor = { type: "USER", id: "owner", role: "OWNER" };
  const OPERATOR: Actor = { type: "USER", id: "ops", role: "FINANCE_OPERATOR" };
  const VIEWER: Actor = { type: "USER", id: "v", role: "VIEWER" };
  const CPA: Actor = { type: "USER", id: "cpa", role: "CPA" };

  async function runtime() {
    return createLabRuntime({ store: new MemoryStore(seedKnowledgeInto(buildCompanyWorkspace({ asOfDate: AS_OF }))), skipRetrieval: true, asOfDate: AS_OF });
  }

  it("is restricted to OWNER and FINANCE_OPERATOR", () => {
    expect(() => requireManualEntryRole(OWNER)).not.toThrow();
    expect(() => requireManualEntryRole(OPERATOR)).not.toThrow();
    expect(() => requireManualEntryRole(VIEWER)).toThrow(/OWNER or FINANCE_OPERATOR/);
    expect(() => requireManualEntryRole(CPA)).toThrow(/OWNER or FINANCE_OPERATOR/);
  });

  it("registers bank accounts and cards (last4 only, unique GL mapping) and confirms the bible fields with an audit event", async () => {
    const rt = await runtime();
    expect(getField(rt.dataset.configFields, "bank_accounts.accounts")?.status).toBe("UNCONFIRMED");
    const before = rt.dataset.auditEvents.length;
    const { account, configField } = await addFinancialAccount(rt, OWNER, { kind: "BANK", name: "Operating Checking", institution: "Real Bank", accountType: "CHECKING", last4: "4321" });
    expect(account).toMatchObject({ institution: "Real Bank", last4: "4321", isSynthetic: false, glAccountId: "acct_1000" });
    expect(configField).toMatchObject({ key: "bank_accounts.accounts", status: "CONFIRMED", synthetic: false });
    expect((configField.value as { last4: string }[]).map((v) => v.last4)).toEqual(["4321"]);
    // Only the last four digits are ever stored (ids excluded from the check: they are random hex).
    expect(JSON.stringify((configField.value as { id: string }[]).map(({ id: _id, ...rest }) => rest))).not.toMatch(/\d{5,}/);
    expect(rt.dataset.auditEvents.slice(before).map((e) => e.eventType)).toEqual(["BANK_ACCOUNT_ADDED", "CONFIG_BANK_ACCOUNTS_CONFIRMED"]);
    // full numbers are refused
    await expect(addFinancialAccount(rt, OWNER, { kind: "BANK", name: "x", institution: "x", last4: "4111111111111111" })).rejects.toThrow(/exactly four digits/);
    // a second checking account auto-picks the next free cash GL account (1010), a third has none left
    const second = await addFinancialAccount(rt, OPERATOR, { kind: "BANK", name: "Second", institution: "Real Bank", last4: "0002" });
    expect(second.account.glAccountId).toBe("acct_1010");
    await expect(addFinancialAccount(rt, OWNER, { kind: "BANK", name: "Third", institution: "Real Bank", last4: "0003" })).rejects.toThrow(/extend the chart of accounts/);
    await expect(addFinancialAccount(rt, OWNER, { kind: "BANK", name: "Dup", institution: "Real Bank", last4: "0004", glAccountId: "1000" })).rejects.toThrow(/already mapped/);
    const card = await addFinancialAccount(rt, OWNER, { kind: "CARD", name: "Biz Visa", institution: "Card Co", last4: "9999" });
    expect(card.account.glAccountId).toBe("acct_2050");
    expect(getField(rt.dataset.configFields, "cards.cards")?.status).toBe("CONFIRMED");
    await expect(addFinancialAccount(rt, VIEWER, { kind: "CARD", name: "x", institution: "x", last4: "1234" })).rejects.toThrow(/OWNER or FINANCE_OPERATOR/);
  });

  it("enters a transaction as UNCATEGORIZED with an audit event; refuses unknown accounts and zero amounts", async () => {
    const rt = await runtime();
    await expect(addManualTransaction(rt, OWNER, { sourceAccountId: "nope", date: AS_OF, amount: "-10", description: "x" })).rejects.toThrow(/No bank account or card/);
    const { account } = await addFinancialAccount(rt, OWNER, { kind: "BANK", name: "Ops", institution: "Real Bank", last4: "1111" });
    await expect(addManualTransaction(rt, OWNER, { sourceAccountId: account.id, date: AS_OF, amount: "0", description: "x" })).rejects.toThrow(/non-zero/);
    await expect(addManualTransaction(rt, OWNER, { sourceAccountId: account.id, date: "11/09/2026", amount: "-10", description: "x" })).rejects.toThrow(/YYYY-MM-DD/);
    const tx = await addManualTransaction(rt, OPERATOR, { sourceAccountId: account.id, date: "2026-09-10", amount: "-125.5", description: "AWS hosting" });
    expect(tx).toMatchObject({ sourceKind: "BANK", amount: "-125.5000", currency: "USD", category: { accountId: null, status: "UNCATEGORIZED", confidence: 0 }, flags: ["UNCATEGORIZED"] });
    expect(rt.dataset.transactions).toHaveLength(1);
    expect(rt.dataset.auditEvents.at(-1)?.eventType).toBe("TRANSACTION_ENTERED_MANUALLY");
    // Entering a transaction does not post anything: cash stays unknown until an entry is posted.
    expect(hasBookData(rt.dataset)).toBe(false);
    await expect(addManualTransaction(rt, VIEWER, { sourceAccountId: account.id, date: AS_OF, amount: "-1", description: "x" })).rejects.toThrow(/OWNER or FINANCE_OPERATOR/);
  });

  it("creates DRAFT journal entries through the ledger (balanced, valid accounts) and never posts them", async () => {
    const rt = await runtime();
    await expect(createManualJournalEntry(rt, OWNER, { date: "2026-09-01", description: "bad", lines: [{ accountCode: "1000", debit: "10" }, { accountCode: "3000", credit: "5" }] })).rejects.toThrow(/does not balance/);
    await expect(createManualJournalEntry(rt, OWNER, { date: "2026-09-01", description: "bad", lines: [{ accountCode: "8888", debit: "10" }, { accountCode: "3000", credit: "10" }] })).rejects.toThrow(/no account with code 8888/);
    await expect(createManualJournalEntry(rt, OWNER, { date: "2026-09-01", description: "bad", lines: [{ accountCode: "1000", debit: "10", credit: "10" }, { accountCode: "3000", credit: "10" }] })).rejects.toThrow(/exactly one of debit or credit/);
    await expect(createManualJournalEntry(rt, OWNER, { date: "2026-09-01", description: "bad", lines: [{ accountCode: "1000", debit: "10" }] })).rejects.toThrow(/at least two lines/);
    const entry = await createManualJournalEntry(rt, OPERATOR, { date: "2026-09-01", description: "Opening balance — Operating Checking", lines: [{ accountCode: "1000", debit: "12500.00" }, { accountCode: "3000", credit: "12500.00" }] });
    expect(entry).toMatchObject({ status: "DRAFT", source: "MANUAL", periodId: "2026-09", createdBy: "ops" });
    expect(entry.tags).toEqual(expect.arrayContaining(["manual-entry", "restricted-account"]));
    expect(rt.dataset.periods.map((p) => p.id)).toEqual(["2026-09"]);
    expect(hasBookData(rt.dataset)).toBe(false);
    expect(rt.ledger.accountBalance("acct_1000", AS_OF)).toBe("0.0000");
    expect(rt.dataset.auditEvents.at(-1)?.eventType).toBe("JOURNAL_ENTRY_DRAFTED_MANUALLY");
    await expect(createManualJournalEntry(rt, VIEWER, { date: "2026-09-01", description: "x", lines: [{ accountCode: "1000", debit: "1" }, { accountCode: "3000", credit: "1" }] })).rejects.toThrow(/OWNER or FINANCE_OPERATOR/);
  });
});
