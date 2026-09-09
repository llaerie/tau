import { Cents } from "@/components/Money";
import { Card, monthLabel } from "@/components/ui";
import type { FlowSummary } from "@/lib/finance/classify";

export function FlowsCard({ flows, month, spaceKind }: { flows: FlowSummary; month: string; spaceKind: "company" | "household" | "personal" }) {
  const rows: { label: string; cents: number; muted?: boolean; sign?: boolean }[] = [
    { label: spaceKind === "company" ? "Revenue received" : "Income received", cents: flows.incomeCents },
    { label: "Contributions received", cents: flows.contributionsInCents },
    { label: "Spending (bills and expenses)", cents: -flows.spendingCents },
    { label: spaceKind === "company" ? "Distributions paid out" : "Contributions sent", cents: -flows.contributionsOutCents },
  ].filter((r) => r.cents !== 0);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">Ledger, {monthLabel(month)}</h3>
        <span className="text-xs text-ink-3">{flows.transactionCount} transactions</span>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-2">{r.label}</dt>
            <dd><Cents value={r.cents} signed /></dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-medium">
          <dt>Net cash flow</dt>
          <dd><Cents value={flows.netCashFlowCents} signed className={flows.netCashFlowCents < 0 ? "text-bad" : ""} /></dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-3">
        Counted once. Excluded on purpose: card payments <Cents value={flows.excluded.ccPaymentsCents} />, moves between own accounts <Cents value={flows.excluded.internalTransfersCents} />
        {flows.withholdingCents > 0 && <> · withholding shown for gross-to-net only <Cents value={flows.withholdingCents} /></>}
        {flows.savingsAllocatedCents > 0 && <> · moved to savings <Cents value={flows.savingsAllocatedCents} /></>}.
      </p>
    </Card>
  );
}
