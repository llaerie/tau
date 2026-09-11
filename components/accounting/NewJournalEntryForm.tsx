"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface JournalAccountOption {
  code: string;
  name: string;
  type: string;
  restricted?: boolean;
}

interface LineDraft {
  accountCode: string;
  debit: string;
  credit: string;
  memo: string;
}

const emptyLine = (): LineDraft => ({ accountCode: "", debit: "", credit: "", memo: "" });

function toCents(v: string): number {
  const n = Number(v.trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** "New entry" form: date, description, lines (account code / debit / credit) → POST /api/accounting/journal (DRAFT). */
export function NewJournalEntryForm({ accounts, canEnter, defaultDate }: { accounts: JournalAccountOption[]; canEnter: boolean; defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Display-only balance check (cents as integers); the ledger re-validates with decimal arithmetic.
  const totals = useMemo(() => {
    const debits = lines.reduce((a, l) => a + toCents(l.debit), 0);
    const credits = lines.reduce((a, l) => a + toCents(l.credit), 0);
    return { debits, credits, balanced: debits === credits && debits > 0 };
  }, [lines]);

  const update = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const payload = { date, description, memo: memo || undefined, lines: lines.filter((l) => l.accountCode).map((l) => ({ accountCode: l.accountCode, debit: l.debit || undefined, credit: l.credit || undefined, memo: l.memo || undefined })) };
      const res = await fetch("/api/accounting/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json()) as { message?: string; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: body.message ?? "Draft entry created." });
      setDescription("");
      setMemo("");
      setLines([emptyLine(), emptyLine()]);
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium hover:bg-surface-2">New entry (manual journal entry → DRAFT)</summary>
      <div className="border-t border-line px-4 py-3">
        <form onSubmit={submit} className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" disabled={!canEnter} required />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (e.g. Opening balance — Operating Checking as of 2026-01-01)" className="input" disabled={!canEnter} required />
          </div>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo / source (optional: statement, CPA instruction, document id)" className="input" disabled={!canEnter} />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="r">Debit</th>
                  <th className="r">Credit</th>
                  <th>Line memo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.accountCode} onChange={(e) => update(i, { accountCode: e.target.value })} className="select min-w-[220px]" disabled={!canEnter}>
                        <option value="">Choose account…</option>
                        {accounts.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} · {a.name}
                            {a.restricted ? " (restricted)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="r">
                      <input value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} inputMode="decimal" placeholder="0.00" className="input w-32 text-right" disabled={!canEnter} />
                    </td>
                    <td className="r">
                      <input value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} inputMode="decimal" placeholder="0.00" className="input w-32 text-right" disabled={!canEnter} />
                    </td>
                    <td>
                      <input value={l.memo} onChange={(e) => update(i, { memo: e.target.value })} placeholder="optional" className="input" disabled={!canEnter} />
                    </td>
                    <td>
                      <button type="button" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, j) => j !== i) : ls))} disabled={!canEnter || lines.length <= 2} className="text-[12px] text-muted hover:text-bad disabled:opacity-40" aria-label="Remove line">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>
                    <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} disabled={!canEnter} className="text-[12px] text-accent hover:underline disabled:opacity-40">
                      + Add line
                    </button>
                  </td>
                  <td className="r num">{fmt(totals.debits)}</td>
                  <td className="r num">{fmt(totals.credits)}</td>
                  <td colSpan={2} className={totals.balanced ? "text-ok" : "text-warn"}>
                    {totals.balanced ? "Balanced" : totals.debits === totals.credits ? "Enter amounts" : `Out of balance by ${fmt(Math.abs(totals.debits - totals.credits))}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className={`text-[12px] ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-faint"}`}>{msg ? msg.text : canEnter ? "Creates a DRAFT through the ledger (must balance; locked periods refuse). Posting is a separate governed action with approval where required." : "Only OWNER or FINANCE_OPERATOR can draft entries."}</div>
            <button type="submit" disabled={busy || !canEnter || !totals.balanced} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
              {busy ? "Saving…" : "Create draft entry"}
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
