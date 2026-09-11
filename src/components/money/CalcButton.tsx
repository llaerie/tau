"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import type { Provenance } from "@/lib/finance/types";

export function CalcButton({ label, provenance, value, status }: { label: string; provenance: Provenance; value: string; status?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-[12px] font-medium text-accent hover:underline hover:underline-offset-4" onClick={() => setOpen(true)} data-testid={`calc-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
        View calculation
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={label} eyebrow="Calculation">
        <p className="num text-[22px] font-semibold">{value}</p>
        {status && <p className="text-[12.5px] text-ink-3">{status}</p>}
        <p className="mt-3 label">Formula</p>
        <p className="mt-1 text-[13.5px] font-medium">{provenance.formula}</p>
        <p className="mt-4 label">Inputs</p>
        <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
          {provenance.inputs.map((i, idx) => (
            <li key={idx} className="flex flex-col gap-0.5 px-3 py-2 text-[13px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <span>
                <span className="font-medium">{i.label}</span>
                <span className="block text-[11.5px] text-ink-3">{i.source}</span>
              </span>
              <span className="num text-ink-2">{i.value}</span>
            </li>
          ))}
        </ul>
        {provenance.assumptions.length > 0 && (
          <>
            <p className="mt-4 label">Assumptions</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
              {provenance.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </>
        )}
        {provenance.caveats.length > 0 && (
          <>
            <p className="mt-4 label">Caveats</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-warn">
              {provenance.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </Drawer>
    </>
  );
}
