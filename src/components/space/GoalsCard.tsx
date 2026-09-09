import { Cents } from "@/components/Money";
import { Card, EmptyState } from "@/components/ui";
import type { GoalFundingResult } from "@/lib/finance/types";

export function GoalsCard({ goals, editHref, netUnknown, title = "Goals in priority order" }: { goals: GoalFundingResult | null; editHref: string; netUnknown?: boolean; title?: string }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <a href={editHref} className="link text-xs">Manage</a>
      </div>
      {!goals || goals.allocations.length === 0 ? (
        <div className="mt-3"><EmptyState title="No goals yet" /></div>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Goal</th>
                <th className="r">Wanted</th>
                <th className="r">Funded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {goals.allocations.map((g) => (
                <tr key={g.goalId}>
                  <td className="num text-ink-3">{g.priority}</td>
                  <td>
                    {g.name}
                    {g.rule && <span className="block text-xs text-ink-3">{g.rule}</span>}
                    {g.monthsToTarget !== null && <span className="block text-xs text-ink-3">{g.monthsToTarget === 0 ? "Target reached" : `${g.monthsToTarget} months to target at this rate`}</span>}
                  </td>
                  <td className="r">{g.hasUnknowns ? <span className="chip chip-unknown">Unknown</span> : <Cents value={g.wantedCents} />}</td>
                  <td className="r">{netUnknown ? <span className="chip chip-unknown">Unknown</span> : <Cents value={g.fundedCents} />}</td>
                  <td>
                    {netUnknown ? (
                      <span className="chip chip-unknown">Depends on net</span>
                    ) : g.shortfallCents === 0 && g.wantedCents > 0 ? (
                      <span className="chip chip-good">Fully funded</span>
                    ) : g.fundedCents > 0 ? (
                      <span className="chip chip-warn">Short <Cents value={g.shortfallCents} /></span>
                    ) : g.wantedCents > 0 ? (
                      <span className="chip chip-bad">Unfunded</span>
                    ) : (
                      <span className="chip chip-neutral">No target</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
