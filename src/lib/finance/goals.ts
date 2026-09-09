import { isKnown } from "./money";
import type { GoalAllocation, GoalFundingResult, GoalInput } from "./types";

/**
 * Fund goals strictly in priority order from `availableCents`. Priority 1 is
 * funded first; a lower priority goal only receives money once every higher
 * priority goal is fully funded. Never reorders goals to make a plan look
 * affordable: shortfalls are reported per goal.
 */
export function fundGoalsInPriorityOrder(goals: GoalInput[], availableCents: number): GoalFundingResult {
  const ordered = [...goals].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  let remaining = Math.max(0, availableCents);
  const allocations: GoalAllocation[] = [];
  let totalWanted = 0;
  let totalFunded = 0;

  for (const g of ordered) {
    const wanted = isKnown(g.monthlyTarget) ? Math.max(0, g.monthlyTarget.cents) : 0;
    const funded = Math.min(wanted, remaining);
    remaining -= funded;
    totalWanted += wanted;
    totalFunded += funded;
    allocations.push({
      goalId: g.id,
      name: g.name,
      priority: g.priority,
      wantedCents: wanted,
      fundedCents: funded,
      shortfallCents: wanted - funded,
      monthsToTarget: monthsToTarget(g, funded),
      hasUnknowns: !isKnown(g.monthlyTarget),
      rule: g.rule,
    });
  }

  return {
    allocations,
    totalWantedCents: totalWanted,
    totalFundedCents: totalFunded,
    totalShortfallCents: totalWanted - totalFunded,
    remainingCents: remaining,
  };
}

export function monthsToTarget(goal: Pick<GoalInput, "targetTotalCents" | "savedCents">, monthlyCents: number): number | null {
  if (goal.targetTotalCents === null || goal.targetTotalCents === undefined) return null;
  const outstanding = goal.targetTotalCents - (goal.savedCents ?? 0);
  if (outstanding <= 0) return 0;
  if (monthlyCents <= 0) return null;
  return Math.ceil(outstanding / monthlyCents);
}
