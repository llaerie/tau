"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import type { Provenance } from "@/lib/finance/types";

/** Evidence drawer: formula, inputs and their sources, as-of, assumptions, caveats. */
export function EvidenceDrawer({ open, onClose, label, provenance, value, status, asOf }: { open: boolean; onClose: () => void; label: string; provenance: Provenance; value: string; status?: string; asOf?: string }) {
  return (
    <Drawer open={open} onClose={onClose} title={label} eyebrow="Where this comes from" testId="evidence-drawer">
      <p className="fd-money text-[34px] font-semibold leading-none">{value}</p>
      <p className="mt-2 text-[13px] text-ink-3">
        {status ? `${status}. ` : ""}
        {asOf ? `As of ${asOf}.` : ""}
      </p>

      <p className="label mt-6 text-[12px]">Formula</p>
      <p className="mt-1.5 rounded-[var(--fd-radius-field)] bg-surface-2 px-3.5 py-2.5 text-[14px] font-medium">{provenance.formula}</p>

      <p className="label mt-6 text-[12px]">Inputs</p>
      <ul className="mt-1.5 space-y-px overflow-hidden rounded-[var(--fd-radius-field)]">
        {provenance.inputs.map((i, idx) => (
          <li key={idx} className="flex flex-col gap-0.5 bg-surface-2 px-3.5 py-2.5 text-[13.5px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span>
              <span className="font-medium">{i.label}</span>
              <span className="block text-[12px] text-ink-3">{i.source}</span>
            </span>
            <span className="fd-money shrink-0 text-ink-2">{i.value}</span>
          </li>
        ))}
      </ul>

      {provenance.assumptions.length > 0 && (
        <>
          <p className="label mt-6 text-[12px]">Assumptions</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
            {provenance.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      {provenance.caveats.length > 0 && (
        <>
          <p className="label mt-6 text-[12px]">Caveats</p>
          <ul className="mt-1.5 space-y-1.5">
            {provenance.caveats.map((c, i) => (
              <li key={i} className="rounded-[var(--fd-radius-field)] bg-warn-soft px-3.5 py-2 text-[13px] text-warn">
                {c}
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
}

export function CalcButton({ label, provenance, value, status, asOf, variant = "link" }: { label: string; provenance: Provenance; value: string; status?: string; asOf?: string; variant?: "link" | "button" }) {
  const [open, setOpen] = useState(false);
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <>
      <button
        type="button"
        className={variant === "button" ? "btn btn-secondary btn-sm" : "inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-accent hover:underline hover:underline-offset-4"}
        onClick={() => setOpen(true)}
        data-testid={`calc-${id}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5.5M12 7.8v.2" />
        </svg>
        Where this comes from
      </button>
      <EvidenceDrawer open={open} onClose={() => setOpen(false)} label={label} provenance={provenance} value={value} status={status} asOf={asOf} />
    </>
  );
}
