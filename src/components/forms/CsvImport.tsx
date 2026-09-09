"use client";

import { useActionState, useState, useTransition } from "react";
import { commitCsvImport, previewCsv, type CsvPreview } from "@/lib/actions/ledger";
import type { ActionResult } from "@/lib/actions/helpers";
import { TRANSACTION_KIND_LABELS, type TransactionKind } from "@/lib/finance/classify";
import { formatCents } from "@/lib/finance/money";

interface Row {
  include: boolean;
  date: string;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  counterAccountId: string;
  duplicate: boolean;
  error?: string;
}

export function CsvImport({ accounts, allAccounts }: { accounts: { id: string; name: string; spaceId: string; spaceName: string }[]; allAccounts: { id: string; name: string; spaceName: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [committing, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [state, action, pending] = useActionState<ActionResult<CsvPreview> | undefined, FormData>(async (prev, fd) => {
    const r = await previewCsv(prev, fd);
    if (r.ok && r.data) {
      setAccountId(r.data.accountId);
      setRows(
        r.data.rows.map((row) => ({
          include: !row.error && !row.duplicate,
          date: row.date,
          description: row.description,
          amountCents: row.amountCents,
          kind: row.amountCents >= 0 ? "income" : "expense",
          counterAccountId: "",
          duplicate: row.duplicate,
          error: row.error,
        })),
      );
      setResult(null);
    }
    return r;
  }, undefined);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.include && !r.error);

  if (accounts.length === 0) return <p className="text-sm text-ink-2">You need edit access to at least one space to import.</p>;

  return (
    <div className="space-y-5">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm">
          <span className="label">Into account</span>
          <select name="accountId" className="input mt-1" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {a.spaceName}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">CSV file</span>
          <input name="file" type="file" accept=".csv,text/csv" className="input mt-1" required />
        </label>
        <button className="btn btn-secondary" disabled={pending}>{pending ? "Reading…" : "Preview"}</button>
        <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-3">
          <input type="checkbox" name="invertSign" value="1" /> Positive amounts in this file mean money out
        </label>
        {state && !state.ok && <p className="text-sm text-bad sm:col-span-3">{state.error}</p>}
      </form>

      {state?.ok && state.data && rows.length > 0 && (
        <div>
          <p className="text-sm text-ink-2">
            Detected columns: date = <strong>{state.data.headers[state.data.mapping.date]}</strong>, description = <strong>{state.data.headers[state.data.mapping.description]}</strong>,{" "}
            {state.data.mapping.amount !== null ? <>amount = <strong>{state.data.headers[state.data.mapping.amount]}</strong></> : <>debit = <strong>{state.data.mapping.debit !== null ? state.data.headers[state.data.mapping.debit] : "—"}</strong>, credit = <strong>{state.data.mapping.credit !== null ? state.data.headers[state.data.mapping.credit] : "—"}</strong></>}
            . {rows.filter((r) => r.duplicate).length} duplicate(s) already in the ledger are unchecked.
          </p>
          <div className="table-wrap mt-3 max-h-[28rem] overflow-y-auto rounded-xl border border-line">
            <table className="data" data-testid="csv-preview">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="r">Amount</th>
                  <th>Kind</th>
                  <th>To account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.error ? "opacity-60" : ""}>
                    <td><input type="checkbox" checked={r.include} disabled={!!r.error} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Include row" /></td>
                    <td className="whitespace-nowrap">{r.date || <span className="text-bad">{r.error}</span>}</td>
                    <td>{r.description}{r.duplicate && <span className="chip chip-warn ml-2">duplicate</span>}</td>
                    <td className="r num whitespace-nowrap">{formatCents(r.amountCents, { cents: true })}</td>
                    <td>
                      <select className="input !min-h-[32px] !py-0.5 text-xs" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as TransactionKind })}>
                        {Object.entries(TRANSACTION_KIND_LABELS).map(([k, l]) => (
                          <option key={k} value={k}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {["transfer", "cc_payment", "savings_allocation"].includes(r.kind) && (
                        <select className="input !min-h-[32px] !py-0.5 text-xs" value={r.counterAccountId} onChange={(e) => update(i, { counterAccountId: e.target.value })}>
                          <option value="">Choose…</option>
                          {allAccounts.filter((a) => a.id !== accountId).map((a) => (
                            <option key={a.id} value={a.id}>{a.name} · {a.spaceName}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={committing || selected.length === 0}
              data-testid="csv-commit"
              onClick={() =>
                start(async () => {
                  const r = await commitCsvImport(
                    accountId,
                    JSON.stringify(selected.map((x) => ({ date: x.date, description: x.description, amountCents: x.amountCents, kind: x.kind, counterAccountId: x.counterAccountId || null }))),
                  );
                  if (r.ok && r.data) {
                    setResult(`Imported ${r.data.imported} transaction(s); skipped ${r.data.skipped} duplicate or zero rows.`);
                    setRows([]);
                  } else if (!r.ok) setResult(r.error);
                })
              }
            >
              {committing ? "Importing…" : `Import ${selected.length} row(s)`}
            </button>
            {result && <p className="text-sm" data-testid="csv-result">{result}</p>}
          </div>
        </div>
      )}
      {result && rows.length === 0 && <p className="text-sm text-good" data-testid="csv-result">{result}</p>}

    </div>
  );
}
