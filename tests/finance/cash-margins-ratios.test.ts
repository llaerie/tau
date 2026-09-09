import { describe, expect, it } from "vitest";
import type { BalanceSheet, IncomeStatement } from "@/lib/core/contracts";
import { burnRate, cashReserveCoverage, cashRunway, currentRatio, quickRatio, workingCapital } from "@/lib/finance/cash";
import { grossMargin, netMargin, operatingMargin } from "@/lib/finance/margins";
import { daysSalesOutstanding, ratioPack, revenuePerEmployee } from "@/lib/finance/ratios";

const asOfDate = "2026-09-09";

describe("burn rate & runway", () => {
  it("averages net outflow from monthly balances", () => {
    const r = burnRate({ asOfDate, months: 3, monthlyCashBalances: [
      { month: "2026-05", balance: "100000" },
      { month: "2026-06", balance: "90000" },
      { month: "2026-07", balance: "85000" },
      { month: "2026-08", balance: "70000" },
    ] });
    // flows: -10000, -5000, -15000 → avg outflow 10000
    expect(r.value).toBe("10000.0000");
    expect(r.inputs.monthsUsed).toBe(3);
  });
  it("uses net cash flows directly and notes short history", () => {
    const r = burnRate({ asOfDate, months: 3, monthlyNetCashFlows: [{ month: "2026-07", netFlow: "-4000" }, { month: "2026-08", netFlow: "-6000" }] });
    expect(r.value).toBe("5000.0000");
    expect(r.notes?.[0]).toContain("Only 2 of the requested 3 months");
  });
  it("no history → null with INSUFFICIENT_INFORMATION (never zero)", () => {
    const r = burnRate({ asOfDate, monthlyNetCashFlows: [] });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toMatch(/^INSUFFICIENT_INFORMATION/);
    expect(r.assumptions[0].status).toBe("UNCONFIRMED");
  });
  it("runway = cash / burn", () => {
    expect(cashRunway({ cash: "50000", burnRate: "10000", asOfDate }).value).toBe(5);
  });
  it("cash-flow positive → null with note", () => {
    const r = cashRunway({ cash: "50000", burnRate: "-2000", asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("cash-flow positive");
  });
  it("unknown cash → insufficient", () => {
    const r = cashRunway({ cash: null, burnRate: "10000", asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("INSUFFICIENT_INFORMATION: cash balance");
  });
});

describe("reserve coverage & liquidity", () => {
  it("unknown reserve policy → insufficient", () => {
    const r = cashReserveCoverage({ cash: "80000", minimumReserve: null, asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("minimum cash reserve policy");
  });
  it("coverage ratio and shortfall", () => {
    const r = cashReserveCoverage({ cash: "80000", minimumReserve: "100000", asOfDate, policyStatus: "UNCONFIRMED" });
    expect(r.value?.surplus).toBe("-20000.0000");
    expect(r.value?.coverageRatio).toBe(0.8);
    expect(r.value?.meetsPolicy).toBe(false);
    expect(r.assumptions[0].status).toBe("UNCONFIRMED");
  });
  const bs: BalanceSheet = {
    kind: "BALANCE_SHEET", asOfDate, lines: [{ code: "1100", label: "Accounts Receivable", amount: "30000.0000", level: 1 }],
    totalAssets: "200000", totalLiabilities: "50000", totalEquity: "150000", currentAssets: "120000", currentLiabilities: "40000", cash: "80000", currentYearEarnings: "0", balanced: true, difference: "0",
  };
  it("working capital / current ratio / quick ratio from a balance sheet", () => {
    expect(workingCapital(bs).value).toBe("80000.0000");
    expect(currentRatio(bs).value).toBe(3);
    expect(quickRatio(bs).value).toBe(2.75);
    expect(quickRatio(bs).asOfDate).toBe(asOfDate);
  });
  it("quick ratio with explicit numbers and unknown AR → insufficient", () => {
    expect(quickRatio({ cash: "10", accountsReceivable: "10", currentLiabilities: "5", asOfDate }).value).toBe(4);
    const r = quickRatio({ cash: "10", accountsReceivable: null, currentLiabilities: "5", asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("accounts receivable");
  });
});

describe("margins", () => {
  const is: IncomeStatement = {
    kind: "INCOME_STATEMENT", fromDate: "2026-01-01", toDate: "2026-06-30", lines: [], revenue: "200000", costOfRevenue: "50000", grossProfit: "150000", operatingExpenses: "100000", operatingIncome: "50000", otherIncomeExpense: "-10000", netIncome: "40000", calcIds: ["calc_is"],
  };
  it("from an income statement", () => {
    expect(grossMargin(is).value).toBe(0.75);
    expect(operatingMargin(is).value).toBe(0.25);
    expect(netMargin(is).value).toBe(0.2);
    expect(grossMargin(is).asOfDate).toBe("2026-06-30");
    expect(grossMargin(is).sourceIds).toEqual(["calc_is"]);
  });
  it("from explicit numbers; unknown → insufficient; zero revenue → undefined", () => {
    expect(grossMargin({ revenue: "1000", costOfRevenue: "400" }, { asOfDate }).value).toBe(0.6);
    const unknown = grossMargin({ revenue: "1000", costOfRevenue: null }, { asOfDate });
    expect(unknown.value).toBeNull();
    expect(unknown.notes?.[0]).toContain("INSUFFICIENT_INFORMATION");
    expect(netMargin({ revenue: "0", netIncome: "5" }, { asOfDate }).value).toBeNull();
  });
});

describe("ratio pack", () => {
  it("computes DSO / DPO / CCC and reports unknowns per ratio", () => {
    const pack = ratioPack({ asOfDate, periodDays: 365, revenue: "365000", costOfRevenue: "73000", operatingExpenses: "109500", headcount: null, accountsReceivable: "30000", accountsPayable: "10000" });
    const byName = Object.fromEntries(pack.ratios.map((r) => [r.name, r]));
    expect(byName.gross_margin.value).toBe(0.8);
    expect(byName.opex_ratio.value).toBe(0.3);
    expect(byName.days_sales_outstanding.value).toBe(30);
    expect(byName.days_payable_outstanding.value).toBe(20);
    expect(byName.cash_conversion_cycle.value).toBe(10);
    expect(byName.revenue_per_employee.value).toBeNull();
    expect(byName.revenue_per_employee.notes?.[0]).toContain("INSUFFICIENT_INFORMATION: headcount");
    expect(pack.summary.value.revenue_per_employee).toBeNull();
    expect(daysSalesOutstanding("30000", "0", 365, { asOfDate }).value).toBeNull();
    expect(revenuePerEmployee("365000", 4, { asOfDate }).value).toBe("91250.0000");
  });
});
