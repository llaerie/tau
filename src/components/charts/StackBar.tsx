import { formatCents } from "@/lib/finance/money";

export interface StackSegment {
  label: string;
  cents: number;
  color: string;
}

/** A single horizontal stacked bar with direct labels and a legend. Pure CSS; scales to any width. */
export function StackBar({ segments, totalCents, caption }: { segments: StackSegment[]; totalCents?: number; caption?: string }) {
  const visible = segments.filter((s) => s.cents > 0);
  const sum = visible.reduce((a, s) => a + s.cents, 0);
  const denom = Math.max(totalCents ?? sum, sum, 1);
  return (
    <figure>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-md bg-surface-3" role="img" aria-label={caption}>
        {visible.map((s) => (
          <div key={s.label} style={{ width: `${(s.cents / denom) * 100}%`, background: s.color }} title={`${s.label}: ${formatCents(s.cents)}`} />
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {visible.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="num text-ink">{formatCents(s.cents)}</span>
          </span>
        ))}
        {totalCents !== undefined && totalCents > sum && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-surface-3 ring-1 ring-line-2" />
            Remaining <span className="num text-ink">{formatCents(totalCents - sum)}</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
