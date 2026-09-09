import { isKnown } from "@/lib/finance/money";
import type { WaterfallLine } from "@/lib/finance/types";
import { AmountText, TotalText } from "./Money";

export function Waterfall({ lines, caption }: { lines: WaterfallLine[]; caption?: string }) {
  return (
    <div className="table-wrap">
      <table className="data">
        {caption && <caption className="pb-2 text-left text-sm text-ink-3">{caption}</caption>}
        <thead>
          <tr>
            <th>Line</th>
            <th className="r">Amount</th>
            <th className="r">Running</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const isResult = l.kind === "result";
            const sign = l.kind === "inflow" ? "+" : l.kind === "outflow" || l.kind === "reserve" ? "−" : "";
            return (
              <tr key={l.id} className={isResult ? "bg-surface-2 font-semibold" : ""}>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{l.label}</span>
                    {l.kind === "reserve" && <span className="chip chip-neutral">reserve</span>}
                  </div>
                  {l.note && <p className="mt-0.5 max-w-prose text-xs text-ink-3">{l.note}</p>}
                  <p className="mt-0.5 text-[11px] text-ink-3/80">{l.source}</p>
                </td>
                <td className="r whitespace-nowrap">
                  {isResult ? (
                    <TotalText total={l.running} size="sm" className={l.running.complete && l.running.knownCents < 0 ? "text-bad" : ""} />
                  ) : (
                    <span className={isKnown(l.amount) ? "" : ""}>
                      {isKnown(l.amount) && <span className="text-ink-3">{sign}</span>}
                      <AmountText amount={l.amount} />
                    </span>
                  )}
                </td>
                <td className="r whitespace-nowrap text-ink-2">{!isResult && <TotalText total={l.running} size="sm" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
