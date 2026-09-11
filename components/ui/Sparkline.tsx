/** Dependency-free SVG sparkline. Values are JS numbers for display only. */
export function Sparkline({ values, width = 220, height = 48, labels, className = "" }: { values: number[]; width?: number; height?: number; labels?: string[]; className?: string }) {
  if (values.length === 0) return <div className="text-[12px] text-muted">No data</div>;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const x = (i: number) => pad + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => pad + h - ((v - min) / span) * h;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={`block max-w-full ${className}`} role="img" aria-label={labels ? `Trend ${labels[0]} to ${labels[labels.length - 1]}` : "Trend"}>
      <line x1={pad} x2={width - pad} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeDasharray="2 3" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 2.5 : 1.5} fill={v < 0 ? "var(--red)" : "var(--accent)"}>
          {labels ? <title>{`${labels[i]}: ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}</title> : null}
        </circle>
      ))}
      <circle cx={x(values.length - 1)} cy={y(last)} r={4} fill="none" stroke={last < 0 ? "var(--red)" : "var(--accent)"} strokeWidth={1} />
    </svg>
  );
}

export function Bars({ values, height = 40, className = "" }: { values: { label: string; value: number; tone?: "ok" | "bad" | "accent" | "warn" }[]; height?: number; className?: string }) {
  const max = Math.max(...values.map((v) => Math.abs(v.value)), 1);
  return (
    <div className={`flex items-end gap-[3px] ${className}`} style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="flex h-full flex-1 items-end" title={`${v.label}: ${v.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}>
          <div className={`w-full rounded-sm ${v.tone === "bad" ? "bg-bad" : v.tone === "ok" ? "bg-ok" : v.tone === "warn" ? "bg-warn" : "bg-accent"}`} style={{ height: `${Math.max(2, Math.round((Math.abs(v.value) / max) * height))}px`, opacity: 0.85 }} />
        </div>
      ))}
    </div>
  );
}
