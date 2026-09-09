import { describe, expect, it } from "vitest";
import type { Compensation, PayrollLine, PayrollRun, Transaction } from "@/lib/core/types";
import { D } from "@/lib/core/money";
import { employerPayrollCostForRun, fullyLoadedCost, payrollReconciliation, type PayrollRateAssumptionSet } from "@/lib/finance/headcount";

const rates = (status: "CONFIRMED" | "UNCONFIRMED" = "CONFIRMED"): PayrollRateAssumptionSet => ({
  id: "rates_synthetic_2026",
  label: "Synthetic lab rates",
  taxYear: 2026,
  isSynthetic: true,
  socialSecurityRate: { value: "0.062", status, sourceId: "ks_synth" },
  socialSecurityWageBase: { value: "170000", status, sourceId: "ks_synth" },
  medicareRate: { value: "0.0145", status, sourceId: "ks_synth" },
  futaRate: { value: "0.006", status, sourceId: "ks_synth" },
  futaWageBase: { value: "7000", status, sourceId: "ks_synth" },
  suiRate: { value: "0.034", status, sourceId: "ks_synth" },
  suiWageBase: { value: "7000", status, sourceId: "ks_synth" },
  ettRate: { value: "0.001", status, sourceId: "ks_synth" },
  sdiRate: { value: "0.011", status, sourceId: "ks_synth" },
});

const salary: Compensation = { type: "SALARY", amount: "10000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" };
const asOfDate = "2026-09-09";

describe("fullyLoadedCost", () => {
  it("computes employer taxes with wage-base caps and totals", () => {
    const r = fullyLoadedCost({ compensation: salary, rates: rates(), benefits: "6000", overhead: "2400", asOfDate, workerId: "w1" });
    const v = r.value!;
    expect(v.annualGrossWages).toBe("120000.0000");
    expect(v.socialSecurity).toBe(D("120000").times("0.062").toFixed(4));
    expect(v.medicare).toBe("1740.0000");
    expect(v.futa).toBe("42.0000"); // 7000 * 0.006
    expect(v.sui).toBe("238.0000"); // 7000 * 0.034
    expect(v.ett).toBe("7.0000");
    expect(v.employerTaxes).toBe("9467.0000");
    expect(v.total).toBe("137867.0000");
    expect(r.assumptions).toHaveLength(0);
    expect(r.sourceIds).toContain("rates_synthetic_2026");
  });
  it("caps social security when annual wages exceed the base", () => {
    const big: Compensation = { ...salary, amount: "200000", period: "ANNUAL" };
    const v = fullyLoadedCost({ compensation: big, rates: rates(), benefits: "0", overhead: "0", asOfDate }).value!;
    expect(v.socialSecurity).toBe("10540.0000"); // 170000 * 0.062
  });
  it("unconfirmed rates are carried as assumptions requiring professional review", () => {
    const r = fullyLoadedCost({ compensation: salary, rates: rates("UNCONFIRMED"), benefits: "0", overhead: "0", asOfDate });
    expect(r.value).not.toBeNull();
    expect(r.assumptions.length).toBeGreaterThan(0);
    expect(r.assumptions.every((a) => a.requiresProfessionalReview && a.status === "UNCONFIRMED")).toBe(true);
    expect(r.notes?.some((n) => n.includes("professional review"))).toBe(true);
  });
  it("unknown rate → null with INSUFFICIENT_INFORMATION (never zero)", () => {
    const rs = rates();
    rs.suiRate = { value: null, status: "UNCONFIRMED" };
    const r = fullyLoadedCost({ compensation: salary, rates: rs, benefits: "0", overhead: "0", asOfDate });
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("INSUFFICIENT_INFORMATION: payroll rate assumption suiRate");
  });
  it("unknown benefits → total null but wages + taxes reported", () => {
    const r = fullyLoadedCost({ compensation: salary, rates: rates(), benefits: null, overhead: "0", asOfDate });
    expect(r.value?.total).toBeNull();
    expect(r.value?.wagesPlusEmployerTaxes).toBe("129467.0000");
    expect(r.notes?.some((n) => n.startsWith("INSUFFICIENT_INFORMATION: benefits"))).toBe(true);
  });
  it("contractor: no employer taxes; NET basis → insufficient", () => {
    const c = fullyLoadedCost({ compensation: { type: "CONTRACT", amount: "5000", currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "CONFIRMED" }, rates: rates(), benefits: "0", overhead: "0", asOfDate });
    expect(c.value?.employerTaxes).toBe("0.0000");
    expect(c.value?.isContractor).toBe(true);
    const net = fullyLoadedCost({ compensation: { ...salary, basis: "NET" }, rates: rates(), benefits: "0", overhead: "0", asOfDate });
    expect(net.value).toBeNull();
  });
});

