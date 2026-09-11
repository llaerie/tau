"use client";

import { useState } from "react";
import { ActionFlowCard, useDraftAction } from "@/components/money/ActionFlow";

export interface ExpenseAccount {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
  spaceKind: "company" | "household" | "personal";
}

function toCents(v: string): number | null {
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (!v.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function RecordExpense({ accounts, categories, persons, meId, today, documentId, initial }: { accounts: ExpenseAccount[]; categories: { id: string; name: string }[]; persons: { id: string; name: string }[]; meId: string | null; today: string; documentId?: string; initial?: { amount?: string; description?: string; date?: string } }) {
  const [open, setOpen] = useState(!!initial);
  const personal = accounts.find((a) => a.spaceKind === "personal");
  const [accountId, setAccountId] = useState(personal?.id ?? accounts[0]?.id ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [categoryId, setCategoryId] = useState(categories.find((c) => c.name === "Food & dining")?.id ?? "");
  const [purpose, setPurpose] = useState<"business" | "personal" | "mixed" | "unresolved">("personal");
  const [split, setSplit] = useState(false);
  const flow = useDraftAction(documentId ? `receipt-${documentId}` : "expense");
  const account = accounts.find((a) => a.id === accountId);
  const partner = persons.find((p) => p.id !== meId);
  const cents = toCents(amount);
  const shares = split && partner && meId && cents !== null ? [{ personId: meId, cents: Math.ceil(cents / 2) }, { personId: partner.id, cents: Math.floor(cents / 2) }] : undefined;
  return (
    <div data-testid="record-expense">
      {!open && !flow.action && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)} data-testid="record-expense-open">
          Record expense
        </button>
      )}
      {open && !flow.action && (
        <form
          className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents === null || !account || !description.trim()) return;
            flow.draft("expense", {
              spaceId: account.spaceId,
              accountId: account.id,
              date,
              amountCents: cents,
              description: description.trim(),
              categoryId: categoryId || null,
              purpose: account.spaceKind === "company" ? purpose : "personal",
              beneficiary: shares ? "split" : account.spaceKind === "household" ? "household" : account.spaceKind === "company" ? (purpose === "business" ? "company" : "person") : "person",
              treatment: account.spaceKind === "company" && purpose !== "business" ? "review_required" : "none",
              payerPersonId: meId,
              shares,
              documentId: documentId ?? null,
            });
            setOpen(false);
          }}
        >
          <label className="text-sm"><span className="label">Amount</span><input className="input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required data-testid="expense-amount" /></label>
          <label className="text-sm"><span className="label">Date</span><input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="expense-date" /></label>
          <label className="text-sm sm:col-span-2"><span className="label">Description</span><input className="input mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Dinner at Nopa" required maxLength={200} data-testid="expense-description" /></label>
          <label className="text-sm"><span className="label">Paid from</span>
            <select className="input mt-1" value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="expense-account">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.spaceName} · {a.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Category</span>
            <select className="input mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {account?.spaceKind === "company" && (
            <label className="text-sm"><span className="label">Purpose</span>
              <select className="input mt-1" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
                <option value="business">Business</option><option value="personal">Personal (paid by the company)</option><option value="mixed">Mixed</option><option value="unresolved">Not decided</option>
              </select>
            </label>
          )}
          {partner && account?.spaceKind !== "company" && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} data-testid="expense-split" />
              Split equally with {partner.name} (each of you sees only your own share in your food plan)
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button className="btn btn-primary btn-sm" disabled={flow.busy || cents === null || !description.trim()} data-testid="expense-preview">Preview</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <span className="text-[12px] text-ink-3">Nothing is saved until you approve the preview.</span>
          </div>
        </form>
      )}
      {flow.error && <p className="mt-2 text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
    </div>
  );
}
