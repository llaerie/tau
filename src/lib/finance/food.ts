import { formatCents, formatTotal, total, type Total } from "./money";
import type { Metric } from "./types";
import type { TakeHomeResult } from "./payroll";

export interface PersonalAllocation {
  id: string;
  name: string;
  monthlyCents: number;
  /** savings and investment contributions are transfers to the person's own future, not consumption. */
  kind: "savings" | "investment" | "spending";
}

export interface FoodPlanInput {
  personId: string;
  name: string;
  takeHome: TakeHomeResult;
  /** Monthly food target. Null = not set. */
  foodTargetCents: number | null;
  /** Food actually spent this period: the person's shares of food expenses, tax/tip/delivery included. */
  foodSpentCents: number;
  foodTransactionCount: number;
  allocations: PersonalAllocation[];
  /** Other fixed personal obligations (bills) this period. */
  fixedBillsCents: Total;
  householdContributionCents: number;
}

export interface FoodPlanResult {
  takeHome: Metric;
  foodTarget: number | null;
  foodSpentCents: number;
  /** target − spent; null when no target. */
  foodRemainingCents: number | null;
  foodStatus: "no_target" | "on_track" | "close" | "over";
  /** take-home − fixed bills − contribution − food target − allocations. Unknown while take-home is incomplete. */
  unallocated: Metric;
  allocationsTotalCents: number;
  savingsCents: number;
  spendingAllocationsCents: number;
  nextStep: { key: string; label: string } | null;
}

/**
 * The food target is planning capacity. Actual food spending is tracked against
 * the target. The unallocated plan subtracts the target ONCE; it never also
 * subtracts the spending.
 */
export function computeFoodPlan(input: FoodPlanInput): FoodPlanResult {
  const th = input.takeHome.takeHome;
  const allocationsTotal = input.allocations.reduce((a, x) => a + x.monthlyCents, 0);
  const savings = input.allocations.filter((a) => a.kind !== "spending").reduce((a, x) => a + x.monthlyCents, 0);
  const foodTarget = input.foodTargetCents;
  const unallocated = total(
    th.knownCents - input.fixedBillsCents.knownCents - input.householdContributionCents - (foodTarget ?? 0) - allocationsTotal,
    [...th.unknowns, ...input.fixedBillsCents.unknowns, ...(foodTarget === null ? ["Food target not set"] : [])],
  );
  const remaining = foodTarget === null ? null : foodTarget - input.foodSpentCents;
  const foodStatus: FoodPlanResult["foodStatus"] = foodTarget === null ? "no_target" : remaining! < 0 ? "over" : remaining! <= foodTarget * 0.15 ? "close" : "on_track";
  const nextStep = foodTarget === null ? { key: "set-food-target", label: "Set a food target" } : !th.complete ? { key: "confirm-withholding", label: "Confirm payroll withholding" } : null;

  return {
    takeHome: {
      id: `${input.personId}-take-home`,
      label: input.takeHome.status === "verified" ? "Take-home pay" : "Take-home estimate",
      total: th,
      provenance: {
        formula: "gross − employee FICA − CA SDI − income tax withheld",
        inputs: [
          { label: "Gross salary", value: fmt(input.takeHome.gross), source: "Settings → People" },
          { label: "FICA (employee)", value: fmt(input.takeHome.fica), source: "Payroll rules" },
          { label: "CA SDI", value: fmt(input.takeHome.sdi), source: "Payroll rules" },
          { label: "Income tax withheld", value: fmt(input.takeHome.incomeTax), source: "Settings → People → Withholding" },
        ],
        assumptions: input.takeHome.assumptions,
        caveats: th.complete ? (input.takeHome.verified ? [] : ["An estimate, not a verified paycheck."]) : ["Incomplete: an exact available-to-spend figure cannot be given yet."],
      },
    },
    foodTarget,
    foodSpentCents: input.foodSpentCents,
    foodRemainingCents: remaining,
    foodStatus,
    unallocated: {
      id: `${input.personId}-unallocated`,
      label: "Unallocated personal plan",
      total: unallocated,
      provenance: {
        formula: "take-home − fixed bills − household contribution − food target − optional allocations",
        inputs: [
          { label: "Take-home", value: formatTotal(th), source: "Computed" },
          { label: "Fixed bills", value: formatTotal(input.fixedBillsCents), source: "Bills" },
          { label: "Household contribution", value: formatCents(input.householdContributionCents), source: "Settings → People" },
          { label: "Food target", value: foodTarget === null ? "not set" : formatCents(foodTarget), source: "Settings → Budget" },
          { label: "Allocations", value: formatCents(allocationsTotal), source: "Settings → Budget" },
        ],
        assumptions: ["The food target is subtracted once as planning capacity; actual food spending is tracked separately against it.", "Savings and investment allocations are transfers to your own future, not consumption."],
        caveats: unallocated.complete ? (unallocated.knownCents < 0 ? [`Over-planned by ${formatCents(-unallocated.knownCents)}.`] : []) : ["Unknown until the missing inputs are entered."],
      },
    },
    allocationsTotalCents: allocationsTotal,
    savingsCents: savings,
    spendingAllocationsCents: allocationsTotal - savings,
    nextStep,
  };
}

function fmt(a: { kind: "known"; cents: number } | { kind: "unknown"; reason: string }): string {
  return a.kind === "known" ? formatCents(a.cents) : "Unknown";
}
