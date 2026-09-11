import { fundGoalsInPriorityOrder } from "./goals";
import { formatCents, type Total } from "./money";
import { project, type Projection, type ProjectionEvent, type ProjectionInput } from "./projection";
import type { GoalFundingResult, GoalInput } from "./types";

export type PurchaseKind = "one_time" | "recurring";

export interface PurchaseInput {
  name: string;
  amountCents: number;
  kind: PurchaseKind;
  /** Months the recurring cost lasts; null = ongoing. Ignored for one-time purchases. */
  recurringMonths?: number | null;
  /** 0 = this month. */
  startMonthOffset: number;
}

export interface ScenarioBaseline {
  spaceLabel: string;
  projection: ProjectionInput;
  /** Money available for goals each month after obligations (before goals). */
  availableForGoalsCents: number;
  /** Whether availableForGoalsCents is complete (no unknowns). */
  availableComplete: boolean;
  goals: GoalInput[];
  /** Optional cash floor the space wants to keep (e.g. company reserve target). */
  cashFloorCents?: number | null;
  /** Planned discretionary spending (budgets) that comes after goals. */
  plannedSpendingCents?: number;
  /** Monthly surplus after goals, for context. */
  monthlySurplus?: Total;
}

export interface GoalImpact {
  goalId: string;
  name: string;
  priority: number;
  fundedBeforeCents: number;
  fundedAfterCents: number;
  monthsToTargetBefore: number | null;
  monthsToTargetAfter: number | null;
  delayMonths: number | null;
}

export type ScenarioVerdict = "affordable" | "affordable_with_goal_cuts" | "creates_shortfall" | "unknown";

export interface ScenarioResult {
  purchase: PurchaseInput;
  before: { projection: Projection; goals: GoalFundingResult };
  after: { projection: Projection; goals: GoalFundingResult };
  monthlyCostCents: number;
  totalCostCents: number | null;
  endingCashDeltaCents: number | null;
  minCashBeforeCents: number | null;
  minCashAfterCents: number | null;
  breachesFloor: boolean;
  goalImpacts: GoalImpact[];
  verdict: ScenarioVerdict;
  notes: string[];
  assumptions: string[];
}

export function purchaseEvent(p: PurchaseInput): ProjectionEvent {
  return p.kind === "one_time"
    ? { monthOffset: p.startMonthOffset, amountCents: -p.amountCents, label: p.name }
    : { monthOffset: p.startMonthOffset, amountCents: -p.amountCents, label: p.name, repeatMonths: p.recurringMonths ?? null };
}

/**
 * Apply a proposed purchase to a space. Recurring costs come out of the money
 * that funds goals, so the lowest-priority goals lose funding first and the
 * top-priority goal is protected as long as possible. One-time purchases come
 * out of cash. Nothing else is changed: the result reports what breaks.
 */
