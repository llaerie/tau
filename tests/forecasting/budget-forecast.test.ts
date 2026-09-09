import { describe, expect, it } from "vitest";
import type { Scenario } from "@/lib/core/types";
import { ACCT } from "@/lib/accounting/chart-of-accounts";
import { D } from "@/lib/core/money";
import { actualsByAccountMonth, buildBudget, effectiveEmployerTaxRate } from "@/lib/forecasting/budget";
import { DRIVER_KEYS, assumedDriver, buildDefaultDrivers, detectPayrollCadence, expenseDriverKey, makeDriver, payrollDriversFromWorkers, projectPayDates } from "@/lib/forecasting/drivers";
import { applyScenario, forecastAccuracy, rollingForecast } from "@/lib/forecasting/forecast";
import type { PayrollRateAssumptionSet } from "@/lib/finance/headcount";
import type { ActualsByAccountMonth } from "@/lib/finance/variance";
import { A, AS_OF, buildFixtureDataset } from "./fixture";

const ds = buildFixtureDataset();
const REV = A(ACCT.SERVICE_REVENUE);
const SAL = A(ACCT.SALARIES);
const TAX = A(ACCT.EMPLOYER_PAYROLL_TAX);
const SW = A(ACCT.SOFTWARE);

describe("actualsByAccountMonth", () => {
  it("uses POSTED P&L entries only, signed positive revenue / positive expense", () => {
    const a = actualsByAccountMonth(ds, "2026-06-01", "2026-09-30");
    expect(a[REV]["2026-06"]).toBe("10000.0000");
    expect(a[REV]["2026-09"]).toBe("4000.0000");
    expect(a[SW]["2026-08"]).toBe("500.0000"); // DRAFT 999 ignored
    expect(a[SAL]["2026-07"]).toBe("9000.0000");
    expect(a[A(ACCT.AR)]).toBeUndefined(); // balance sheet accounts excluded
    expect(a[REV]["2024-01"]).toBeUndefined(); // outside range
  });
});

describe("drivers", () => {
  it("detects payroll cadence and projects pay dates", () => {
    const p = detectPayrollCadence(ds.payrollRuns);
    expect(p.cadence).toBe("SEMI_MONTHLY");
    expect(p.runsPerMonth).toBe(2);
    expect(projectPayDates(p, AS_OF, "2026-10-31")).toEqual(["2026-09-15", "2026-09-30", "2026-10-15", "2026-10-31"]);
    expect(detectPayrollCadence([]).cadence).toBe("UNKNOWN");
  });

  it("builds default drivers marking CONFIRMED (history) vs ASSUMED", () => {
    const r = buildDefaultDrivers(ds, AS_OF);
    const mrr = r.drivers[DRIVER_KEYS.MRR];
    expect(mrr.value).toBe("10000.0000");
    expect(mrr.status).toBe("CONFIRMED");
    expect(r.mrr.monthsUsed).toEqual(["2026-06", "2026-07", "2026-08"]);
    const growth = r.drivers[DRIVER_KEYS.REVENUE_GROWTH];
    expect(growth.status).toBe("UNCONFIRMED");
    expect(growth.note).toMatch(/^ASSUMED:/);
    expect(r.drivers[DRIVER_KEYS.PAYROLL_GROSS].value).toBe("9000.0000");
    expect(r.drivers[DRIVER_KEYS.PAYROLL_GROSS].status).toBe("CONFIRMED");
    expect(Number(r.drivers[DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE].value)).toBeCloseTo(350 / 4500, 9);
    expect(r.drivers[expenseDriverKey(SW, "github")].value).toBe("100.0000");
    expect(r.drivers[expenseDriverKey(A(ACCT.RENT), "wework")].value).toBe("2000.0000");
    expect(r.recurringVendors.map((v) => v.merchant)).toEqual(["github", "wework"]);
  });

  it("payroll drivers from workers skip unknown compensation with an assumption", () => {
    const w = payrollDriversFromWorkers(ds.workers, AS_OF);
    expect(w.monthlyGrossWages).toBe("13000.0000"); // 5000 + 96000/12; w_left excluded by end date
    expect(w.monthlyContractorFees).toBe("2000.0000");
    expect(w.excludedWorkerIds).toEqual(["w_unknown"]);
    expect(w.assumptions.some((a) => a.key === "worker:w_unknown:compensation" && a.value === null)).toBe(true);
    expect(w.assumptions.some((a) => a.key === "worker:w_owner:compensation" && a.status === "UNCONFIRMED")).toBe(true);
  });
});

