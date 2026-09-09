import Link from "next/link";
import { monthLabel } from "@/components/ui";
import { addMonth } from "@/lib/views";

export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <Link className="btn btn-ghost btn-sm" href={`${basePath}?month=${addMonth(month, -1)}`} aria-label="Previous month">‹</Link>
      <span className="min-w-[9rem] text-center font-medium">{monthLabel(month)}</span>
      <Link className="btn btn-ghost btn-sm" href={`${basePath}?month=${addMonth(month, 1)}`} aria-label="Next month">›</Link>
    </div>
  );
}
