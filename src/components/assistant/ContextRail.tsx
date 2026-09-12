"use client";

import Link from "next/link";
import type { Briefing } from "@/lib/views";

export interface RailItem {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "neutral" | "warn" | "unknown";
}

/**
 * One money summary and at most three upcoming or review items. Never repeats
 * the same figure, never adds a chart to fill space.
 */
export function ContextRail({ briefing, items, testId }: { briefing: Briefing; items: RailItem[]; testId: string }) {
  const money = briefing.moneyLine;
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      {money && (
        <section className="card overflow-hidden">
          <div className="fd-atmosphere px-5 pb-4 pt-4">
            <p className="label">{money.label}</p>
            <p className="fd-money mt-1.5 text-[30px] font-semibold leading-none">{money.value}</p>
            {money.caveat && <p className="mt-2 text-[13px] leading-snug text-ink-2">{money.caveat}</p>}
          </div>
          <Link href="/money?space=me" className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line px-5 text-[13.5px] font-medium text-accent hover:bg-surface-2">
            Open My money
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13m-5-5 5 5-5 5" />
            </svg>
          </Link>
        </section>
      )}

      {items.length > 0 && (
        <section className="card px-5 py-4">
          <h2 className="label">Up next</h2>
          <ul className="mt-2.5 space-y-2.5">
            {items.map((it) => (
              <li key={it.id}>
                <Link href={it.href} className="-mx-2 flex min-h-[44px] items-start gap-2.5 rounded-[var(--fd-radius-field)] px-2 py-1.5 hover:bg-surface-2">
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${it.tone === "warn" ? "bg-warn" : it.tone === "unknown" ? "bg-ink-3" : "bg-accent"}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium leading-snug">{it.label}</span>
                    <span className="block text-[12.5px] leading-snug text-ink-3">{it.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
