import { AmountText, Cents } from "@/components/Money";
import { Card, EmptyState } from "@/components/ui";
import type { Bill } from "@/lib/db/schema";
import type { BillPeriodStatus } from "@/lib/finance/classify";
import { amountFromNullable } from "@/lib/finance/money";

export function BillsCard({ bills, statuses, unpaidCommittedCents, editHref }: { bills: Bill[]; statuses: BillPeriodStatus[]; unpaidCommittedCents: number; editHref: string }) {
  const byId = new Map(statuses.map((s) => [s.billId, s]));
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">Bills this month</h3>
        <a href={editHref} className="link text-xs">Manage</a>
      </div>
      {bills.length === 0 ? (
        <div className="mt-3"><EmptyState title="No bills yet">Add recurring bills so commitments are counted.</EmptyState></div>
      ) : (
        <div className="table-wrap mt-2">
          <table className="data">
            <thead>
              <tr>
                <th>Bill</th>
                <th className="r">Monthly</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const st = byId.get(b.id);
                return (
                  <tr key={b.id}>
                    <td>
                      {b.name}
                      <span className="block text-xs text-ink-3">{b.cadence}{b.dueDay ? ` · due ${b.dueDay}` : ""}</span>
                    </td>
                    <td className="r">{st?.dueCents != null ? <Cents value={st.dueCents} /> : <AmountText amount={amountFromNullable(b.amountCents, "amount not entered")} />}</td>
                    <td>{st?.paid ? <span className="chip chip-good">Paid <Cents value={st.paidCents} /></span> : <span className="chip chip-neutral">Due</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-3">
        Still to pay this month: <Cents value={unpaidCommittedCents} className="text-ink" />. Paid bills are already out of cash and are not counted twice.
      </p>
    </Card>
  );
}
