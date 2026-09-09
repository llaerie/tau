"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/helpers";
import { deleteScenario, saveScenario } from "@/lib/actions/records";

export function ScenarioForm({ spaces }: { spaces: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(saveScenario, undefined);
  const [kind, setKind] = useState("one_time");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="scenario-form">
      <label className="text-sm lg:col-span-2"><span className="label">What</span><input name="name" className="input mt-1" required placeholder="e.g. New laptop" /></label>
      <label className="text-sm"><span className="label">Space</span>
        <select name="spaceId" className="input mt-1">{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label className="text-sm"><span className="label">Amount</span><input name="amount" className="input mt-1" inputMode="decimal" required placeholder="0.00" /></label>
      <label className="text-sm"><span className="label">Kind</span>
        <select name="kind" className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="one_time">One time</option>
          <option value="recurring">Recurring, monthly</option>
        </select>
      </label>
      {kind === "recurring" && <label className="text-sm"><span className="label">For how many months (blank = ongoing)</span><input name="recurringMonths" className="input mt-1" inputMode="numeric" /></label>}
      <label className="text-sm"><span className="label">Starts in (months from now)</span><input name="startMonthOffset" className="input mt-1" inputMode="numeric" defaultValue={0} /></label>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-5">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Evaluating…" : "Evaluate"}</button>
        {state && !state.ok && <p className="text-sm text-bad">{state.error}</p>}
      </div>
    </form>
  );
}

export function DeleteScenarioButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { await deleteScenario(id); })} aria-label="Remove scenario">
      Remove
    </button>
  );
}
