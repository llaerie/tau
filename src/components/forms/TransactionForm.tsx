"use client";

import { useActionState, useState } from "react";
import { createTransaction } from "@/lib/actions/ledger";
import type { ActionResult } from "@/lib/actions/helpers";
import { TRANSACTION_KIND_LABELS, TRANSACTION_KIND_RULES, type TransactionKind } from "@/lib/finance/classify";

interface Props {
  spaces: { id: string; name: string }[];
  accounts: { id: string; name: string; spaceId: string; type: string }[];
  categories: { id: string; name: string; group: string }[];
  bills: { id: string; name: string; spaceId: string }[];
  goals: { id: string; name: string; spaceId: string }[];
  defaultSpaceId: string;
}

const TRANSFER_KINDS: TransactionKind[] = ["transfer", "cc_payment", "savings_allocation"];

export function TransactionForm(p: Props) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(createTransaction, undefined);
  const [spaceId, setSpaceId] = useState(p.defaultSpaceId);
  const [kind, setKind] = useState<TransactionKind>("expense");
  const spaceAccounts = p.accounts.filter((a) => a.spaceId === spaceId);
  const isTransfer = TRANSFER_KINDS.includes(kind);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="transaction-form">
      <label className="text-sm">
        <span className="label">Space</span>
        <select name="spaceId" className="input mt-1" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          {p.spaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">Kind</span>
        <select name="kind" className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
          {Object.entries(TRANSACTION_KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink-3">{TRANSACTION_KIND_RULES[kind]}</span>
      </label>
      <label className="text-sm">
        <span className="label">Date</span>
        <input name="date" type="date" className="input mt-1" defaultValue={today} required />
      </label>
      <label className="text-sm">
        <span className="label">{isTransfer ? "From account" : kind === "income" ? "Into account" : "Account"}</span>
        <select name="accountId" className="input mt-1" required defaultValue={spaceAccounts[0]?.id}>
          {spaceAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      {isTransfer && (
        <label className="text-sm">
          <span className="label">To account</span>
          <select name="counterAccountId" className="input mt-1" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {p.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {p.spaces.find((s) => s.id === a.spaceId)?.name ?? "other space"}</option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        <span className="label">Amount</span>
        <input name="amount" className="input mt-1" inputMode="decimal" placeholder="0.00" required />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="label">Description</span>
        <input name="description" className="input mt-1" required maxLength={200} />
      </label>
      {(kind === "expense" || kind === "income" || kind === "bill_payment") && (
        <label className="text-sm">
          <span className="label">Category</span>
          <select name="categoryId" className="input mt-1" defaultValue="">
            <option value="">None</option>
            {p.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      {kind === "bill_payment" && (
        <label className="text-sm">
          <span className="label">Bill paid</span>
          <select name="billId" className="input mt-1" defaultValue="">
            <option value="">Choose…</option>
            {p.bills.filter((b) => b.spaceId === spaceId).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
      )}
      {kind === "savings_allocation" && (
        <label className="text-sm">
          <span className="label">Goal</span>
          <select name="goalId" className="input mt-1" defaultValue="">
            <option value="">None</option>
            {p.goals.filter((g) => g.spaceId === spaceId).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
        <button className="btn btn-primary" disabled={pending} type="submit">{pending ? "Saving…" : "Add transaction"}</button>
        {state && !state.ok && <p className="text-sm text-bad">{state.error}</p>}
        {state?.ok && <p className="text-sm text-good">Added.</p>}
      </div>
    </form>
  );
}