export function evaluatePurchase(baseline: ScenarioBaseline, purchase: PurchaseInput): ScenarioResult {
  const notes: string[] = [];
  const assumptions: string[] = [
    "Recurring costs reduce the pool that funds goals; goals keep their priority order and the lowest priority loses funding first.",
    "One-time purchases are paid from cash in the chosen month.",
  ];
  const before = project(baseline.projection);
  const after = project({ ...baseline.projection, events: [...(baseline.projection.events ?? []), purchaseEvent(purchase)] });

  const goalsBefore = fundGoalsInPriorityOrder(baseline.goals, baseline.availableComplete ? baseline.availableForGoalsCents : 0);
  const monthlyCost = purchase.kind === "recurring" ? purchase.amountCents : 0;
  const goalsAfter = fundGoalsInPriorityOrder(baseline.goals, baseline.availableComplete ? baseline.availableForGoalsCents - monthlyCost : 0);

  const goalImpacts: GoalImpact[] = goalsBefore.allocations.map((b) => {
    const a = goalsAfter.allocations.find((x) => x.goalId === b.goalId)!;
    const delay = b.monthsToTarget === null || a.monthsToTarget === null ? (b.monthsToTarget !== null && a.monthsToTarget === null && b.fundedCents > 0 ? Infinity : null) : a.monthsToTarget - b.monthsToTarget;
    return {
      goalId: b.goalId,
      name: b.name,
      priority: b.priority,
      fundedBeforeCents: b.fundedCents,
      fundedAfterCents: a.fundedCents,
      monthsToTargetBefore: b.monthsToTarget,
      monthsToTargetAfter: a.monthsToTarget,
      delayMonths: delay,
    };
  });

  // Recurring costs also squeeze the spending plan once goals are funded.
  const planned = baseline.plannedSpendingCents ?? 0;
  const headroomBefore = baseline.availableComplete ? baseline.availableForGoalsCents - goalsBefore.totalFundedCents - planned : null;
  const headroomAfter = baseline.availableComplete ? baseline.availableForGoalsCents - monthlyCost - goalsAfter.totalFundedCents - planned : null;
  const squeezesPlan = purchase.kind === "recurring" && headroomBefore !== null && headroomAfter !== null && headroomAfter < 0 && headroomAfter < headroomBefore;

  const totalCost = purchase.kind === "one_time" ? purchase.amountCents : purchase.recurringMonths ? purchase.amountCents * purchase.recurringMonths : null;
  const endingDelta = before.endingCashCents !== null && after.endingCashCents !== null ? after.endingCashCents - before.endingCashCents : null;
  const floor = baseline.cashFloorCents ?? 0;
  const breachesFloor = after.minCashCents !== null && after.minCashCents < floor && !(before.minCashCents !== null && before.minCashCents < floor);

  let verdict: ScenarioVerdict;
  const unknown = !baseline.availableComplete || after.unknowns.length > 0;
  const cutsGoals = goalsAfter.totalFundedCents < goalsBefore.totalFundedCents;
  const negativeCash = after.minCashCents !== null && after.minCashCents < 0;
  const recurringShortfall = purchase.kind === "recurring" && baseline.availableComplete && baseline.availableForGoalsCents - monthlyCost - goalsAfter.totalWantedCents < 0 && goalsAfter.totalShortfallCents > goalsBefore.totalShortfallCents;

  if (negativeCash || (recurringShortfall && goalsAfter.allocations.some((g) => g.priority === 1 && g.shortfallCents > 0))) verdict = "creates_shortfall";
  else if (cutsGoals || squeezesPlan) verdict = "affordable_with_goal_cuts";
  else if (unknown) verdict = "unknown";
  else verdict = "affordable";

  if (unknown) notes.push(`Some inputs are unknown (${[...new Set([...after.unknowns, ...(baseline.availableComplete ? [] : ["available money for goals"])])].join("; ")}). The verdict is based on known figures only.`);
  if (negativeCash) notes.push(`Cash would go below zero in ${after.firstNegativeMonth}.`);
  if (breachesFloor) notes.push(`Cash would drop below the ${formatCents(floor)} floor (minimum ${formatCents(after.minCashCents ?? 0)}).`);
  for (const g of goalImpacts) {
    if (g.fundedAfterCents < g.fundedBeforeCents) {
      const delay = g.delayMonths === Infinity ? "would never reach its target" : g.delayMonths !== null && g.delayMonths > 0 ? `is delayed by ${g.delayMonths} month(s)` : "loses monthly funding";
      notes.push(`${g.name} (priority ${g.priority}) drops from ${formatCents(g.fundedBeforeCents)} to ${formatCents(g.fundedAfterCents)} per month and ${delay}.`);
    }
  }
  if (squeezesPlan && headroomAfter !== null) notes.push(`The spending plan (${formatCents(planned)} a month) would be short by ${formatCents(-headroomAfter)} after this cost${headroomBefore !== null && headroomBefore < 0 ? ` (it was already short by ${formatCents(-headroomBefore)})` : ""}.`);
  if (endingDelta !== null) notes.push(`Cash after ${baseline.projection.months} months changes by ${formatCents(endingDelta, { signed: true })}.`);

  return {
    purchase,
    before: { projection: before, goals: goalsBefore },
    after: { projection: after, goals: goalsAfter },
    monthlyCostCents: monthlyCost,
    totalCostCents: totalCost,
    endingCashDeltaCents: endingDelta,
    minCashBeforeCents: before.minCashCents,
    minCashAfterCents: after.minCashCents,
    breachesFloor,
    goalImpacts,
    verdict,
    notes,
    assumptions,
  };
}
