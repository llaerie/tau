import { describe, expect, it } from "vitest";
import { defaultAssumptions, parseAssumptions, unresolvedAssumptions } from "./assumptions";

describe("assumptions", () => {
  it("defaults follow the stated figures and leave the rest unknown", () => {
    const a = defaultAssumptions(["alex", "sam"]);
    expect(a.company.anticipatedRevenueCents).toBe(3000000);
    expect(a.company.revenueBasis).toBe("anticipated");
    expect(a.company.employeeAllocationCents).toBe(800000);
    expect(a.company.employeeClassification).toBe("unresolved");
    expect(a.company.employerPayrollCostRatePct).toBeNull();
    expect(a.company.incomeTaxReserveRatePct).toBeNull();
    expect(a.owners.alex.grossSalaryCents).toBe(300000);
    expect(a.owners.alex.withholdingRatePct).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/270000|2200000/);
  });

  it("lists unresolved items", () => {
    const a = defaultAssumptions(["alex"]);
    const items = unresolvedAssumptions(a, { alex: "Alex" });
    expect(items.map((i) => i.key)).toEqual(["classification", "employer-rate", "tax-rate", "overhead", "alex-withholding", "alex-contribution"]);
  });

  it("repairs invalid JSON to defaults and backfills missing owners", () => {
    const a = parseAssumptions("{}", ["alex", "sam"]);
    expect(Object.keys(a.owners)).toEqual(["alex", "sam"]);
    const b = parseAssumptions(JSON.stringify(defaultAssumptions(["alex"])), ["alex", "sam"]);
    expect(b.owners.sam.grossSalaryCents).toBe(300000);
  });
});
