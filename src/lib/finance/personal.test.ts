import { describe, expect, it } from "vitest";
import { known, unknown } from "./money";
import { computePersonal, type PersonalInput } from "./personal";

const alex: PersonalInput = {
  personId: "alex",
  name: "Alex",
  grossSalary: known(300000),
  withholdingRatePct: null,
  otherNetIncome: known(0),
  householdContribution: known(80000),
  bills: [{ id: "phone", name: "Phone", amount: known(6000), cadence: "monthly" }],
  goals: [
    { id: "gear", name: "Camera gear", monthlyTarget: known(30000), priority: 2 },
    { id: "travel", name: "Friends travel", monthlyTarget: known(100000), priority: 1, rule: "Funded before discretionary spending" },
  ],
  cashBalance: known(520000),
};

describe("personal waterfall", () => {
  it("keeps net take-home unknown when withholding is not set, and never assumes net = gross", () => {
    const r = computePersonal(alex);
    expect(r.gross.total.knownCents).toBe(300000);
    expect(r.net.total.complete).toBe(false);
    expect(r.discretionary.total.complete).toBe(false);
    // Upper bound if nothing were withheld: 3,000 - 800 - 60 - 1,300 = 840
    expect(r.discretionaryUpperBoundCents).toBe(84000);
    expect(r.discretionary.provenance.caveats[0]).toMatch(/at most \$840/);
    expect(r.unresolved[0]).toMatch(/withholding/i);
  });

  it("funds the friends-travel goal before discretionary spending once net is known", () => {
    const r = computePersonal({ ...alex, withholdingRatePct: 25 });
    // net = 2,250; after obligations = 2,250 - 800 - 60 = 1,390
    expect(r.net.total.knownCents).toBe(225000);
    expect(r.afterObligations.knownCents).toBe(139000);
    const [first, second] = r.goals!.allocations;
    expect(first.goalId).toBe("travel");
    expect(first.fundedCents).toBe(100000);
    expect(second.goalId).toBe("gear");
    expect(second.fundedCents).toBe(30000);
    expect(r.discretionary.total.knownCents).toBe(9000);
  });

  it("reports the shortfall when goals cannot be fully funded", () => {
    const r = computePersonal({ ...alex, withholdingRatePct: 40 });
    // net = 1,800; after obligations = 940; travel gets 940, gear gets 0
    expect(r.goals!.allocations[0].fundedCents).toBe(94000);
    expect(r.goals!.allocations[0].shortfallCents).toBe(6000);
    expect(r.goals!.allocations[1].fundedCents).toBe(0);
    expect(r.discretionary.total.knownCents).toBeLessThan(0);
    expect(r.discretionary.provenance.caveats[0]).toMatch(/Shortfall of \$360/);
  });

  it("keeps discretionary unknown when a bill amount is unknown", () => {
    const r = computePersonal({ ...alex, withholdingRatePct: 25, bills: [{ id: "x", name: "Gym", amount: unknown("Gym amount not entered"), cadence: "monthly" }] });
    expect(r.discretionary.total.complete).toBe(false);
  });
});