const rates: PayrollRateAssumptionSet = {
  id: "rates_lab",
  socialSecurityRate: { value: "0.062", status: "CONFIRMED" }, socialSecurityWageBase: { value: "170000", status: "CONFIRMED" },
  medicareRate: { value: "0.0145", status: "CONFIRMED" }, futaRate: { value: "0.006", status: "UNCONFIRMED" }, futaWageBase: { value: "7000", status: "CONFIRMED" },
  suiRate: { value: "0.034", status: "UNCONFIRMED" }, suiWageBase: { value: "7000", status: "CONFIRMED" }, ettRate: { value: "0.001", status: "CONFIRMED" }, sdiRate: { value: "0.011", status: "CONFIRMED" },
};

describe("buildBudget", () => {
  it("projects revenue with compounding growth, payroll from workers, employer tax from rates, and opex lines", () => {
    const drivers = {
      [DRIVER_KEYS.MRR]: makeDriver(DRIVER_KEYS.MRR, "MRR", "10000", "USD/month", "CONFIRMED"),
      [DRIVER_KEYS.REVENUE_GROWTH]: assumedDriver(DRIVER_KEYS.REVENUE_GROWTH, "growth", 0.02, "ratio", "plan"),
    };
    const b = buildBudget(2027, drivers, ds.accounts, { workers: ds.workers, rates, recurringExpenses: [{ accountId: SW, label: "GitHub", monthlyAmount: "100" }] });
    expect(b.fiscalYear).toBe(2027);
    expect(b.id).toMatch(/^budget_/);
    const rev = b.lines.filter((l) => l.accountId === REV);
    expect(rev).toHaveLength(12);
    expect(rev[0].month).toBe("2027-01");
    expect(rev[0].amount).toBe("10000.0000");
    expect(rev[2].amount).toBe(D("10000").times(D("1.02").pow(2)).toFixed(4));
    expect(rev[11].month).toBe("2027-12");
    const sal = b.lines.find((l) => l.accountId === SAL && l.month === "2027-01")!;
    expect(sal.amount).toBe("13000.0000");
    const tax = b.lines.find((l) => l.accountId === TAX && l.month === "2027-01")!;
    const rate = effectiveEmployerTaxRate(rates).rate as number;
    expect(tax.amount).toBe(D("13000").times(rate).toFixed(4));
    expect(b.lines.find((l) => l.accountId === A(ACCT.CONTRACTORS_DOMESTIC))?.amount).toBe("2000.0000");
    expect(b.lines.find((l) => l.accountId === SW)?.amount).toBe("100.0000");
    expect(b.assumptions.some((a) => a.key === "worker:w_unknown:compensation")).toBe(true);
    expect(b.assumptions.some((a) => a.key === "payroll_rate:suiRate" && a.requiresProfessionalReview)).toBe(true);
    // deterministic
    expect(buildBudget(2027, drivers, ds.accounts, { workers: ds.workers, rates, recurringExpenses: [{ accountId: SW, label: "GitHub", monthlyAmount: "100" }] }).id).toBe(b.id);
  });

  it("unknown rates → employer taxes not budgeted, with an assumption (never zero-rate silently)", () => {
    const drivers = { [DRIVER_KEYS.MRR]: makeDriver(DRIVER_KEYS.MRR, "MRR", "10000", "USD/month", "CONFIRMED") };
    const b = buildBudget(2027, drivers, ds.accounts, { workers: ds.workers, rates: null });
    expect(b.lines.some((l) => l.accountId === TAX)).toBe(false);
    expect(b.assumptions.some((a) => a.key === DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE && a.value === null)).toBe(true);
    expect(b.assumptions.some((a) => a.description.includes("INSUFFICIENT_INFORMATION"))).toBe(true);
  });
});

