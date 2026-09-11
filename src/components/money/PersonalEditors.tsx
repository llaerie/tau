"use client";

import { useState } from "react";
import { formatCents } from "@/lib/finance/money";
import type { PersonalAllocation } from "@/lib/assumptions";
import { ActionFlowCard, useDraftAction } from "./ActionFlow";

function toCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!v.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function FoodTargetEditor({ personId, targetCents, editable }: { personId: string; targetCents: number | null; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(targetCents === null ? "" : (targetCents / 100).toFixed(0));
  const flow = useDraftAction("food-target");
  if (!editable) return null;
  return (
    <div id="food">
      {!editing && !flow.action && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} data-testid="edit-food-target">
          {targetCents === null ? "Set food target" : "Change target"}
        </button>
      )}
      {editing && !flow.action && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = toCents(value);
            if (cents === null) return;
            flow.draft("budget_change", { personId, field: "foodTarget", amountCents: cents });
            setEditing(false);
          }}
        >
          <label className="text-sm">
            <span className="label">Monthly food target</span>
            <input className="input mt-1 w-40" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 900" autoFocus data-testid="food-target-input" />
          </label>
          <button className="btn btn-primary btn-sm" disabled={flow.busy || toCents(value) === null} data-testid="food-target-preview">
            Preview change
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      {flow.error && <p className="mt-2 text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
    </div>
  );
}

export function AllocationsEditor({ personId, allocations, editable }: { personId: string; allocations: PersonalAllocation[]; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"savings" | "investment" | "spending">("savings");
  const [amount, setAmount] = useState("");
  const flow = useDraftAction("allocation");
  return (
    <div>
      {allocations.length === 0 ? (
        <p className="text-[13px] text-ink-3">No optional allocations. These are your choices (savings, investment, a spending pot), never imposed.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {allocations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
              <span>
                {a.name} <span className="chip chip-neutral ml-1">{a.kind}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num">{formatCents(a.monthlyCents)}/mo</span>
                {editable && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={flow.busy} onClick={() => flow.draft("budget_change", { personId, field: "allocation", amountCents: null, allocation: { id: a.id, name: a.name, kind: a.kind }, remove: true })} aria-label={`Remove ${a.name}`}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable && !adding && !flow.action && (
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setAdding(true)} data-testid="add-allocation">
          Add allocation
        </button>
      )}
      {adding && !flow.action && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = toCents(amount);
            if (cents === null || !name.trim()) return;
            flow.draft("budget_change", { personId, field: "allocation", amountCents: cents, allocation: { name: name.trim(), kind } });
            setAdding(false);
            setName("");
            setAmount("");
          }}
        >
          <label className="text-sm"><span className="label">Name</span><input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Savings" required /></label>
          <label className="text-sm"><span className="label">Kind</span>
            <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="savings">Savings</option>
              <option value="investment">Investment</option>
              <option value="spending">Spending pot</option>
            </select>
          </label>
          <label className="text-sm"><span className="label">Per month</span><input className="input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 600" /></label>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={flow.busy}>Preview</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      {flow.error && <p className="mt-2 text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
    </div>
  );
}
