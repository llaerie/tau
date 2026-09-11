import type { ReactNode } from "react";

export function Card({ children, className = "", padded = true, tone }: { children: ReactNode; className?: string; padded?: boolean; tone?: "default" | "warn" | "bad" | "ok" | "accent" }) {
  const toneCls =
    tone === "warn" ? "border-warn/40 bg-warn-soft/40" : tone === "bad" ? "border-bad/40 bg-bad-soft/40" : tone === "ok" ? "border-ok/40 bg-ok-soft/40" : tone === "accent" ? "border-accent/40 bg-accent-soft/40" : "bg-surface border-line";
  return <div className={`rounded-lg border shadow-[var(--shadow)] ${toneCls} ${padded ? "p-4" : ""} ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, className = "" }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex flex-wrap items-start justify-between gap-2 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
