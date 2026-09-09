import { describe, expect, it } from "vitest";
import { computeCompany, type CompanyInput } from "./company";
import { known, unknown } from "./money";

const base: CompanyInput = {
  cashBalance: known(4200000),
  anticipatedRevenue: known(3000000),
  revenueBasis: "anticipated",
  employeeAllocation: known(800000),
  employeeClassification: "unresolved",
  employerPayrollCostRatePct: null,
  ownerSalaries: [
    { personId: "alex", name: "Alex", grossMonthly: known(300000) },
    { personId: "sam", name: "Sam", grossMonthly: known(300000) },
  ],
  incomeTaxReserveRatePct: null,
  bills: [
    { id: "b1", name: "Software", amount: known(40000), cadence: "monthly" },
    { id: "b2", name: "Insurance", amount: known(120000), cadence: "annual" },
  ],
  otherOverhead: unknown("Other overhead not entered"),
  cashReserveTargetMonths: 3,
};

describe("company waterfall", () => {
  it("treats revenue as company money and keeps unknown costs unknown", () => {
    const r = computeCompany(base);
    expect(r.revenue.total.knownCents).toBe(3000000);
    expect(r.revenue.provenance.caveats.join(" ")).toMatch(/not personal take-home/);
    // known commitments: 8,000 + 6,000 + 400 + 100 = 14,500
    expect(r.committed.total.knownCents).toBe(1450000);
    expect(r.committed.total.complete).toBe(false);
    expect(r.committed.total.unknowns).toEqual([
      "Employer payroll cost rate not set",
      "Other overhead not entered",
      "Income tax reserve rate not set",
    ]);
    expect(r.distributable.total.knownCents).toBe(1550000);
    expect(r.distributable.total.complete).toBe(false);
    expect(r.distributable.provenance.caveats[0]).toMatch(/Upper bound/);
    expect(r.unresolved).toContain("Employee allocation payroll classification");
  });

  it("computes employer costs and tax reserve once rates are entered", () => {
    const r = computeCompany({
      ...base,
      employeeClassification: "w2_gross",
      employerPayrollCostRatePct: 10,
      incomeTaxReserveRatePct: 20,
      otherOverhead: known(50000),
    });
    // employer costs: 10% of (8,000 + 6,000) = 1,400
    const employer = r.lines.find((l) => l.id === "employer-payroll-costs")!;
    expect(employer.amount).toEqual(known(140000));
    // profit before tax: 30,000 - 8,000 - 6,000 - 1,400 - 500 - 500 = 13,600 ; tax 20% = 2,720
    const tax = r.lines.find((l) => l.id === "tax-reserve")!;
    expect(tax.amount).toEqual(known(272000));
    expect(r.distributable.total.complete).toBe(true);
    expect(r.distributable.total.knownCents).toBe(1360000 - 272000);
  });

  it("does not apply employer costs to contractor payments", () => {
    const r = computeCompany({ ...base, employeeClassification: "contractor", employerPayrollCostRatePct: 10 });
    const employer = r.lines.find((l) => l.id === "employer-payroll-costs")!;
    expect(employer.amount).toEqual(known(60000)); // 10% of owner salaries only
  });

  it("keeps employer costs unknown while classification is unresolved even if a rate exists", () => {
    const r = computeCompany({ ...base, employerPayrollCostRatePct: 10 });
    const employer = r.lines.find((l) => l.id === "employer-payroll-costs")!;
    expect(employer.amount.kind).toBe("unknown");
  });

  it("shows a shortfall honestly when commitments exceed revenue", () => {
    const r = computeCompany({ ...base, anticipatedRevenue: known(1000000), otherOverhead: known(0), employeeClassification: "contractor", employerPayrollCostRatePct: 0, incomeTaxReserveRatePct: 0 });
    expect(r.distributable.total.knownCents).toBe(1000000 - 1450000);
    expect(r.distributable.total.complete).toBe(true);
  });

  it("reports runway and reserve target from known operating cost", () => {
    const r = computeCompany({ ...base, otherOverhead: known(0), employeeClassification: "contractor", employerPayrollCostRatePct: 0 });
    expect(r.monthlyOperatingCost.knownCents).toBe(1450000);
    expect(r.runwayMonths).toBe(2); // 42,000 / 14,500
    expect(r.reserveTarget.total.knownCents).toBe(4350000);
  });

  it("keeps cash unknown when a balance is missing", () => {
    const r = computeCompany({ ...base, cashBalance: unknown("Operating account balance not entered") });
    expect(r.cash.total.complete).toBe(false);
    expect(r.runwayMonths).toBeNull();
  });
});
