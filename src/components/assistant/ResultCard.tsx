"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import type { ResultComponent, ResultValue } from "@/lib/assistant/envelope-types";

function StatusChip({ status }: { status?: ResultValue["status"] }) {
  if (!status || status === "known") return null;
  const cls = status === "unknown" ? "chip-unknown" : status === "attention" ? "chip-warn" : "chip-neutral";
  return <span className={`chip ${cls}`}>{status === "estimate" ? "estimate" : status}</span>;
}

/** One explainable result. Money values arrive pre-formatted from server tools. */
export function ResultCard({ component }: { component: ResultComponent }) {
  const [open, setOpen] = useState(false);
  const hasDetail = (component.rows?.length ?? 0) > 0 || (component.assumptions?.length ?? 0) > 0 || (component.missing?.length ?? 0) > 0;
  return (
    <section className="fade-in rounded-xl border border-line bg-surface" data-testid={`result-${component.kind}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] font-semibold">{component.title}</h3>
          {component.asOf && <p className="text-[11.5px] text-ink-3">As of {component.asOf}</p>}
        </div>
        {hasDetail && (
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setOpen(true)}>
            View calculation
          </button>
        )}
      </div>
      {component.values.length > 0 && (
        <dl className="mt-2 divide-y divide-line border-t border-line">
          {component.values.map((v) => (
            <div key={v.id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
              <dt className="text-[13px] text-ink-2">{v.label}</dt>
              <dd className="flex items-center gap-2 text-right">
                <span className={`num text-[14px] font-medium ${v.status === "unknown" ? "text-unknown" : ""}`}>{v.value}</span>
                <StatusChip status={v.status} />
              </dd>
              {v.note && <p className="col-span-2 text-[12px] text-ink-3">{v.note}</p>}
            </div>
          ))}
        </dl>
      )}
      {component.missing && component.missing.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-2">
          <span className="chip chip-unknown mr-1.5">Unknown</span>
          {component.missing.join(" · ")}
        </p>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title={component.title} eyebrow="Calculation">
        {component.rows && component.rows.length > 0 && (
          <div className="rounded-lg border border-line">
            {component.rows.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-3 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0">
                  <span className="block">{r.label}</span>
                  {r.note && <span className="block text-[11.5px] text-ink-3">{r.note}</span>}
                </span>
                <span className={`num shrink-0 text-right ${r.status === "unknown" ? "text-unknown" : ""}`}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
        {component.assumptions && component.assumptions.length > 0 && (
          <div className="mt-4">
            <p className="label">Assumptions and caveats</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
              {component.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {component.missing && component.missing.length > 0 && (
          <div className="mt-4">
            <p className="label">Still unknown</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-unknown">
              {component.missing.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-ink-3">Unknown inputs are never treated as zero.</p>
          </div>
        )}
      </Drawer>
    </section>
  );
}
