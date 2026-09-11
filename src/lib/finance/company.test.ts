import { describe, expect, it } from "vitest";
import { computeCompany, type CompanyInput } from "./company";
import { known, unknown } from "./money";

const base: CompanyInput = {
  cashBalance: known(4200000),
  anticipatedRevenue: known(3000000),
  revenueBasis: "anticipated",
  allocations: [{ id: "ops", name: "Tools, equipment & apartment furnishing", amount: known(800000), kind: "mixed" }],
  employerPayrollCostRatePct: null,
  ownerSalaries: [
    { personId: "will", name: "Will", grossMonthly: known(300000) },
    { personId: "arielle", name: "Arielle", grossMonthly: known(300000) },
  ],
  incomeTaxReserveRatePct: null,
  bills: [
    { id: "b1", name: "Software", amount: known(40000), cadence: "monthly" },
    { id: "b2", name: "Insurance", amount: known(120000), cadence: "annual" },
  ],
  otherOverhead: unknown("Other overhead not entered"),
  cashReserveTargetMonths: 3,
  plannedHouseholdDistribution: unknown("Planned distribution not set"),
};

describe("company waterfall", () => {
  it("treats revenue as company money and keeps unknown costs unknown", () => {
    const r = computeCompany(base);
    expect(r.revenue.provenance.caveats.join(" ")).toMatch(/not personal take-home/);
    // known commitments: 6,000 salaries + 8,000 allocation + 400 + 100 = 14,500
    expect(r.committed.total.knownCents).toBe(1450000);
    expect(r.committed.total.unknowns).toEqual(["Employer payroll cost rate not set", "Other overhead not entered", "Income tax reserve rate not set"]);
    expect(r.distributable.total.knownCents).toBe(1550000);
    expect(r.distributable.total.complete).toBe(false);
    expect(r.unresolved).toContain("Tools, equipment & apartment furnishing: business vs household split");
    expect(r.unresolved).toContain("Planned monthly distribution to the household");
    expect(r.remaining.total.complete).toBe(false);
  });

  it("computes employer costs and tax reserve once rates and the split are entered", () => {
    const r = computeCompany({
      ...base,
      allocations: [
        { id: "tools", name: "Tools & equipment", amount: known(500000), kind: "business" },
        { id: "home", name: "Apartment furnishing", amount: known(300000), kind: "household" },
      ],
      employerPayrollCostRatePct: 10,
      incomeTaxReserveRatePct: 20,
      otherOverheadCents: undefined,
      otherOverhead: known(50000),
      plannedHouseholdDistribution: known(600000),
    } as CompanyInput);
    const employer = r.lines.find((l) => l.id === "employer-payroll-costs")!;
    expect(employer.amount).toEqual(known(60000)); // 10% of 6,000 in W-2 wages
    // profit before tax: 30,000 - 6,000 - 5,000 - 600 - 500 - 500 = 17,400 ; tax 20% = 3,480
    const tax = r.lines.find((l) => l.id === "tax-reserve")!;
    expect(tax.amount).toEqual(known(348000));
    expect(r.distributable.total.complete).toBe(true);
    expect(r.distributable.total.knownCents).toBe(1740000 - 348000);
    // household furnishing is a distribution, after tax; then the planned distribution
    expect(r.remaining.total.knownCents).toBe(1740000 - 348000 - 300000 - 600000);
    expect(r.remaining.total.complete).toBe(true);
  });

  it("keeps the tax reserve unknown while a mixed allocation has no split even with a rate", () => {
    const r = computeCompany({ ...base, incomeTaxReserveRatePct: 20, employerPayrollCostRatePct: 10, otherOverhead: known(0) });
    expect(r.lines.find((l) => l.id === "tax-reserve")!.amount.kind).toBe("unknown");
  });

  it("applies employer costs to W-2 employee allocations but not contractors", () => {
    const w2 = computeCompany({ ...base, allocations: [{ id: "e", name: "Employees", amount: known(800000), kind: "employees_w2" }], employerPayrollCostRatePct: 10 });
    expect(w2.lines.find((l) => l.id === "employer-payroll-costs")!.amount).toEqual(known(140000));
    const contractors = computeCompany({ ...base, allocations: [{ id: "e", name: "Contractors", amount: known(800000), kind: "contractors" }], employerPayrollCostRatePct: 10 });
    expect(contractors.lines.find((l) => l.id === "employer-payroll-costs")!.amount).toEqual(known(60000));
    const unresolved = computeCompany({ ...base, allocations: [{ id: "e", name: "Employees", amount: known(800000), kind: "employees_unresolved" }], employerPayrollCostRatePct: 10 });
    expect(unresolved.lines.find((l) => l.id === "employer-payroll-costs")!.amount.kind).toBe("unknown");
  });

  it("shows a shortfall honestly when distributions exceed what is available", () => {
    const r = computeCompany({
      ...base,
      allocations: [{ id: "tools", name: "Tools", amount: known(800000), kind: "business" }],
      otherOverhead: known(0),
      employerPayrollCostRatePct: 0,
      incomeTaxReserveRatePct: 0,
      plannedHouseholdDistribution: known(2000000),
    });
    expect(r.distributable.total.knownCents).toBe(1550000);
    expect(r.remaining.total.knownCents).toBe(-450000);
    expect(r.remaining.label).toMatch(/Shortfall/);
  });

  it("reports runway and reserve target from known operating cost", () => {
    const r = computeCompany({ ...base, allocations: [{ id: "tools", name: "Tools", amount: known(800000), kind: "business" }], otherOverhead: known(0), employerPayrollCostRatePct: 0 });
    expect(r.monthlyOperatingCost.knownCents).toBe(1450000);
    expect(r.runwayMonths).toBe(2);
    expect(r.reserveTarget.total.knownCents).toBe(4350000);
  });

  it("keeps cash unknown when a balance is missing", () => {
    const r = computeCompany({ ...base, cashBalance: unknown("Operating account balance not entered") });
    expect(r.cash.total.complete).toBe(false);
    expect(r.runwayMonths).toBeNull();
  });
});
