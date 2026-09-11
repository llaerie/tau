import type { ReactNode } from "react";

export function Section({ id, title, description, actions, children, className = "" }: { id?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-20 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Grid({ children, cols = 3, className = "" }: { children: ReactNode; cols?: 2 | 3 | 4 | 6; className?: string }) {
  const c = cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-6";
  return <div className={`grid grid-cols-1 gap-3 ${c} ${className}`}>{children}</div>;
}
