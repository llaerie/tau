import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="label">{eyebrow}</p>}
        <h1 className="mt-1 text-[22px] font-semibold sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13.5px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions, id }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="mb-7" id={id}>
      <div className="mb-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-[12.5px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`card p-4 sm:p-5 ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="text-[13.5px] font-semibold">{children}</h3>
      {right}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "bad" | "good" | "unknown"; children: ReactNode }) {
  const cls = {
    neutral: "bg-surface-3 text-ink-2 border-line",
    warn: "bg-warn-soft text-warn border-warn/20",
    bad: "bg-bad-soft text-bad border-bad/20",
    good: "bg-good-soft text-good border-good/20",
    unknown: "bg-unknown-soft text-unknown border-unknown/20",
  }[tone];
  return <div className={`rounded-lg border px-3.5 py-2.5 text-[13px] ${cls}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-2 px-4 py-7 text-center">
      <p className="text-[13.5px] font-medium">{title}</p>
      {children && <div className="mt-1 text-[12.5px] text-ink-3">{children}</div>}
    </div>
  );
}

export function ButtonLink({ href, children, variant = "secondary", className = "" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </Link>
  );
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (m === 1 ? ` ${y}` : "");
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
