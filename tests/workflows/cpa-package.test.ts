import { describe, expect, it } from "vitest";
import { AI_ASSUMPTION_LABEL, buildCpaPackage, ingestCpaFeedback, renderCpaPackageMarkdown } from "@/lib/workflows";
import { CPA_ACTOR, IDS, OWNER, VIEWER, makeFixtureRuntime } from "./fixture";

const SECTIONS = ["trialBalance", "generalLedger", "incomeStatement", "balanceSheet", "cashFlowStatement", "bankReconciliations", "payrollReports", "shareholderSummary", "fixedAssetSchedule", "arAging", "apAging", "significantJournalEntries", "taxWorkpapers", "missingDocuments", "unresolvedAccountingQuestions", "transactionsRequiringTaxGuidance", "internationalWorkerQuestions", "agentGeneratedAssumptions", "coverMemo", "generatedAt", "isSyntheticData", "calcIds"] as const;

describe("CPA package", () => {
  it("has every section and labels AI-generated assumptions", async () => {
    const rt = await makeFixtureRuntime();
    const pkg = await buildCpaPackage(rt, "2026-06-01", "2026-08-31");
    for (const s of SECTIONS) expect(pkg, `section ${s}`).toHaveProperty(s);
    expect(pkg.isSyntheticData).toBe(true);
    expect(pkg.id).toMatch(/^cpapkg_/);
    expect(pkg.generalLedger.count).toBeGreaterThan(35);
    expect(pkg.generalLedger.entries.every((e) => e.lines.every((l) => /^\d{4}$/.test(l.accountCode)))).toBe(true);
    expect(pkg.trialBalance.balanced).toBe(true);
    expect(pkg.balanceSheet.balanced).toBe(true);
    expect(pkg.bankReconciliations).toHaveLength(3);
    expect(pkg.payrollReports.runs).toHaveLength(6);
    expect(pkg.payrollReports.byQuarter.map((q) => q.quarter)).toEqual(["2026-Q2", "2026-Q3"]);
    expect(pkg.shareholderSummary.distributions).toBe("4000.0000");
    expect(pkg.shareholderSummary.note).toMatch(/professional judgment/);
    expect(pkg.fixedAssetSchedule.assets.map((a) => a.asset.id)).toEqual([IDS.asset]);
    expect(pkg.arAging.overdueTotal).toBe("30000.0000");
    expect(pkg.apAging.total).toBe("1500.0000");
    expect(pkg.significantJournalEntries.some((e) => e.reasons.some((r) => /restricted/.test(r)))).toBe(true);
    expect(pkg.significantJournalEntries.some((e) => e.reasons.some((r) => /red amount/.test(r)))).toBe(true);
    expect(pkg.taxWorkpapers.map((w) => w.jurisdiction)).toEqual(["FEDERAL", "CALIFORNIA"]);
    expect(pkg.taxWorkpapers.every((w) => w.cpaReviewRequired)).toBe(true);
    expect(pkg.transactionsRequiringTaxGuidance.some((t) => t.transactionId === IDS.mealTx)).toBe(true);
    expect(pkg.transactionsRequiringTaxGuidance.some((t) => t.transactionId === IDS.dellTx)).toBe(true);
    expect(pkg.internationalWorkerQuestions.map((w) => w.workerId)).toEqual([IDS.cn1]);
    expect(pkg.unresolvedAccountingQuestions.some((q) => q.source === "OPEN_EXCEPTION" && /[Ss]uspense/.test(q.question))).toBe(true);
    expect(pkg.unresolvedAccountingQuestions.some((q) => q.source === "CPA_QUEUE")).toBe(true);
    expect(pkg.agentGeneratedAssumptions.length).toBeGreaterThan(0);
    expect(pkg.agentGeneratedAssumptions.every((a) => a.label === AI_ASSUMPTION_LABEL && a.status !== "CONFIRMED" && a.calcId.startsWith("calc_"))).toBe(true);
    expect(pkg.coverMemo).toMatch(/FACTS/);
    expect(pkg.coverMemo).toMatch(/PROFESSIONAL JUDGMENT/);
    expect(pkg.coverMemo).toMatch(/SYNTHETIC/);
    expect(pkg.calcIds.length).toBeGreaterThan(5);
    for (const id of pkg.calcIds) expect(rt.dataset.calculations.some((c) => c.id === id)).toBe(true);
    expect(rt.dataset.taxWorkpapers.length).toBe(2);
    const md = renderCpaPackageMarkdown(pkg);
    for (const h of ["Trial balance", "General ledger", "Income statement", "Balance sheet", "Cash flow statement", "Bank and card reconciliations", "Payroll reports", "Shareholder summary", "Fixed asset schedule", "AR aging", "AP aging", "Significant journal entries", "Tax workpapers", "Missing documents", "Unresolved accounting questions", "Transactions requiring tax guidance", "International worker questions", AI_ASSUMPTION_LABEL]) expect(md).toContain(h);
  });
});

