import { describe, expect, it } from "vitest";
import { defaultAssumptions, parseAssumptions, unresolvedAssumptions } from "./assumptions";

describe("assumptions", () => {
  it("defaults follow the stated plan and leave the rest unknown", () => {
    const a = defaultAssumptions(["will", "arielle"]);
    expect(a.company.anticipatedRevenueCents).toBe(3000000);
    expect(a.company.revenueBasis).toBe("anticipated");
    expect(a.company.allocations[0]).toMatchObject({ amountCents: 800000, kind: "mixed" });
    expect(a.company.employerPayrollCostRatePct).toBeNull();
    expect(a.company.incomeTaxReserveRatePct).toBeNull();
    expect(a.owners.arielle.grossSalaryCents).toBe(300000);
    expect(a.owners.arielle.withholding).toEqual({ ficaRatePct: 7.65, incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000 });
    expect(a.household.plannedCompanyDistributionCents).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/270000|2200000/);
  });

  it("lists unresolved items", () => {
    const a = defaultAssumptions(["will"]);
    const keys = unresolvedAssumptions(a, { will: "Will" }).map((i) => i.key);
    expect(keys).toEqual(["alloc-operating-split", "employer-rate", "tax-rate", "overhead", "distribution"]);
  });

  it("migrates the version-1 shape and backfills missing owners", () => {
    const legacy = JSON.stringify({
      version: 1,
      company: { anticipatedRevenueCents: 2500000, revenueBasis: "contracted", employeeAllocationCents: 800000, employeeClassification: "contractor", employerPayrollCostRatePct: 10, incomeTaxReserveRatePct: null, otherOverheadCents: 50000, cashReserveTargetMonths: 3 },
      owners: { will: { grossSalaryCents: 300000, withholdingRatePct: 25, otherNetIncomeCents: 0, householdContributionCents: 80000 } },
      household: { plannedCompanyDistributionCents: 0 },
      notes: "n",
      onboardingCompleted: true,
    });
    const a = parseAssumptions(legacy, ["will", "arielle"]);
    expect(a.version).toBe(2);
    expect(a.company.anticipatedRevenueCents).toBe(2500000);
    expect(a.company.allocations[0]).toMatchObject({ amountCents: 800000, kind: "contractors" });
    expect(a.owners.will.withholding.incomeTaxCents).toBe(75000);
    expect(a.owners.will.householdContributionCents).toBe(80000);
    expect(a.owners.arielle.grossSalaryCents).toBe(300000);
    expect(a.onboardingCompleted).toBe(true);
    expect(parseAssumptions("not json", ["x"]).owners.x).toBeTruthy();
  });
});
