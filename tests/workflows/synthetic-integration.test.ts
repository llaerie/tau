/** Integration: the whole workflow layer against the generated synthetic company (lib/synthetic). */
import { beforeAll, describe, expect, it } from "vitest";
import { createLabRuntime, type LabRuntime } from "@/lib/db/runtime";
import { buildAttentionQueue } from "@/lib/monitors";
import { DEFAULT_AS_OF_DATE, OWNER_ACTOR, generateSyntheticCompany } from "@/lib/synthetic";
import { AI_ASSUMPTION_LABEL, CLOSE_STEPS, buildCpaPackage, buildWeeklyBrief, financialHealth, renderWeeklyBriefMarkdown, runMonthEndClose, wordCount } from "@/lib/workflows";

const AS_OF = DEFAULT_AS_OF_DATE;

async function runtime(): Promise<LabRuntime> {
  return createLabRuntime({ dataset: generateSyntheticCompany({ asOfDate: AS_OF }), asOfDate: AS_OF, skipRetrieval: true });
}

describe("workflows × synthetic company", () => {
  let rt: LabRuntime;
  beforeAll(async () => {
    rt = await runtime();
  });

  it("builds a deterministic, non-empty attention queue with the structural INFO items", async () => {
    const queue = await buildAttentionQueue(rt, AS_OF);
    expect(queue.length).toBeGreaterThan(5);
    const kinds = new Set(queue.map((i) => i.kind));
    expect(kinds).toContain("finance_setup_incomplete");
    expect(kinds).toContain("tax_deadline_approaching");
    expect(kinds).toContain("international_worker_review");
    expect(queue.every((i) => i.kind !== "monitor_error")).toBe(true);
    // Monthly payroll on the last day: nothing within 7 days of Sep 9, but visible from Sep 25.
    expect(kinds).not.toContain("payroll_upcoming");
    const late = await buildAttentionQueue(rt, "2026-09-25");
    expect(late.find((i) => i.kind === "payroll_upcoming")?.dueDate).toBe("2026-09-30");
    expect(queue.filter((i) => i.kind === "low_projected_cash").every((i) => i.severity === "INFO" || /negative/.test(i.title))).toBe(true);
    const again = await buildAttentionQueue(await runtime(), AS_OF);
    expect(again.map((i) => i.id)).toEqual(queue.map((i) => i.id));
  });

  it("produces the weekly brief and health card from ledger figures", async () => {
    const brief = await buildWeeklyBrief(rt, AS_OF);
    expect(brief.isSyntheticData).toBe(true);
    expect(brief.cashToday.total).toBe(rt.ledger.balanceSheet(AS_OF).cash);
    expect(wordCount(brief.executiveSummary)).toBeLessThanOrEqual(300);
    expect(brief.payrollUpcoming.cadence).toBe("MONTHLY");
    expect(brief.payrollUpcoming.lastRunId).toBeDefined();
    expect(brief.budgetVsActual.budgetId).toBeDefined();
    // Forecast comparison is reported either way: a change vs the ACTIVE forecast, or an explicit "no ACTIVE forecast" note.
    const active = rt.dataset.forecasts.find((f) => f.status === "ACTIVE");
    if (active) expect(brief.forecastChanges.activeForecastId).toBe(active.id);
    else expect(brief.forecastChanges.note).toMatch(/No ACTIVE forecast/);
    expect(renderWeeklyBriefMarkdown(brief)).toContain("SYNTHETIC DATA");
    const health = await financialHealth(rt, AS_OF);
    expect(health.cash.minimumReserve).toBeNull();
    expect(health.integrityPassed.value).toBe(true);
    expect(health.budgetVariance.value).not.toBeNull();
  });

  it("runs the 21-step close on the prior (open) month without posting anything", async () => {
    const period = "2026-08";
    expect(rt.dataset.periods.find((p) => p.id === period)?.status).toBe("OPEN");
    const postedBefore = rt.dataset.journalEntries.filter((e) => e.status === "POSTED").length;
    const result = await runMonthEndClose(rt, period, OWNER_ACTOR);
    expect(result.steps.map((s) => s.key)).toEqual(CLOSE_STEPS.map((s) => s.key));
    expect(result.steps[16].status).toBe("PASSED"); // auditor agrees with controller
    expect(result.statements?.balanceSheet.balanced).toBe(true);
    expect(result.statements?.cashFlowStatement.reconciled).toBe(true);
    expect(result.locked).toBe(false);
    expect(rt.dataset.journalEntries.filter((e) => e.status === "POSTED").length).toBe(postedBefore);
    for (const id of result.draftedEntryIds) expect(rt.dataset.journalEntries.find((e) => e.id === id)?.status).toBe("DRAFT");
    expect(rt.dataset.auditEvents.find((e) => e.id === result.auditEventId)?.eventType).toBe("MONTH_END_CLOSE_RUN");
    expect(result.cpaPackageId).toMatch(/^cpapkg_/);
    expect(rt.audit.verifyChain().valid).toBe(true);
  });

  it("reports an already LOCKED period as locked and never drafts into it", async () => {
    const locked = rt.dataset.periods.filter((p) => p.status === "LOCKED").map((p) => p.id).sort();
    expect(locked.length).toBeGreaterThan(0);
    const result = await runMonthEndClose(rt, locked[0], OWNER_ACTOR, { lock: true, skipSteps: ["cpa_package"] });
    expect(result.steps[18].status).toBe("PASSED");
    expect(result.locked).toBe(true);
    expect(result.draftedEntryIds.filter((id) => rt.dataset.journalEntries.find((e) => e.id === id)?.periodId === locked[0])).toHaveLength(0);
    expect(rt.dataset.periods.find((p) => p.id === locked[0])?.status).toBe("LOCKED");
  });

  it("builds the CPA package for the year to date with labelled assumptions", async () => {
    const pkg = await buildCpaPackage(rt, "2026-01-01", AS_OF);
    expect(pkg.isSyntheticData).toBe(true);
    expect(pkg.trialBalance.balanced).toBe(true);
    expect(pkg.generalLedger.count).toBeGreaterThan(50);
    expect(pkg.payrollReports.runs.length).toBeGreaterThan(5);
    expect(pkg.internationalWorkerQuestions.length).toBe(2);
    expect(pkg.agentGeneratedAssumptions.every((a) => a.label === AI_ASSUMPTION_LABEL)).toBe(true);
    expect(pkg.taxWorkpapers.every((w) => w.cpaReviewRequired)).toBe(true);
    expect(pkg.coverMemo).toContain("SYNTHETIC");
  });
});