describe("CPA feedback ingestion", () => {
  const feedback = { author: "Synthetic CPA", title: "Meals documentation standard", body: "Every business meal needs an itemized receipt, the attendees and the business purpose.", appliesTo: ["meals", "expense_documentation"] };

  it("creates ACTIVE guidance and a versioned policy with an audit trail when a CPA approves", async () => {
    const rt = await makeFixtureRuntime();
    const priorMeals = rt.dataset.policies.filter((p) => p.key === "meals");
    expect(priorMeals.map((p) => p.version)).toEqual([1]);
    const result = await ingestCpaFeedback(rt, feedback, CPA_ACTOR);
    expect(result.guidance.status).toBe("ACTIVE");
    expect(result.guidance.authorRole).toBe("CPA");
    expect(result.guidance.approvedBy).toBe(`CPA:${CPA_ACTOR.id}`);
    expect(rt.guidance.get(result.guidance.id)?.status).toBe("ACTIVE");
    expect(rt.dataset.professionalGuidance.some((g) => g.id === result.guidance.id)).toBe(true);
    expect(result.policy?.key).toBe("meals");
    expect(result.policy?.version).toBe(2);
    expect(result.policy?.status).toBe("ACTIVE");
    expect(result.policy?.sourceGuidanceId).toBe(result.guidance.id);
    expect(result.supersededPolicies.map((p) => p.version)).toEqual([1]);
    const meals = rt.dataset.policies.filter((p) => p.key === "meals").sort((a, b) => a.version - b.version);
    expect(meals.map((p) => `${p.version}:${p.status}`)).toEqual(["1:SUPERSEDED", "2:ACTIVE"]);
    expect(rt.policies).toBe(rt.dataset.policies);
    const ev = rt.dataset.auditEvents.find((e) => e.id === result.auditEventId)!;
    expect(ev.eventType).toBe("CPA_FEEDBACK_INGESTED");
    expect(ev.finalAction).toMatch(/POLICY_PROMOTED meals v2/);
    expect(ev.afterState).toMatchObject({ guidanceStatus: "ACTIVE", policyVersion: 2 });
    expect(rt.audit.verifyChain().valid).toBe(true);
  });

  it("owner approval also promotes; a viewer only records pending guidance; agents are refused", async () => {
    const rt = await makeFixtureRuntime();
    const byOwner = await ingestCpaFeedback(rt, { ...feedback, appliesTo: ["related_party_transactions"] }, OWNER);
    expect(byOwner.policy?.version).toBe(2);
    const byViewer = await ingestCpaFeedback(rt, { ...feedback, title: "Second memo" }, VIEWER);
    expect(byViewer.guidance.status).toBe("PENDING_APPROVAL");
    expect(byViewer.policy).toBeNull();
    await expect(ingestCpaFeedback(rt, feedback, { type: "AGENT", id: "bookkeeping", role: "AGENT" })).rejects.toThrow(/human/);
  });
});
