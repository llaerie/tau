"use client";
import { useMemo, useState } from "react";
import type { AgentResponse } from "@/lib/core/contracts";
import { Drawer } from "@/components/ui/Drawer";
import { Badge, StatusPill, RiskChip } from "@/components/ui/Badge";
import { KeyValue } from "@/components/ui/KeyValue";
import { ExecutiveResponseView } from "@/components/cfo/ExecutiveResponseView";
import { fmtDate, fmtMoney, fmtPercent } from "@/lib/ui/format";

export interface TxRow {
  id: string;
  date: string;
  postedDate: string;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  sourceKind: "BANK" | "CARD";
  sourceAccountId: string;
  sourceAccountName: string;
  month: string;
  categoryAccountId: string | null;
  categoryLabel: string | null;
  categoryStatus: string;
  categoryConfidence: number;
  categoryReason: string | null;
  suggestedBy: string | null;
  flags: string[];
  documentIds: string[];
  journalEntryId: string | null;
  duplicateOfId: string | null;
  transferPairId: string | null;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

const FLAG_TONE: Record<string, "warn" | "bad" | "neutral" | "info"> = {
  POSSIBLE_DUPLICATE: "bad",
  POSSIBLE_PERSONAL: "bad",
  MISSING_RECEIPT: "warn",
  UNCATEGORIZED: "warn",
  REVIEW_REQUIRED: "warn",
  LARGE_UNUSUAL: "warn",
  NEW_MERCHANT: "info",
  TRANSFER: "neutral",
  REFUND: "neutral",
  RELATED_PARTY: "warn",
  INTERNATIONAL: "info",
  SPLIT: "neutral",
};

export function TransactionsExplorer({ rows, accounts, sources, initialTab, canPropose }: { rows: TxRow[]; accounts: AccountOption[]; sources: { id: string; name: string }[]; initialTab: "all" | "exceptions"; canPropose: boolean }) {
  const [tab, setTab] = useState<"all" | "exceptions">(initialTab);
  const [account, setAccount] = useState("");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [flag, setFlag] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TxRow | null>(null);
  const [limit, setLimit] = useState(150);

  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month))).sort().reverse(), [rows]);
  const flags = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.flags))).sort(), [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "exceptions" && !(r.categoryStatus === "UNCATEGORIZED" || r.categoryStatus === "SUGGESTED" || r.flags.some((f) => f !== "TRANSFER" && f !== "REFUND" && f !== "SPLIT"))) return false;
      if (account && r.sourceAccountId !== account) return false;
      if (month && r.month !== month) return false;
      if (status && r.categoryStatus !== status) return false;
      if (flag && !r.flags.includes(flag)) return false;
      if (s && !`${r.description} ${r.merchant ?? ""} ${r.categoryLabel ?? ""} ${r.id}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, tab, account, month, status, flag, search]);

  const exceptionsCount = useMemo(() => rows.filter((r) => r.categoryStatus === "UNCATEGORIZED" || r.categoryStatus === "SUGGESTED" || r.flags.some((f) => f !== "TRANSFER" && f !== "REFUND" && f !== "SPLIT")).length, [rows]);

  return (
    <div>
      <div className="mb-4 border-b border-line">
        <nav className="-mb-px flex gap-1">
          {(
            [
              ["all", "All transactions", rows.length],
              ["exceptions", "Exception queue", exceptionsCount],
            ] as const
          ).map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
              {label}
              <span className={`num rounded px-1.5 text-[11px] ${tab === k ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>{n}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description, merchant, id" className="input col-span-2 md:col-span-1" />
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="select">
          <option value="">All accounts</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="select">
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="select">
          <option value="">Any status</option>
          {["UNCATEGORIZED", "SUGGESTED", "APPROVED", "REJECTED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)} className="select">
          <option value="">Any flag</option>
          {flags.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 text-[12px] text-muted">
        {filtered.length} of {rows.length} transactions
      </div>
      <div className="scroll-x rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Account</th>
              <th className="r">Amount</th>
              <th>Category</th>
              <th>Flags</th>
              <th className="c">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer">
                <td className="whitespace-nowrap">{r.date}</td>
                <td>
                  <div className="max-w-[320px] truncate font-medium" title={r.description}>
                    {r.merchant ?? r.description}
                  </div>
                  {r.merchant ? (
                    <div className="max-w-[320px] truncate text-[11px] text-faint" title={r.description}>
                      {r.description}
                    </div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap text-muted">{r.sourceAccountName}</td>
                <td className={`r ${r.amount.startsWith("-") ? "" : "text-ok"}`}>{fmtMoney(r.amount, r.currency)}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusPill status={r.categoryStatus} />
                    {r.categoryLabel ? (
                      <span className="max-w-[200px] truncate" title={r.categoryLabel}>
                        {r.categoryLabel}
                      </span>
                    ) : null}
                    {r.categoryStatus !== "UNCATEGORIZED" ? <span className="num text-[11px] text-muted">{fmtPercent(r.categoryConfidence, 0)}</span> : null}
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <Badge key={f} tone={FLAG_TONE[f] ?? "neutral"}>
                        {f.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="c">{r.documentIds.length ? <span title={r.documentIds.join(", ")}>📎 {r.documentIds.length}</span> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted">
                  {rows.length === 0 ? "No transactions imported yet — import or enter data to begin." : "No transactions match these filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {filtered.length > limit ? (
        <button onClick={() => setLimit((l) => l + 150)} className="mt-2 text-[12px] text-accent hover:underline">
          Show more ({filtered.length - limit} remaining)
        </button>
      ) : null}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.date} · ${fmtMoney(selected.amount, selected.currency)}` : ""} width="max-w-2xl">
        {selected ? <TxDetail tx={selected} accounts={accounts} canPropose={canPropose} onUpdated={() => setSelected(null)} /> : null}
      </Drawer>
    </div>
  );
}

function TxDetail({ tx, accounts, canPropose, onUpdated }: { tx: TxRow; accounts: AccountOption[]; canPropose: boolean; onUpdated: () => void }) {
  const [accountId, setAccountId] = useState(tx.categoryAccountId ?? "");
  const [busy, setBusy] = useState<"classify" | "approve" | null>(null);
  const [classification, setClassification] = useState<AgentResponse | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function classify() {
    setBusy("classify");
    setMsg(null);
    try {
      const res = await fetch("/api/cfo/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: `Classify transaction ${tx.id}: ${tx.description}`, task: { kind: "accounting.classify_transaction", params: { transactionId: tx.id } }, targetAgent: "bookkeeping" }) });
      const body = (await res.json()) as { response?: AgentResponse; error?: { message: string } };
      if (!res.ok || !body.response) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setClassification(body.response);
      const cat = body.response.structured?.category as { accountCode?: string | null } | undefined;
      if (cat?.accountCode) {
        const acc = accounts.find((a) => a.code === cat.accountCode);
        if (acc) setAccountId(acc.id);
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setMsg(null);
    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(tx.id)}/category`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: accountId || undefined }) });
      const body = (await res.json()) as { action?: { status: string; risk: { level: string; reasons: string[] }; approvalId?: string; blockedReason?: string }; error?: { message: string } };
      if (!res.ok || !body.action) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      const a = body.action;
      setMsg({ ok: a.status === "EXECUTED" || a.status === "AWAITING_APPROVAL", text: `${a.risk.level}: ${a.status}${a.approvalId ? ` — approval ${a.approvalId} created` : ""}${a.blockedReason ? ` — ${a.blockedReason}` : ""}. ${a.risk.reasons.join(" ")}` });
      if (a.status === "EXECUTED") setTimeout(onUpdated, 1200);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <KeyValue
        dense
        items={[
          { k: "Id", v: tx.id, mono: true },
          { k: "Description", v: tx.description },
          { k: "Merchant", v: tx.merchant ?? "—" },
          { k: "Source", v: `${tx.sourceKind} · ${tx.sourceAccountName}` },
          { k: "Dates", v: `${fmtDate(tx.date)} (posted ${fmtDate(tx.postedDate)})` },
          { k: "Amount", v: <span className="num font-medium">{fmtMoney(tx.amount, tx.currency)}</span> },
          { k: "Category", v: <span className="flex flex-wrap items-center gap-1"><StatusPill status={tx.categoryStatus} />{tx.categoryLabel ?? "—"}{tx.categoryStatus !== "UNCATEGORIZED" ? <span className="num text-muted">{fmtPercent(tx.categoryConfidence, 0)} · by {tx.suggestedBy ?? "—"}</span> : null}</span> },
          { k: "Reason", v: tx.categoryReason ?? "—" },
          { k: "Flags", v: tx.flags.length ? <span className="flex flex-wrap gap-1">{tx.flags.map((f) => <Badge key={f} tone={FLAG_TONE[f] ?? "neutral"}>{f.replace(/_/g, " ")}</Badge>)}</span> : "none" },
          { k: "Documents", v: tx.documentIds.length ? tx.documentIds.join(", ") : "no linked receipt", mono: true },
          { k: "Journal entry", v: tx.journalEntryId ?? "not posted", mono: true },
          ...(tx.duplicateOfId ? [{ k: "Duplicate of", v: tx.duplicateOfId, mono: true }] : []),
          ...(tx.transferPairId ? [{ k: "Transfer pair", v: tx.transferPairId, mono: true }] : []),
        ]}
      />

      <div className="rounded-md border border-line bg-surface-2 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Categorization</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="select" disabled={!canPropose}>
            <option value="">Choose account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
          <button onClick={() => void classify()} disabled={busy !== null || !canPropose} className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50">
            {busy === "classify" ? "Asking…" : "Ask bookkeeping to classify"}
          </button>
          <button onClick={() => void approve()} disabled={busy !== null || !accountId || !canPropose} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
            {busy === "approve" ? "Submitting…" : "Approve suggestion"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Approving creates a governed CATEGORIZE_TRANSACTION action. GREEN executes; YELLOW (new category, personal-mixed, restricted account, above the review threshold) routes to Approvals.</p>
        {!canPropose ? <p className="mt-1 text-[11px] text-bad">Your role cannot propose actions.</p> : null}
        {msg ? (
          <div className={`mt-2 flex items-start gap-2 text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>
            <RiskChip level={msg.text.split(":")[0]} />
            <span>{msg.text}</span>
          </div>
        ) : null}
      </div>

      {classification ? <ExecutiveResponseView res={classification} compact /> : null}
    </div>
  );
}
