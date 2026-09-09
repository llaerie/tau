"use client";

import { useActionState } from "react";
import { updateOwnerAssumptions } from "@/lib/actions/assumptions";
import type { ActionResult } from "@/lib/actions/helpers";

export function WithholdingForm({ personId, current, suggested }: { personId: string; current: number | null; suggested: number | null }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateOwnerAssumptions, undefined);
  return (
    <form action={action} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="personId" value={personId} />
      <label className="flex-1 text-sm">
        <span className="label">Withholding estimate (% of gross)</span>
        <input name="withholdingRatePct" className="input mt-1" inputMode="decimal" placeholder={suggested !== null ? `e.g. ${suggested}` : "e.g. 22"} defaultValue={current ?? ""} />
      </label>
      <button className="btn btn-primary" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save estimate"}
      </button>
      {state && !state.ok && <p className="text-sm text-bad sm:ml-2">{state.error}</p>}
      {state?.ok && <p className="text-sm text-good sm:ml-2">Saved.</p>}
    </form>
  );
}
