"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/finance/money";

export interface ProjectionPoint {
  month: string;
  label: string;
  before: number | null;
  after?: number | null;
}

function money(v: number) {
  const abs = Math.abs(v);
  const s = abs >= 100000 ? `$${Math.round(v / 10000) / 10}k` : formatCents(v);
  return abs >= 100000 ? s.replace("$-", "-$") : s;
}

export function ProjectionChart({ points, floorCents, beforeLabel = "Cash", afterLabel = "With purchase" }: { points: ProjectionPoint[]; floorCents?: number | null; beforeLabel?: string; afterLabel?: string }) {
  const hasAfter = points.some((p) => p.after !== undefined);
  return (
    <div className="h-56 w-full min-w-0 overflow-hidden sm:h-64" role="img" aria-label={`Projected ${beforeLabel.toLowerCase()} by month`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--t-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--t-line-2)" }} />
          <YAxis tickFormatter={money} width={58} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(v, name) => [formatCents(Number(v)), name === "before" ? beforeLabel : afterLabel]}
            labelStyle={{ color: "var(--t-ink-2)", fontSize: 12 }}
            contentStyle={{ borderRadius: 10, border: "1px solid var(--t-line-2)", background: "var(--t-surface)", color: "var(--t-ink)", fontSize: 13 }}
          />
          <ReferenceLine y={0} stroke="var(--t-bad)" strokeDasharray="4 4" />
          {floorCents != null && floorCents > 0 && <ReferenceLine y={floorCents} stroke="var(--t-warn)" strokeDasharray="2 4" label={{ value: "reserve target", position: "insideTopLeft", fontSize: 11, fill: "var(--t-warn)" }} />}
          <Line type="monotone" dataKey="before" name="before" stroke={hasAfter ? "var(--t-series-muted)" : "var(--t-series-1)"} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          {hasAfter && <Line type="monotone" dataKey="after" name="after" stroke="var(--t-series-2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