const line = (workerId: string, gross: string): PayrollLine => ({
  workerId, gross,
  federalIncomeTaxWithheld: D(gross).times("0.12").toFixed(4), stateIncomeTaxWithheld: D(gross).times("0.05").toFixed(4),
  socialSecurityEmployee: D(gross).times("0.062").toFixed(4), medicareEmployee: D(gross).times("0.0145").toFixed(4), stateDisabilityEmployee: D(gross).times("0.011").toFixed(4),
  otherDeductions: "0", netPay: D(gross).times(1 - 0.12 - 0.05 - 0.062 - 0.0145 - 0.011).toFixed(4),
  socialSecurityEmployer: D(gross).times("0.062").toFixed(4), medicareEmployer: D(gross).times("0.0145").toFixed(4), federalUnemploymentEmployer: "0", stateUnemploymentEmployer: "0", stateTrainingTaxEmployer: "0", otherEmployerCosts: "0",
  totalEmployerCost: D(gross).times(1.0765).toFixed(4),
});

function makeRun(): PayrollRun {
  const lines = [line("w1", "5000"), line("w2", "4000")];
  const gross = "9000.0000";
  const employeeTaxes = D(gross).times(0.12 + 0.05 + 0.062 + 0.0145 + 0.011).toFixed(4);
  const employerTaxes = D(gross).times(0.0765).toFixed(4);
  return {
    id: "run_1", periodStart: "2026-08-16", periodEnd: "2026-08-31", payDate: "2026-08-31", currency: "USD", status: "PAID", lines,
    totals: { gross, employeeTaxes, otherDeductions: "0.0000", netPay: D(gross).minus(employeeTaxes).toFixed(4), employerTaxes, totalEmployerCost: D(gross).plus(employerTaxes).toFixed(4) },
    netPayTransactionIds: [],
  };
}

const tx = (id: string, amount: string): Transaction => ({
  id, sourceKind: "BANK", sourceAccountId: "bank_1", externalId: id, date: "2026-08-31", postedDate: "2026-08-31", amount, currency: "USD", descriptionRaw: "PAYROLL", category: { accountId: null, status: "UNCATEGORIZED", confidence: 0 }, documentIds: [], flags: [], importBatchId: "b",
});

describe("employer payroll cost for run & reconciliation", () => {
  it("sums lines and agrees with run totals", () => {
    const run = makeRun();
    const r = employerPayrollCostForRun(run);
    expect(r.value.gross).toBe("9000.0000");
    expect(r.value.employerTaxes).toBe("688.5000");
    expect(r.value.totalEmployerCost).toBe("9688.5000");
    expect(r.value.discrepancies).toEqual([]);
  });
  it("reports discrepancies when run totals disagree with lines", () => {
    const run = makeRun();
    run.totals.gross = "9999.0000";
    const r = employerPayrollCostForRun(run);
    expect(r.value.discrepancies.some((d) => d.startsWith("gross"))).toBe(true);
    expect(r.notes?.[0]).toContain("DISCREPANCY");
  });
  it("reconciliation MATCHED when bank net pay and deposits equal register", () => {
    const run = makeRun();
    const net = run.totals.netPay;
    const liab = D(run.totals.employeeTaxes).plus(run.totals.employerTaxes).toFixed(4);
    const r = payrollReconciliation(run, [tx("t1", D(net).neg().toFixed(4))], [tx("t2", D(liab).neg().toFixed(4))]);
    expect(r.value.status).toBe("MATCHED");
    expect(r.value.netPay.variance).toBe("0.0000");
    expect(r.value.liabilities.matched).toBe(true);
  });
  it("reconciliation VARIANCE when bank differs; missing deposits are not assumed paid", () => {
    const run = makeRun();
    const r = payrollReconciliation(run, [tx("t1", "-3000"), tx("t2", "-3000")], []);
    expect(r.value.status).toBe("VARIANCE");
    expect(r.value.netPay.actual).toBe("6000.0000");
    expect(D(r.value.netPay.variance).lt(0)).toBe(true);
    expect(r.value.liabilities.matched).toBe(false);
    expect(r.value.liabilities.note).toContain("unreconciled");
  });
});
