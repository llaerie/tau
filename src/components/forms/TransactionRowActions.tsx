"use client";

import { useState, useTransition } from "react";
import { deleteTransaction, updateTransactionKind } from "@/lib/actions/ledger";
import { TRANSACTION_KIND_LABELS } from "@/lib/finance/classify";

export function TransactionRowActions({ id, kind, hasCounter }: { id: string; kind: string; hasCounter: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center justify-end gap-1">
      <select
        className="input !min-h-[32px] !w-auto !py-0.5 text-xs"
        defaultValue={kind}
        disabled={pending}
        aria-label="Reclassify"
        onChange={(e) =>
          start(async () => {
            const r = await updateTransactionKind(id, e.target.value);
            setError(r.ok ? null : r.error);
          })
        }
      >
        {Object.entries(TRANSACTION_KIND_LABELS)
          .filter(([k]) => hasCounter || !["transfer", "cc_payment", "savings_allocation"].includes(k) || k === kind)
          .map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
      </select>
      <button
        type="button"
        className="btn btn-ghost btn-sm text-bad"
        disabled={pending}
        aria-label="Delete transaction"
        onClick={() => {
          if (!confirm("Delete this transaction?")) return;
          start(async () => {
            const r = await deleteTransaction(id);
            setError(r.ok ? null : r.error);
          });
        }}
      >
        ✕
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
