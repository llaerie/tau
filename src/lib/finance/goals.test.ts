import { describe, expect, it } from "vitest";
import { fundGoalsInPriorityOrder, monthsToTarget } from "./goals";
import { known, unknown } from "./money";

const travel = { id: "travel", name: "Friends travel", monthlyTarget: known(100000), priority: 1, rule: "before discretionary" };
const gear = { id: "gear", name: "Camera gear", monthlyTarget: known(40000), priority: 2 };

describe("goal funding order", () => {
  it("funds the friends-travel goal before lower priority goals", () => {
    const r = fundGoalsInPriorityOrder([gear, travel], 120000);
    expect(r.allocations.map((a) => a.goalId)).toEqual(["travel", "gear"]);
    expect(r.allocations[0].fundedCents).toBe(100000);
    expect(r.allocations[1].fundedCents).toBe(20000);
    expect(r.allocations[1].shortfallCents).toBe(20000);
    expect(r.remainingCents).toBe(0);
    expect(r.totalShortfallCents).toBe(20000);
  });

  it("reports a shortfall on the top goal instead of trimming it", () => {
    const r = fundGoalsInPriorityOrder([travel], 60000);
    expect(r.allocations[0].fundedCents).toBe(60000);
    expect(r.allocations[0].shortfallCents).toBe(40000);
  });

  it("leaves the remainder for discretionary spending", () => {
    const r = fundGoalsInPriorityOrder([travel, gear], 200000);
    expect(r.remainingCents).toBe(60000);
  });

  it("treats a negative availability as nothing to allocate", () => {
    const r = fundGoalsInPriorityOrder([travel], -5000);
    expect(r.allocations[0].fundedCents).toBe(0);
    expect(r.remainingCents).toBe(0);
  });

  it("flags goals with unknown targets", () => {
    const r = fundGoalsInPriorityOrder([{ ...gear, monthlyTarget: unknown("not set") }], 1000);
    expect(r.allocations[0].hasUnknowns).toBe(true);
    expect(r.allocations[0].wantedCents).toBe(0);
  });

  it("computes months to target", () => {
    expect(monthsToTarget({ targetTotalCents: 1000000, savedCents: 250000 }, 100000)).toBe(8);
    expect(monthsToTarget({ targetTotalCents: 1000000, savedCents: 1000000 }, 100000)).toBe(0);
    expect(monthsToTarget({ targetTotalCents: 1000000, savedCents: 0 }, 0)).toBeNull();
    expect(monthsToTarget({ targetTotalCents: null }, 100)).toBeNull();
  });
});
