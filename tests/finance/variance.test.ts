import { describe, expect, it } from "vitest";
import type { Budget, Forecast } from "@/lib/core/types";
import { buildChartOfAccounts, accountIdForCode, ACCT } from "@/lib/accounting/chart-of-accounts";
import { budgetVariance, cagr, forecastVariance, growthRate, type ActualsByAccountMonth } from "@/lib/finance/variance";

const accounts = buildChartOfAccounts();
const REV = accountIdForCode(ACCT.SERVICE_REVENUE);
const SW = accountIdForCode(ACCT.SOFTWARE);
const RENT = accountIdForCode(ACCT.RENT);

const budget: Budget = {
  id: "budget_1", name: "FY26", fiscalYear: 2026, version: 1, status: "APPROVED", createdAt: "2026-01-01T00:00:00Z", assumptions: [],
  lines: [
    { accountId: REV, month: "2026-07", amount: "10000" },
    { accountId: SW, month: "2026-07", amount: "1000" },
    { accountId: RENT, month: "2026-07", amount: "2000" },
    { accountId: REV, month: "2026-08", amount: "10000" },
  ],
};

describe("budget variance", () => {
  it("applies sign conventions, flags material lines, and totals", () => {
    const actuals: ActualsByAccountMonth = { [REV]: { "2026-07": "12000", "2026-08": "9000" }, [SW]: { "2026-07": "1500" }, [RENT]: { "2026-07": "2000" } };
    const r = budgetVariance(actuals, budget, { accounts, materialityRatio: 0.1, materialityAmount: "1500", asOfDate: "2026-08-31" });
    const rows = r.value.rows;
    const rev7 = rows.find((x) => x.accountId === REV && x.month === "2026-07")!;
    expect(rev7.variance).toBe("2000.0000");
    expect(rev7.variancePct).toBe(0.2);
    expect(rev7.favorable).toBe(true); // revenue above budget
    expect(rev7.flagged).toBe(true);
    const rev8 = rows.find((x) => x.accountId === REV && x.month === "2026-08")!;
    expect(rev8.favorable).toBe(false);
    expect(rev8.flagged).toBe(false); // -10% is not > 10%, |1000| < 1500
    const sw = rows.find((x) => x.accountId === SW)!;
    expect(sw.variance).toBe("500.0000");
    expect(sw.favorable).toBe(false); // expense above budget
    expect(sw.flagged).toBe(true); // 50%
    const rent = rows.find((x) => x.accountId === RENT)!;
    expect(rent.variance).toBe("0.0000");
    expect(rent.favorable).toBeNull();
    expect(rent.flagged).toBe(false);
    expect(r.value.summary.netVariance).toBe("500.0000"); // +1000 revenue, +500 expense
    expect(r.value.summary.flaggedCount).toBe(2);
    expect(r.value.byMonth.find((m) => m.key === "2026-07")?.variance).toBe("2500.0000");
    expect(r.sourceIds).toContain("budget_1");
  });

  it("expense below budget is favorable; actual with no budget flagged", () => {
    const actuals: ActualsByAccountMonth = { [SW]: { "2026-07": "800", "2026-09": "300" } };
    const r = budgetVariance(actuals, budget, { accounts, materialityRatio: 0.5, months: ["2026-07", "2026-09"] });
    const sw7 = r.value.rows.find((x) => x.accountId === SW && x.month === "2026-07")!;
    expect(sw7.favorable).toBe(true);
    expect(sw7.flagged).toBe(false);
    const sw9 = r.value.rows.find((x) => x.accountId === SW && x.month === "2026-09")!;
    expect(sw9.variancePct).toBeNull();
    expect(sw9.flagged).toBe(true);
  });

  it("forecast variance compares only FORECAST-basis lines", () => {
    const forecast: Forecast = {
      id: "fc_1", name: "fc", asOfDate: "2026-06-30", horizonMonths: 2, drivers: {}, status: "ACTIVE", version: 1, createdAt: "", createdBy: "t", calcIds: [],
      lines: [{ accountId: REV, month: "2026-06", amount: "9000", basis: "ACTUAL" }, { accountId: REV, month: "2026-07", amount: "10000", basis: "FORECAST" }],
    };
    const r = forecastVariance({ [REV]: { "2026-06": "9000", "2026-07": "11000" } }, forecast, { accounts });
    expect(r.value.rows.map((x) => x.month)).toEqual(["2026-06", "2026-07"]);
    expect(r.value.rows.find((x) => x.month === "2026-06")?.budget).toBe("0.0000");
    expect(r.value.rows.find((x) => x.month === "2026-07")?.variance).toBe("1000.0000");
  });
});

describe("growth rates", () => {
  const asOfDate = "2026-09-09";
  it("period-over-period", () => {
    expect(growthRate({ current: "110", prior: "100", asOfDate }).value).toBe(0.1);
    expect(growthRate({ current: "90", prior: "100", asOfDate }).value).toBe(-0.1);
    expect(growthRate({ current: "50", prior: "-100", asOfDate }).value).toBe(1.5);
  });
  it("zero prior → null note; unknown → insufficient", () => {
    expect(growthRate({ current: "10", prior: "0", asOfDate }).value).toBeNull();
    const r = growthRate({ current: "10", prior: null, asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("INSUFFICIENT_INFORMATION: prior period value");
  });
  it("CAGR: 100 → 200 over 2 periods ≈ 41.42%", () => {
    expect(cagr({ beginning: "100", ending: "200", periods: 2, asOfDate }).value as number).toBeCloseTo(0.414214, 6);
    expect(cagr({ beginning: "-100", ending: "200", periods: 2, asOfDate }).value).toBeNull();
  });
});
