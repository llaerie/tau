import { ProjectionChart } from "@/components/charts/ProjectionChart";
import { Cents } from "@/components/Money";
import { Card, CardTitle, Notice, shortMonth } from "@/components/ui";
import type { Projection } from "@/lib/finance/projection";

export function ProjectionSection({ projection, floorCents, title = "Next six months" }: { projection: Projection; floorCents?: number | null; title?: string }) {
  const points = projection.months.map((m) => ({ month: m.month, label: shortMonth(m.month), before: m.endingCashCents }));
  return (
    <Card>
      <CardTitle right={<span className="text-[12px] text-ink-3">Ending cash from today&apos;s known monthly flows</span>}>{title}</CardTitle>
      {projection.unknowns.length > 0 && (
        <div className="mt-3">
          <Notice tone="unknown">
            Known flows only. Not included because unknown: {projection.unknowns.join("; ")}.
          </Notice>
        </div>
      )}
      {projection.months[0].endingCashCents === null ? (
        <p className="mt-4 text-sm text-ink-3">Enter the starting balances to draw the projection.</p>
      ) : (
        <div className="mt-3">
          <ProjectionChart points={points} floorCents={floorCents} />
        </div>
      )}
      <div className="table-wrap mt-3">
        <table className="data">
          <thead>
            <tr>
              <th>Month</th>
              <th className="r">In</th>
              <th className="r">Out</th>
              <th className="r">Net</th>
              <th className="r">Ending cash</th>
            </tr>
          </thead>
          <tbody>
            {projection.months.map((m) => (
              <tr key={m.month}>
                <td>{shortMonth(m.month)}</td>
                <td className="r"><Cents value={m.inflowCents} /></td>
                <td className="r"><Cents value={-m.outflowCents} /></td>
                <td className="r"><Cents value={m.netCents} signed className={m.netCents < 0 ? "text-bad" : ""} /></td>
                <td className="r">{m.endingCashCents === null ? <span className="chip chip-unknown">Unknown</span> : <Cents value={m.endingCashCents} className={m.endingCashCents < 0 ? "text-bad" : ""} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
