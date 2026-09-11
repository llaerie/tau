import type { ScenarioBaseline } from "../finance/scenario";
import { toGoalInputs } from "../data/spaces";
import { known, unknown } from "../finance/money";
import type { SpaceView } from "./index";

/** Turn a space view into the baseline a purchase scenario is evaluated against. */
export function scenarioBaseline(view: SpaceView): ScenarioBaseline {
  if (view.kind === "company") {
    const r = view.plan.partialRemainder.total;
    return {
      spaceLabel: view.space.name,
      projection: view.projectionInput,
      availableForGoalsCents: r.knownCents,
      availableComplete: r.complete,
      goals: [],
      cashFloorCents: view.plan.recordedCash.total.complete && view.data.accounts.length ? 0 : null,
      monthlySurplus: r,
    };
  }
  if (view.kind === "household") {
    return {
      spaceLabel: "Household",
      projection: { startingCash: view.cash, startMonth: view.month, months: 6, monthlyInflows: [], monthlyOutflows: view.ownBills.map((b) => ({ label: b.name, amount: b.monthlyCents === null ? unknown(`${b.name} unknown`) : known(b.monthlyCents) })) },
      availableForGoalsCents: 0,
      availableComplete: false,
      goals: toGoalInputs(view.data.goals),
      cashFloorCents: 0,
      monthlySurplus: view.ownBillsTotal,
    };
  }
  const u = view.food.unallocated.total;
  return {
    spaceLabel: view.personName,
    projection: {
      startingCash: view.cash,
      startMonth: view.month,
      months: 6,
      monthlyInflows: [{ label: "Take-home", amount: view.takeHome.takeHome.complete ? known(view.takeHome.takeHome.knownCents) : unknown("take-home incomplete") }],
      monthlyOutflows: [
        { label: "Fixed bills", amount: view.fixedBillsTotal.complete ? known(view.fixedBillsTotal.knownCents) : unknown("bills unknown") },
        { label: "Food target", amount: view.food.foodTarget === null ? unknown("food target not set") : known(view.food.foodTarget) },
        { label: "Allocations", amount: known(view.food.allocationsTotalCents) },
      ],
    },
    availableForGoalsCents: u.knownCents,
    availableComplete: u.complete,
    goals: toGoalInputs(view.data.goals),
    cashFloorCents: 0,
    plannedSpendingCents: 0,
    monthlySurplus: u,
  };
}
