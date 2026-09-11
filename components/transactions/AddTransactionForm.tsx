"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface TxSourceOption {
  id: string;
  name: string;
  kind: "BANK" | "CARD";
}

/** Manual "Add transaction" form: bank/card, date, signed amount, description → POST /api/transactions. */
export function AddTransactionForm({ sources, canEnter, defaultDate }: { sources: TxSourceOption[]; canEnter: boolean; defaultDate: string }) {
  const router = useRouter();
  const [sourceAccountId, setSource] = useState(sources[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"OUT" | "IN">("OUT");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const abs = amount.trim().replace(/^[-+]/, "");
      const signed = direction === "OUT" ? `-${abs}` : abs;
      const res = await fetch("/api/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceAccountId, date, amount: signed, description }) });
      const body = (await res.json()) as { message?: string; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: body.message ?? "Transaction entered." });
      setAmount("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group mb-4 rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium hover:bg-surface-2">Add transaction (manual entry)</summary>
      <div className="border-t border-line px-4 py-3">
        {sources.length === 0 ? (
          <p className="text-[13px] text-muted">
            No bank accounts or cards are registered yet. <Link href="/company?tab=accounts" className="text-accent underline">Add them on Company setup</Link> first — a transaction must belong to an account.
          </p>
        ) : (
          <form onSubmit={submit} className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_1fr]">
              <select value={sourceAccountId} onChange={(e) => setSource(e.target.value)} className="select" disabled={!canEnter}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.kind === "BANK" ? "Bank" : "Card"} · {s.name}
                  </option>
                ))}
              </select>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" disabled={!canEnter} required />
              <select value={direction} onChange={(e) => setDirection(e.target.value as "OUT" | "IN")} className="select" disabled={!canEnter}>
                <option value="OUT">Money out / charge</option>
                <option value="IN">Money in / refund</option>
              </select>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (e.g. 125.00)" inputMode="decimal" pattern="^[0-9]+(\.[0-9]{1,4})?$" className="input" disabled={!canEnter} required />
            </div>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description as it appears on the statement" className="input" disabled={!canEnter} required />
            <div className="flex items-center justify-between gap-2">
              <div className={`text-[12px] ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-faint"}`}>{msg ? msg.text : canEnter ? "Lands UNCATEGORIZED in the exception queue; categorising it is a governed action. Every entry is audited." : "Only OWNER or FINANCE_OPERATOR can enter transactions."}</div>
              <button type="submit" disabled={busy || !canEnter} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
                {busy ? "Saving…" : "Add transaction"}
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
