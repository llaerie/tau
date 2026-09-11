"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/helpers";
import { archiveAccount, deleteBill, deleteBudget, deleteGoal, saveAccount, saveBill, saveBudget, saveGoal } from "@/lib/actions/records";

function dollars(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function Status({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="text-sm text-good">Saved.</p> : <p className="text-sm text-bad">{state.error}</p>;
}

/** Wraps a form in a dialog when compact (row edit), otherwise renders inline. */
function Editor({ compact, label, children }: { compact?: boolean; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  if (!compact) return <>{children}</>;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.showModal()}>Edit</button>
      <dialog ref={ref} className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl" onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <div className="mb-3 flex items-center justify-between"><h3 className="font-medium">{label}</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()}>Close</button></div>
        {children}
      </dialog>
    </>
  );
}

export function AccountForm({ spaceId, account, today, compact }: { spaceId: string; today: string; compact?: boolean; account?: { id: string; name: string; type: string; institution: string | null; openingBalanceCents: number | null; openingBalanceAsOf: string | null; isArchived: boolean } }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(saveAccount, undefined);
  const [busy, start] = useTransition();
  return (
    <Editor compact={compact} label={account ? `Edit ${account.name}` : "Add account"}>
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="spaceId" value={spaceId} />
        {account && <input type="hidden" name="id" value={account.id} />}
        <label className="text-sm"><span className="label">Name</span><input name="name" className="input mt-1" required defaultValue={account?.name} /></label>
        <label className="text-sm"><span className="label">Type</span>
          <select name="type" className="input mt-1" defaultValue={account?.type ?? "checking"}>
            {["checking", "savings", "credit_card", "cash", "other"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="label">Institution</span><input name="institution" className="input mt-1" defaultValue={account?.institution ?? ""} /></label>
        <label className="text-sm"><span className="label">Opening balance (blank = unknown)</span><input name="openingBalance" className="input mt-1" inputMode="decimal" defaultValue={dollars(account?.openingBalanceCents)} placeholder="Unknown" /></label>
        <label className="text-sm"><span className="label">Balance as of</span><input name="openingBalanceAsOf" type="date" className="input mt-1" defaultValue={account?.openingBalanceAsOf ?? today} /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : account ? "Save" : "Add account"}</button>
          {account && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => start(async () => { await archiveAccount(account.id); })}>{account.isArchived ? "Unarchive" : "Archive"}</button>}
          <Status state={state} />
        </div>
      </form>
    </Editor>
  );
}

export function BillForm({ spaceId, bill, categories, compact }: { spaceId: string; compact?: boolean; categories: { id: string; name: string }[]; bill?: { id: string; name: string; amountCents: number | null; cadence: string; dueDay: number | null; categoryId: string | null } }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(saveBill, undefined);
  const [busy, start] = useTransition();
  return (
    <Editor compact={compact} label={bill ? `Edit ${bill.name}` : "Add bill"}>
      <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="spaceId" value={spaceId} />
        {bill && <input type="hidden" name="id" value={bill.id} />}
        <label className="text-sm"><span className="label">Name</span><input name="name" className="input mt-1" required defaultValue={bill?.name} /></label>
        <label className="text-sm"><span className="label">Amount (blank = unknown)</span><input name="amount" className="input mt-1" inputMode="decimal" defaultValue={dollars(bill?.amountCents)} placeholder="Unknown" /></label>
        <label className="text-sm"><span className="label">Cadence</span>
          <select name="cadence" className="input mt-1" defaultValue={bill?.cadence ?? "monthly"}>
            {["weekly", "monthly", "quarterly", "annual"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="label">Due day</span><input name="dueDay" className="input mt-1" inputMode="numeric" defaultValue={bill?.dueDay ?? ""} /></label>
        <label className="text-sm sm:col-span-2"><span className="label">Category</span>
          <select name="categoryId" className="input mt-1" defaultValue={bill?.categoryId ?? ""}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : bill ? "Save" : "Add bill"}</button>
          {bill && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm("Remove this bill?") && start(async () => { await deleteBill(bill.id); })}>Remove</button>}
          <Status state={state} />
        </div>
      </form>
    </Editor>
  );
}

export function GoalForm({ spaceId, goal, compact }: { spaceId: string; compact?: boolean; goal?: { id: string; name: string; monthlyTargetCents: number | null; priority: number; targetTotalCents: number | null; savedCents: number; rule: string | null } }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(saveGoal, undefined);
  const [busy, start] = useTransition();
  const [name, setName] = useState(goal?.name ?? "");
  return (
    <Editor compact={compact} label={goal ? `Edit ${goal.name}` : "Add goal"}>
      <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="spaceId" value={spaceId} />
        {goal && <input type="hidden" name="id" value={goal.id} />}
        <label className="text-sm"><span className="label">Name</span><input name="name" className="input mt-1" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-sm"><span className="label">Priority (1 = first)</span><input name="priority" className="input mt-1" inputMode="numeric" defaultValue={goal?.priority ?? 1} /></label>
        <label className="text-sm"><span className="label">Monthly contribution</span><input name="monthlyTarget" className="input mt-1" inputMode="decimal" defaultValue={dollars(goal?.monthlyTargetCents)} placeholder="Unknown" /></label>
        <label className="text-sm"><span className="label">Target total (optional)</span><input name="targetTotal" className="input mt-1" inputMode="decimal" defaultValue={dollars(goal?.targetTotalCents)} /></label>
        <label className="text-sm"><span className="label">Saved so far</span><input name="saved" className="input mt-1" inputMode="decimal" defaultValue={dollars(goal?.savedCents ?? 0)} /></label>
        <label className="text-sm"><span className="label">Rule (optional)</span><input name="rule" className="input mt-1" defaultValue={goal?.rule ?? ""} placeholder="e.g. before discretionary spending" /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : goal ? "Save" : "Add goal"}</button>
          {goal && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm("Delete this goal?") && start(async () => { await deleteGoal(goal.id); })}>Delete</button>}
          <Status state={state} />
        </div>
      </form>
    </Editor>
  );
}

export function BudgetForm({ spaceId, budget, categories, compact }: { spaceId: string; compact?: boolean; categories: { id: string; name: string }[]; budget?: { id: string; name: string; monthlyCents: number | null; categoryId: string | null; sortOrder: number } }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(saveBudget, undefined);
  const [busy, start] = useTransition();
  return (
    <Editor compact={compact} label={budget ? `Edit ${budget.name}` : "Add budget"}>
      <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="spaceId" value={spaceId} />
        {budget && <input type="hidden" name="id" value={budget.id} />}
        <label className="text-sm"><span className="label">Name</span><input name="name" className="input mt-1" required defaultValue={budget?.name} placeholder="e.g. Shopping" /></label>
        <label className="text-sm"><span className="label">Planned per month (blank = unknown)</span><input name="monthly" className="input mt-1" inputMode="decimal" defaultValue={dollars(budget?.monthlyCents)} placeholder="Unknown" /></label>
        <label className="text-sm"><span className="label">Tracks category</span>
          <select name="categoryId" className="input mt-1" defaultValue={budget?.categoryId ?? ""}>
            <option value="">Create one named after the budget</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="label">Order</span><input name="sortOrder" className="input mt-1" inputMode="numeric" defaultValue={budget?.sortOrder ?? 0} /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : budget ? "Save" : "Add budget"}</button>
          {budget && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm("Remove this budget?") && start(async () => { await deleteBudget(budget.id); })}>Remove</button>}
          <Status state={state} />
        </div>
      </form>
    </Editor>
  );
}
