import { describe, expect, it } from "vitest";
import { weekStart } from "@/lib/core/dates";
import { buildWeeklyBrief, renderWeeklyBriefMarkdown, wordCount } from "@/lib/workflows";
import { AS_OF, IDS, makeFixtureRuntime } from "./fixture";

const SECTIONS = ["cashToday", "thirteenWeekLowestCash", "revenueReceived", "revenueExpected", "expenses", "payrollUpcoming", "billsUpcoming", "taxObligations", "budgetVsActual", "forecastChanges", "topAnomalies", "topDecisions", "missingInformation", "recommendedActions", "executiveSummary", "calcIds", "sourceIds", "generatedAt", "asOf", "isSyntheticData"] as const;

describe("weekly brief", () => {
  it("has every section, a short plain-language summary, and marks synthetic data", async () => {
    const rt = await makeFixtureRuntime();
    const brief = await buildWeeklyBrief(rt, AS_OF);
    for (const s of SECTIONS) expect(brief, `section ${s}`).toHaveProperty(s);
    expect(brief.isSyntheticData).toBe(true);
    expect(brief.asOf).toBe(AS_OF);
    const words = wordCount(brief.executiveSummary);
    expect(words).toBeGreaterThan(40);
    expect(words).toBeLessThanOrEqual(300);
    expect(brief.executiveSummary).toMatch(/SYNTHETIC DATA/);
    expect(brief.executiveSummary).toMatch(/\$[\d,]+\.\d{2}/); // fmtMoney formatting
    expect(brief.executiveSummary).toMatch(/no cash reserve policy is set/);
  });

  it("derives every number from the ledger and persists the calculations", async () => {
    const rt = await makeFixtureRuntime();
    const brief = await buildWeeklyBrief(rt, AS_OF);
    const checking = rt.ledger.accountBalance("acct_1000", AS_OF);
    const savings = rt.ledger.accountBalance("acct_1010", AS_OF);
    expect(brief.cashToday.accounts.map((a) => a.balance)).toEqual([checking, savings]);
    expect(brief.cashToday.total).toBe(rt.ledger.balanceSheet(AS_OF).cash);
    expect(brief.thirteenWeekLowestCash.weekStart).toBe(weekStart(brief.thirteenWeekLowestCash.weekStart));
    expect(brief.thirteenWeekLowestCash.minimumCash).toBeNull();
    expect(brief.revenueExpected.invoices.some((i) => i.id === IDS.augInvoice && i.daysPastDue > 0)).toBe(true);
    expect(brief.revenueExpected.overdueTotal).toBe("30000.0000");
    expect(brief.revenueReceived.monthToDate).toBe("0.0000");
    expect(brief.expenses.monthToDate.byAccount.length).toBeGreaterThan(0);
    expect(brief.payrollUpcoming.nextPayDates[0]?.date).toBe("2026-09-15");
    expect(brief.billsUpcoming.bills.map((b) => b.id)).toEqual([IDS.bill]);
    expect(brief.taxObligations.known).toHaveLength(0);
    expect(brief.taxObligations.pending.length).toBeGreaterThan(0);
    expect(brief.taxObligations.pending[0].note).toMatch(/pending authoritative source/);
    expect(brief.budgetVsActual.budgetId).toBe(IDS.budget);
    expect(brief.forecastChanges.note).toMatch(/No ACTIVE forecast/);
    expect(brief.topAnomalies.length).toBeLessThanOrEqual(3);
    expect(brief.topAnomalies.every((a) => a.severity !== "INFO")).toBe(true);
    expect(brief.topDecisions).toHaveLength(0);
    expect(brief.missingInformation.setupItems.length).toBeGreaterThan(0);
    expect(brief.recommendedActions.length).toBeGreaterThan(0);
    expect(brief.calcIds.length).toBeGreaterThan(5);
    for (const id of brief.calcIds) expect(rt.dataset.calculations.some((c) => c.id === id), `calc ${id} persisted`).toBe(true);
  });

  it("renders markdown with every section heading", async () => {
    const rt = await makeFixtureRuntime();
    const md = renderWeeklyBriefMarkdown(await buildWeeklyBrief(rt, AS_OF));
    for (const h of ["Executive summary", "Cash today", "Revenue", "Expenses", "Payroll upcoming", "Bills upcoming", "Tax obligations", "Budget vs actual", "Forecast changes", "Top anomalies", "Top decisions", "Missing information", "Recommended actions"]) expect(md).toContain(`## ${h}`);
    expect(md).toContain("SYNTHETIC DATA");
  });
});