describe("rollingForecast / applyScenario / forecastAccuracy", () => {
  const drivers = buildDefaultDrivers(ds, AS_OF).drivers;
  const { forecast, calcs } = rollingForecast(ds, AS_OF, 3, drivers, { historyMonths: 6 });

  it("splits ACTUAL months (ledger) from FORECAST months (drivers)", () => {
    const actual = forecast.lines.filter((l) => l.basis === "ACTUAL");
    const fc = forecast.lines.filter((l) => l.basis === "FORECAST");
    expect(new Set(actual.map((l) => l.month))).toEqual(new Set(["2026-06", "2026-07", "2026-08", "2026-09"]));
    expect(new Set(fc.map((l) => l.month))).toEqual(new Set(["2026-10", "2026-11", "2026-12"]));
    expect(actual.find((l) => l.accountId === REV && l.month === "2026-08")?.amount).toBe("10000.0000");
    expect(fc.find((l) => l.accountId === REV && l.month === "2026-10")?.amount).toBe("10000.0000");
    expect(fc.find((l) => l.accountId === SAL && l.month === "2026-11")?.amount).toBe("9000.0000");
    expect(fc.find((l) => l.accountId === TAX && l.month === "2026-11")?.amount).toBe("700.0000");
    expect(fc.find((l) => l.accountId === SW && l.month === "2026-12")?.driverKeys).toContain(expenseDriverKey(SW, "github"));
    expect(forecast.horizonMonths).toBe(3);
    expect(forecast.calcIds).toEqual([calcs[0].id]);
    expect(calcs[0].value.actualMonths).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(calcs[0].value.forecastMonths).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(calcs[0].notes?.some((n) => n.includes("partial"))).toBe(true);
    expect(rollingForecast(ds, AS_OF, 3, drivers, { historyMonths: 6 }).forecast.id).toBe(forecast.id);
  });

  it("applyScenario overrides drivers and adds one-off events without touching actuals", () => {
    const scenario: Scenario = {
      id: "sc_1", name: "Growth + laptop", description: "", baseForecastId: forecast.id,
      driverOverrides: { [DRIVER_KEYS.REVENUE_GROWTH]: 0.1 },
      events: [{ month: "2026-11", accountId: SW, amount: "2500", description: "New laptops" }],
      createdAt: "2026-09-09T00:00:00Z", createdBy: "test",
    };
    const { forecast: next } = applyScenario(forecast, scenario, ds.accounts);
    expect(next.id).not.toBe(forecast.id);
    expect(next.lines.filter((l) => l.basis === "ACTUAL")).toEqual(forecast.lines.filter((l) => l.basis === "ACTUAL"));
    expect(next.lines.find((l) => l.accountId === REV && l.month === "2026-10")?.amount).toBe("10000.0000");
    expect(next.lines.find((l) => l.accountId === REV && l.month === "2026-11")?.amount).toBe("11000.0000");
    expect(next.lines.find((l) => l.accountId === REV && l.month === "2026-12")?.amount).toBe("12100.0000");
    expect(next.lines.find((l) => l.accountId === SW && l.month === "2026-11")?.amount).toBe("2600.0000");
    expect(next.lines.find((l) => l.accountId === SW && l.month === "2026-12")?.amount).toBe("100.0000");
    expect(next.drivers[DRIVER_KEYS.REVENUE_GROWTH].status).toBe("UNCONFIRMED");
    expect(next.drivers[DRIVER_KEYS.REVENUE_GROWTH].note).toContain("scenario");
  });

  it("forecastAccuracy computes MAPE per account", () => {
    const actuals: ActualsByAccountMonth = { [REV]: { "2026-10": "12500", "2026-11": "8000" }, [SAL]: { "2026-10": "9000" }, [SW]: { "2026-10": "0" } };
    const r = forecastAccuracy(forecast, actuals, { asOfDate: "2026-11-30" });
    const rev = r.value!.perAccount.find((p) => p.accountId === REV)!;
    // |12500-10000|/12500 = 0.2 ; |8000-10000|/8000 = 0.25 → 0.225
    expect(rev.mape).toBeCloseTo(0.225, 6);
    expect(rev.months).toBe(2);
    expect(r.value!.perAccount.find((p) => p.accountId === SAL)!.mape).toBe(0);
    expect(r.value!.skippedZeroActuals).toBe(1);
    expect(r.value!.comparedLines).toBe(3);
    expect(r.value!.overallMape).toBeCloseTo((0.2 + 0.25 + 0) / 3, 6);
    const none = forecastAccuracy(forecast, {}, { asOfDate: "2026-11-30" });
    expect(none.value).toBeNull();
    expect(none.notes?.[0]).toContain("INSUFFICIENT_INFORMATION");
  });
});
