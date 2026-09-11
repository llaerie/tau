import type { ScenarioBaseline } from "../finance/scenario";
import { toGoalInputs } from "../data/spaces";
import type { SpaceView } from "./index";

/** Turn a space view into the baseline a purchase scenario is evaluated against. */
export function scenarioBaseline(view: SpaceView): ScenarioBaseline {
  if (view.kind === "company") {
    const d = view.result.distributable.total;
    return {
      spaceLabel: view.space.name,
      projection: view.projectionInput,
      availableForGoalsCents: d.knownCents,
      availableComplete: d.complete,
      goals: [],
      cashFloorCents: view.result.reserveTarget.total.complete ? view.result.reserveTarget.total.knownCents : null,
      monthlySurplus: d,
    };
  }
  if (view.kind === "household") {
    const afterBills = view.result.lines.find((l) => l.id === "bills")!.running;
    return {
      spaceLabel: "Household",
      projection: view.projectionInput,
      availableForGoalsCents: afterBills.knownCents,
      availableComplete: afterBills.complete,
      goals: toGoalInputs(view.data.goals),
      cashFloorCents: 0,
      monthlySurplus: view.result.surplus.total,
    };
  }
  const after = view.result.afterObligations;
  return {
    spaceLabel: view.personName,
    projection: view.projectionInput,
    availableForGoalsCents: after.knownCents,
    availableComplete: after.complete,
    goals: toGoalInputs(view.data.goals),
    cashFloorCents: 0,
    plannedSpendingCents: view.result.plannedSpending.knownCents,
    monthlySurplus: view.result.unallocated.total,
  };
}
