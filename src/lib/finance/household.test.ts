import { describe, expect, it } from "vitest";
import { computeHousehold, type HouseholdInput } from "./household";
import { known, unknown } from "./money";

const base: HouseholdInput = {
  contributions: [
    { personId: "alex", name: "Alex", amount: known(80000) },
    { personId: "sam", name: "Sam", amount: known(80000) },
  ],
  companyDistribution: known(0),
  companyPaidItems: known(0),
  budgets: [],
  bills: [
    { id: "rent", name: "Rent", amount: known(120000), cadence: "monthly" },
    { id: "util", name: "Utilities", amount: known(18000), cadence: "monthly" },
  ],
  goals: [{ id: "ef", name: "Emergency fund", monthlyTarget: known(20000), priority: 1, targetTotalCents: 600000, savedCents: 200000 }],
  cashBalance: known(310000),
};

describe("household", () => {
  it("funds bills then goals and reports the surplus", () => {
    const r = computeHousehold(base);
    expect(r.funding.total.knownCents).toBe(160000);
    expect(r.bills.total.knownCents).toBe(138000);
    expect(r.goals.allocations[0].fundedCents).toBe(20000);
    expect(r.goals.allocations[0].monthsToTarget).toBe(20);
    expect(r.surplus.total.knownCents).toBe(2000);
    expect(r.contributionSplit![0].shareBps).toBe(5000);
  });

  it("shows a shortfall rather than trimming bills", () => {
    const r = computeHousehold({ ...base, contributions: [{ personId: "alex", name: "Alex", amount: known(50000) }] });
    expect(r.surplus.label).toBe("Shortfall");
    expect(r.surplus.total.knownCents).toBe(50000 - 138000 - 20000);
  });

  it("keeps funding unknown when a contribution is unknown", () => {
    const r = computeHousehold({ ...base, contributions: [{ personId: "sam", name: "Sam", amount: unknown("not set") }] });
    expect(r.funding.total.complete).toBe(false);
    expect(r.contributionSplit).toBeNull();
    expect(r.unresolved).toEqual(["Sam's household contribution"]);
  });
});

describe("household funded by company distributions", () => {
  it("counts the planned distribution and company-paid items as funding and budgets as planned spending", () => {
    const r = computeHousehold({
      ...base,
      contributions: [
        { personId: "will", name: "Will", amount: known(0) },
        { personId: "arielle", name: "Arielle", amount: known(0) },
      ],
      companyDistribution: known(600000),
      companyPaidItems: known(300000),
      budgets: [
        { id: "groceries", name: "Groceries", monthly: known(90000), actualCents: 41000 },
        { id: "dining", name: "Dining together", monthly: known(60000) },
      ],
    });
    expect(r.funding.total.knownCents).toBe(900000);
    expect(r.plannedSpending.knownCents).toBe(150000);
    expect(r.surplus.total.knownCents).toBe(900000 - 138000 - 20000 - 150000);
    expect(r.budgets[0]).toMatchObject({ plannedCents: 90000, actualCents: 41000, remainingCents: 49000 });
  });

  it("keeps funding unknown when the distribution is not decided", () => {
    const r = computeHousehold({ ...base, companyDistribution: unknown("Planned distribution not set") });
    expect(r.funding.total.complete).toBe(false);
    expect(r.surplus.total.complete).toBe(false);
  });
});
