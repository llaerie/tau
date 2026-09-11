import { Cents } from "@/components/Money";
import { Card, CardTitle, EmptyState } from "@/components/ui";
import type { BudgetLine } from "@/lib/finance/personal";
import type { Total } from "@/lib/finance/money";
import { TotalText } from "@/components/Money";

export function SpendingPlanCard({ budgets, planned, editHref, title = "Spending plan", netUnknown }: { budgets: BudgetLine[]; planned: Total; editHref: string; title?: string; netUnknown?: boolean }) {
  return (
    <Card>
      <CardTitle right={<a href={editHref} className="link text-[12px]">Manage</a>}>{title}</CardTitle>
      {budgets.length === 0 ? (
        <EmptyState title="No spending plan yet">Add budgets to plan discretionary money by category and track what is actually spent.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {budgets.map((b) => {
            const pct = b.plannedCents && b.actualCents !== null ? Math.min(100, Math.round((b.actualCents / b.plannedCents) * 100)) : 0;
            const over = b.remainingCents !== null && b.remainingCents < 0;
            return (
              <li key={b.id}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-medium">{b.name}</span>
                  <span className="num whitespace-nowrap text-ink-2">
                    {b.actualCents !== null ? <Cents value={b.actualCents} /> : <span className="text-ink-3">not tracked</span>}
                    <span className="text-ink-3"> / </span>
                    {b.plannedCents === null ? <span className="chip chip-unknown">Unknown</span> : <Cents value={b.plannedCents} />}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className={`h-full rounded-full ${over ? "bg-bad" : pct >= 85 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                </div>
                {over && <p className="mt-0.5 text-[11.5px] text-bad">Over by <Cents value={-b.remainingCents!} /></p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-2.5 text-[13px]">
        <span className="text-ink-2">Planned per month</span>
        {netUnknown ? <span className="chip chip-unknown">Depends on net</span> : <TotalText total={planned} size="sm" />}
      </div>
    </Card>
  );
}
