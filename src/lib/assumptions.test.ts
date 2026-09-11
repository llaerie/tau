import { describe, expect, it } from "vitest";
import { defaultAssumptions, parseAssumptions, reviewItems } from "./assumptions";

describe("assumptions v3", () => {
  it("defaults: two $3,000 salaries, no allocation, unknown taxes, no imposed goals or food targets", () => {
    const a = defaultAssumptions(["will", "arielle"]);
    expect(Object.values(a.owners).map((o) => o.grossSalaryCents)).toEqual([300000, 300000]);
    expect(a.company.taxes.reserveRatePct).toBeNull();
    expect(a.company.employerPayrollCostRatePct).toBeNull();
    expect(a.owners.arielle.foodTargetCents).toBeNull();
    expect(a.owners.arielle.allocations).toEqual([]);
    expect(a.payrollRules.sdiPct).toBe(1.3);
    const json = JSON.stringify(a);
    expect(json).not.toMatch(/800000|500000|270000|2200000/);
    expect(json).not.toMatch(/travel/i);
  });

  it("migrates version 2 and archives the $8,000 allocation and old tax rate as superseded", () => {
    const legacy = JSON.stringify({
      version: 2,
      company: { anticipatedRevenueCents: 3000000, revenueBasis: "anticipated", allocations: [{ id: "operating", name: "Tools, equipment & apartment furnishing", amountCents: 800000, kind: "mixed" }], employerPayrollCostRatePct: null, incomeTaxReserveRatePct: 20, otherOverheadCents: null, cashReserveTargetMonths: null },
      owners: { will: { grossSalaryCents: 300000, withholding: { ficaRatePct: 7.65, incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000 }, otherNetIncomeCents: 0, householdContributionCents: 0 } },
      household: { plannedCompanyDistributionCents: 600000 },
      notes: "n",
      onboardingCompleted: true,
    });
    const a = parseAssumptions(legacy, ["will", "arielle"]);
    expect(a.version).toBe(3);
    expect(a.superseded.map((s) => s.key)).toEqual(["company.incomeTaxReserveRatePct", "company.allocation.operating"]);
    expect(a.superseded[1].previousValue).toMatch(/8,000/);
    expect(a.owners.will.withholding).toEqual({ incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000, source: "estimate" });
    expect(a.owners.arielle.foodTargetCents).toBeNull();
    expect(a.onboardingCompleted).toBe(true);
  });

  it("builds a dependency-aware review queue for the signed-in person", () => {
    const a = defaultAssumptions(["arielle"]);
    const items = reviewItems(a, { personId: "arielle", personNames: { arielle: "Arielle" }, visiblePersonIds: ["arielle"], canSeeCompany: true });
    expect(items[0].key).toBe("food-target");
    expect(items[1].key).toBe("withholding");
    expect(items.find((i) => i.key === "tax-reserve")?.severity).toBe("attention");
  });
});
