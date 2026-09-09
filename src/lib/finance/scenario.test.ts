import { describe, expect, it } from "vitest";
import { known } from "./money";
import { evaluatePurchase, type ScenarioBaseline } from "./scenario";

const baseline: ScenarioBaseline = {
  spaceLabel: "Alex",
  projection: {
    startingCash: known(520000),
    startMonth: "2026-09",
    months: 6,
    monthlyInflows: [{ label: "net pay", amount: known(225000) }],
    monthlyOutflows: [{ label: "obligations + goals", amount: known(216000) }],
  },
  availableForGoalsCents: 139000,
  availableComplete: true,
  goals: [
    { id: "travel", name: "Friends travel", monthlyTarget: known(100000), priority: 1 },
    { id: "gear", name: "Camera gear", monthlyTarget: known(30000), priority: 2, targetTotalCents: 180000, savedCents: 0 },
  ],
};

describe("purchase scenarios", () => {
  it("a small one-time purchase is affordable and only moves cash", () => {
    const r = evaluatePurchase(baseline, { name: "Desk", amountCents: 40000, kind: "one_time", startMonthOffset: 0 });
    expect(r.verdict).toBe("affordable");
    expect(r.endingCashDeltaCents).toBe(-40000);
    expect(r.goalImpacts.every((g) => g.fundedAfterCents === g.fundedBeforeCents)).toBe(true);
  });

  it("a recurring cost cuts the lowest-priority goal first and protects friends-travel", () => {
    const r = evaluatePurchase(baseline, { name: "Gym", amountCents: 20000, kind: "recurring", recurringMonths: null, startMonthOffset: 0 });
    expect(r.verdict).toBe("affordable_with_goal_cuts");
    const travel = r.goalImpacts.find((g) => g.goalId === "travel")!;
    const gear = r.goalImpacts.find((g) => g.goalId === "gear")!;
    expect(travel.fundedAfterCents).toBe(100000);
    expect(gear.fundedBeforeCents).toBe(30000);
    expect(gear.fundedAfterCents).toBe(19000);
    expect(gear.monthsToTargetBefore).toBe(6);
    expect(gear.monthsToTargetAfter).toBe(10);
    expect(gear.delayMonths).toBe(4);
    expect(r.notes.join(" ")).toMatch(/Camera gear .* delayed by 4 month/);
  });

  it("a recurring cost that starves the top goal is a shortfall", () => {
    const r = evaluatePurchase(baseline, { name: "Car lease", amountCents: 60000, kind: "recurring", recurringMonths: null, startMonthOffset: 0 });
    expect(r.verdict).toBe("creates_shortfall");
    const travel = r.goalImpacts.find((g) => g.goalId === "travel")!;
    expect(travel.fundedAfterCents).toBe(79000);
  });

  it("a one-time purchase larger than cash creates a shortfall", () => {
    const r = evaluatePurchase(baseline, { name: "Car", amountCents: 900000, kind: "one_time", startMonthOffset: 1 });
    expect(r.verdict).toBe("creates_shortfall");
    expect(r.after.projection.firstNegativeMonth).toBe("2026-10");
  });

  it("reports unknown when the baseline is incomplete", () => {
    const r = evaluatePurchase({ ...baseline, availableComplete: false }, { name: "Desk", amountCents: 100, kind: "one_time", startMonthOffset: 0 });
    expect(r.verdict).toBe("unknown");
  });
});
