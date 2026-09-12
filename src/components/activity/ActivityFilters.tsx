"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export interface ActivityFilterState {
  q: string;
  space: string;
  month: string;
  reviewOnly: boolean;
}

export interface SpaceOption {
  value: string;
  label: string;
}

function toQuery(next: ActivityFilterState): string {
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.space && next.space !== "all") p.set("space", next.space);
  if (next.month) p.set("month", next.month);
  if (next.reviewOnly) p.set("review", "1");
  const s = p.toString();
  return s ? `/activity?${s}` : "/activity";
}

/**
 * Narrowing the ledger should cost one interaction, not three. Every control
 * applies as soon as it changes; the search box waits only long enough to stop
 * navigating on every keystroke.
 */
export function ActivityFilters({
  initial,
  spaceOptions,
  months,
  monthLabels,
  reviewCount,
  shownCount,
  totalCount,
}: {
  initial: ActivityFilterState;
  spaceOptions: SpaceOption[];
  months: string[];
  monthLabels: Record<string, string>;
  reviewCount: number;
  shownCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActivityFilterState>(initial);
  const typed = useRef(false);

  // Keep the box in step when the URL changes from elsewhere (a cleared chip,
  // the back button) without stamping over what is being typed right now.
  useEffect(() => {
    if (!typed.current) setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.q, initial.space, initial.month, initial.reviewOnly]);

  const apply = (next: ActivityFilterState) => {
    setState(next);
    startTransition(() => router.replace(toQuery(next), { scroll: false }));
  };

  // Debounced search: the ledger re-filters on the server, so typing should not
  // fire a navigation per character.
  useEffect(() => {
    if (state.q === initial.q) return;
    const id = setTimeout(() => {
      typed.current = false;
      startTransition(() => router.replace(toQuery(state), { scroll: false }));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.q]);

  const active = Boolean(state.q) || state.space !== "all" || Boolean(state.month) || state.reviewOnly;

  return (
    <div className="card mb-4 p-3" data-testid="activity-filters">
      <div className="flex flex-col gap-3 min-[900px]:flex-row min-[900px]:items-center">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search activity</span>
          <input
            className="input"
            value={state.q}
            onChange={(e) => {
              typed.current = true;
              setState((p) => ({ ...p, q: e.target.value }));
            }}
            placeholder="Search description, category or account"
            type="search"
            data-testid="activity-search"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-[var(--fd-radius-pill)] bg-surface-2 p-1" role="radiogroup" aria-label="Space">
            {spaceOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={state.space === o.value}
                className={`min-h-[34px] whitespace-nowrap rounded-[var(--fd-radius-pill)] px-3 text-[13px] font-medium transition-colors ${state.space === o.value ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:text-ink"}`}
                onClick={() => apply({ ...state, space: o.value })}
                data-testid={`filter-space-${o.value}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="shrink-0">
            <span className="sr-only">Month</span>
            <select
              className="input min-h-[40px] w-auto py-1.5"
              value={state.month}
              onChange={(e) => apply({ ...state, month: e.target.value })}
              data-testid="filter-month"
            >
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>{monthLabels[m] ?? m}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={state.reviewOnly}
            className={`chip min-h-[34px] shrink-0 whitespace-nowrap ${state.reviewOnly ? "chip-warn" : "chip-neutral"}`}
            onClick={() => apply({ ...state, reviewOnly: !state.reviewOnly })}
            data-testid="filter-review"
          >
            {state.reviewOnly ? "Needs review only ×" : `Needs review${reviewCount ? ` · ${reviewCount}` : ""}`}
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3" aria-live="polite">
        <span data-testid="activity-count">
          {pending ? "Filtering…" : `${shownCount} of ${totalCount} entr${totalCount === 1 ? "y" : "ies"}`}
        </span>
        {active && (
          <button type="button" className="link text-[12.5px]" onClick={() => apply({ q: "", space: "all", month: "", reviewOnly: false })} data-testid="filter-clear">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
