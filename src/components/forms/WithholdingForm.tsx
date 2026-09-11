"use client";

import { useActionState } from "react";
import { updateOwnerAssumptions } from "@/lib/actions/assumptions";
import type { ActionResult } from "@/lib/actions/helpers";

export function WithholdingForm({ personId, ficaRatePct, incomeTaxCents, suggestedIncomeTaxCents }: { personId: string; ficaRatePct: number | null; incomeTaxCents: number | null; suggestedIncomeTaxCents: number | null }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateOwnerAssumptions, undefined);
  return (
    <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="personId" value={personId} />
      <label className="text-sm">
        <span className="label">FICA rate (% of gross)</span>
        <input name="ficaRatePct" className="input mt-1" inputMode="decimal" placeholder="7.65" defaultValue={ficaRatePct ?? ""} />
      </label>
      <label className="text-sm">
        <span className="label">Income tax withheld per month</span>
        <input name="incomeTax" className="input mt-1" inputMode="decimal" placeholder={suggestedIncomeTaxCents !== null ? `e.g. ${(suggestedIncomeTaxCents / 100).toFixed(0)}` : "e.g. 250"} defaultValue={incomeTaxCents === null ? "" : (incomeTaxCents / 100).toFixed(0)} />
      </label>
      <button className="btn btn-primary" disabled={pending} type="submit">{pending ? "Saving…" : "Save estimate"}</button>
      {state && !state.ok && <p className="text-sm text-bad sm:col-span-3">{state.error}</p>}
    </form>
  );
}
