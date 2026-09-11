import { describe, expect, it } from "vitest";
import { computeFoodPlan } from "./food";
import { known, total } from "./money";
import { computeTakeHome, PAYROLL_RULES_2026 } from "./payroll";

const estimate = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: 25000, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "estimate" });
const incomplete = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: null, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "none" });

const base = { personId: "arielle", name: "Arielle", foodTransactionCount: 3, allocations: [], fixedBillsCents: total(6000), householdContributionCents: 0 };

describe("personal food plan", () => {
  it("offers to set a target instead of inventing one", () => {
    const r = computeFoodPlan({ ...base, takeHome: estimate, foodTargetCents: null, foodSpentCents: 21000 });
    expect(r.foodStatus).toBe("no_target");
    expect(r.foodRemainingCents).toBeNull();
    expect(r.nextStep?.key).toBe("set-food-target");
    expect(r.unallocated.total.complete).toBe(false);
  });

  it("does not double subtract actual spending from the plan", () => {
    const r = computeFoodPlan({ ...base, takeHome: estimate, foodTargetCents: 120000, foodSpentCents: 45000 });
    // 2,481.50 − 60 − 1,200 = 1,221.50 regardless of spending
    expect(r.unallocated.total.knownCents).toBe(248150 - 6000 - 120000);
    expect(r.foodRemainingCents).toBe(75000);
    expect(r.foodStatus).toBe("on_track");
    const more = computeFoodPlan({ ...base, takeHome: estimate, foodTargetCents: 120000, foodSpentCents: 118000 });
    expect(more.unallocated.total.knownCents).toBe(r.unallocated.total.knownCents);
    expect(more.foodStatus).toBe("close");
  });

  it("savings and investment allocations are not consumption and not new earnings", () => {
    const r = computeFoodPlan({
      ...base,
      takeHome: estimate,
      foodTargetCents: 100000,
      foodSpentCents: 0,
      allocations: [
        { id: "s", name: "Savings", monthlyCents: 50000, kind: "savings" },
        { id: "i", name: "Index fund", monthlyCents: 30000, kind: "investment" },
        { id: "sh", name: "Shopping", monthlyCents: 20000, kind: "spending" },
      ],
    });
    expect(r.savingsCents).toBe(80000);
    expect(r.spendingAllocationsCents).toBe(20000);
    expect(r.unallocated.total.knownCents).toBe(248150 - 6000 - 100000 - 100000);
  });

  it("keeps the unallocated plan unknown while take-home is incomplete, without blocking food tracking", () => {
    const r = computeFoodPlan({ ...base, takeHome: incomplete, foodTargetCents: 90000, foodSpentCents: 30000 });
    expect(r.unallocated.total.complete).toBe(false);
    expect(r.foodRemainingCents).toBe(60000);
    expect(r.nextStep?.key).toBe("confirm-withholding");
  });
});
