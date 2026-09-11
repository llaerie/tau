"use client";

import { useRef } from "react";
import type { Provenance } from "@/lib/finance/types";

export function ProvenanceButton({ provenance, label }: { provenance: Provenance; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline hover:underline-offset-4"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><path d="M8 7.2v4M8 5.2v.2" strokeLinecap="round" /></svg>
        Where this comes from
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(92vw,34rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label">Provenance</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight">{label}</h3>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Close">
              Close
            </button>
          </div>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="label">Formula</dt>
              <dd className="mt-1 font-medium">{provenance.formula}</dd>
            </div>
            <div>
              <dt className="label">Inputs</dt>
              <dd className="mt-1">
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {provenance.inputs.map((i, idx) => (
                    <li key={idx} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                      <span>
                        <span className="font-medium">{i.label}</span>
                        <span className="block text-xs text-ink-3 sm:inline sm:pl-2">{i.source}</span>
                      </span>
                      <span className="num text-right text-ink-2">{i.value}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            {provenance.assumptions.length > 0 && (
              <div>
                <dt className="label">Assumptions</dt>
                <dd className="mt-1">
                  <ul className="list-disc space-y-1 pl-5 text-ink-2">
                    {provenance.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {provenance.caveats.length > 0 && (
              <div>
                <dt className="label">Caveats</dt>
                <dd className="mt-1">
                  <ul className="list-disc space-y-1 pl-5 text-warn">
                    {provenance.caveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </dialog>
    </>
  );
}
