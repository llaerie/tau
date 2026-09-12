import type { ReactNode } from "react";

/**
 * The shared composition for a money space: one named principal figure on an
 * atmospheric panel, supporting figures demoted beneath it, and anything dense
 * behind a disclosure. Same anatomy as My money so the spaces read as one product.
 */
export function FeaturePanel({ label, figure, caption, evidence, callout, footer, testId }: { label: string; figure: ReactNode; caption?: ReactNode; evidence?: ReactNode; callout?: ReactNode; footer?: ReactNode; testId?: string }) {
  return (
    <section className="fd-feature-panel overflow-hidden" data-testid={testId}>
      <div className="fd-atmosphere px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label">{label}</p>
            <div className="mt-2">{figure}</div>
            {caption && <p className="mt-2.5 max-w-lg text-[14px] leading-relaxed text-ink-2">{caption}</p>}
          </div>
          {evidence && <span className="shrink-0">{evidence}</span>}
        </div>
        {callout && <div className="mt-4">{callout}</div>}
      </div>
      {footer}
    </section>
  );
}

/** Supporting figures. Deliberately smaller than the panel's principal figure. */
export function SupportRow({ items }: { items: { id: string; label: string; value: ReactNode; note?: string; testId?: string }[] }) {
  return (
    <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((it) => (
        <div key={it.id} className="min-w-0 px-5 py-3.5 sm:px-6" data-testid={it.testId}>
          <dt className="text-[12.5px] leading-snug text-ink-3">{it.label}</dt>
          <dd className="mt-1 text-[17px] font-semibold">{it.value}</dd>
          {it.note && <p className="mt-1 text-[12px] leading-snug text-ink-3">{it.note}</p>}
        </div>
      ))}
    </dl>
  );
}

/** Dense detail, collapsed by default. Accounting tables live here, not on the surface. */
export function Disclosure({ title, hint, children, id, testId, defaultOpen }: { title: string; hint?: string; children: ReactNode; id?: string; testId?: string; defaultOpen?: boolean }) {
  return (
    <details className="group card overflow-hidden" id={id} data-testid={testId} open={defaultOpen}>
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-2">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">{title}</span>
          {hint && <span className="block text-[12.5px] leading-snug text-ink-3">{hint}</span>}
        </span>
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line px-5 py-4">{children}</div>
    </details>
  );
}

/** Unknown inputs, stated plainly. Never a green confirmation. */
export function UnknownCallout({ items, action }: { items: string[]; action?: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-[var(--fd-radius-card)] bg-surface px-4 py-3.5" data-testid="unknown-costs">
      <p className="text-[13px] font-semibold">Still unknown, and not zero</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink-2">
            <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
            <span>{x}</span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ListRow({ title, meta, value, badges, children, testId }: { title: ReactNode; meta?: ReactNode; value?: ReactNode; badges?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <li className="py-3" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-snug">{title}</span>
          {meta && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{meta}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badges}
          {value}
        </span>
      </div>
      {children}
    </li>
  );
}
