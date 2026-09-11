import { describe, expect, it } from "vitest";
import { known, unknown } from "./money";
import { computePersonal, type PersonalInput } from "./personal";

const arielle: PersonalInput = {
  personId: "arielle",
  name: "Arielle",
  grossSalary: known(300000),
  withholding: { ficaRatePct: 7.65, incomeTax: known(25000), incomeTaxRangeCents: [15000, 35000] },
  otherNetIncome: known(0),
  householdContribution: known(0),
  bills: [],
  goals: [{ id: "travel", name: "Friends travel", monthlyTarget: known(100000), priority: 1, rule: "Funded before any discretionary spending" }],
  budgets: [
    { id: "shopping", name: "Shopping", monthly: known(70000), actualCents: 42000 },
    { id: "massage", name: "Massage", monthly: known(30000), actualCents: 0 },
    { id: "pedicure", name: "Pedicure", monthly: known(10000) },
    { id: "crafts", name: "Arts & crafts", monthly: known(20000) },
    { id: "coffee", name: "Coffee, snacks & eating out with friends", monthly: known(20000) },
  ],
  cashBalance: known(520000),
};

describe("personal waterfall", () => {
  it("derives net from gross using FICA and the income-tax estimate, with the range as a caveat", () => {
    const r = computePersonal(arielle);
    // 3,000 - 229.50 - 250 = 2,520.50 → FICA rounds to 22950 cents
    expect(r.net.total.knownCents).toBe(300000 - 22950 - 25000);
    expect(r.net.provenance.caveats[0]).toMatch(/between \$2,421 and \$2,621/);
    expect(r.gross.provenance.caveats[0]).toMatch(/Not a spending allowance/);
  });

  it("funds the travel goal first, then the spending plan, and reports what is unallocated", () => {
    const r = computePersonal(arielle);
    expect(r.goals!.allocations[0]).toMatchObject({ goalId: "travel", fundedCents: 100000, shortfallCents: 0 });
    expect(r.discretionary.total.knownCents).toBe(252050 - 100000);
    expect(r.plannedSpending.knownCents).toBe(150000);
    expect(r.unallocated.total.knownCents).toBe(152050 - 150000);
    expect(r.budgets.find((b) => b.id === "shopping")).toMatchObject({ plannedCents: 70000, actualCents: 42000, remainingCents: 28000 });
    expect(r.budgets.find((b) => b.id === "pedicure")!.remainingCents).toBeNull();
  });

  it("keeps net unknown when the income-tax estimate is missing and never assumes net = gross", () => {
    const r = computePersonal({ ...arielle, withholding: { ficaRatePct: 7.65, incomeTax: unknown("not estimated") } });
    expect(r.net.total.complete).toBe(false);
    expect(r.discretionary.total.complete).toBe(false);
    expect(r.unallocated.total.complete).toBe(false);
    expect(r.discretionaryUpperBoundCents).toBe(300000 - 100000);
    expect(r.unresolved[0]).toMatch(/income-tax/i);
  });

  it("reports a shortfall on goals when net cannot cover them", () => {
    const r = computePersonal({ ...arielle, withholding: { ficaRatePct: 7.65, incomeTax: known(200000) } });
    // net = 3,000 - 229.50 - 2,000 = 770.50
    expect(r.goals!.allocations[0].fundedCents).toBe(77050);
    expect(r.goals!.allocations[0].shortfallCents).toBe(22950);
    expect(r.discretionary.total.knownCents).toBeLessThan(0);
    expect(r.discretionary.provenance.caveats[0]).toMatch(/Shortfall/);
  });

  it("flags an over-planned spending plan", () => {
    const r = computePersonal({ ...arielle, budgets: [{ id: "big", name: "Big", monthly: known(200000) }] });
    expect(r.unallocated.label).toBe("Over-planned");
    expect(r.unallocated.total.knownCents).toBe(152050 - 200000);
  });
});
