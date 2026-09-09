import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="label">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-2 sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions, id }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="mb-8" id={id}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-3">{description}</p>}
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

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "bad" | "good" | "unknown"; children: ReactNode }) {
  const cls = { neutral: "bg-surface-3 text-ink-2", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", good: "bg-good-soft text-good", unknown: "bg-unknown-soft text-unknown" }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-3">{children}</div>}
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
