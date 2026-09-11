"use client";

import { useState } from "react";
import { Drawer } from "@/components/Drawer";
import { Cents } from "@/components/Money";
import { ActionFlowCard, useDraftAction } from "@/components/money/ActionFlow";
import { dateLabel } from "@/components/ui";

export interface ActivityRow {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  /** Sign for display: expenses negative, income positive, transfers neutral. */
  signedCents: number;
  kind: string;
  kindLabel: string;
  spaceId: string;
  spaceName: string;
  spaceKind: "company" | "household" | "personal";
  accountName: string;
  counterAccountName: string | null;
  categoryName: string | null;
  beneficiary: string | null;
  purpose: string | null;
  treatmentLabel: string | null;
  reviewStatus: string;
  source: string;
  voidedAt: string | null;
  voidReason: string | null;
  documentId: string | null;
  shares: { personId: string; name: string; cents: number }[];
  canEdit: boolean;
}

export function ActivityList({ rows, persons, meId }: { rows: ActivityRow[]; persons: { id: string; name: string }[]; meId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const row = rows.find((r) => r.id === openId) ?? null;
  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="activity-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2" onClick={() => setOpenId(r.id)} data-testid={`txn-${r.id}`}>
              <span className="w-12 shrink-0 text-[12px] text-ink-3">{dateLabel(r.date)}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13.5px] ${r.voidedAt ? "text-ink-3 line-through" : ""}`}>{r.description}</span>
                <span className="block truncate text-[11.5px] text-ink-3">
                  {r.spaceName} · {r.accountName}
                  {r.categoryName ? ` · ${r.categoryName}` : ""}
                  {r.kind !== "expense" && r.kind !== "income" ? ` · ${r.kindLabel}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {r.reviewStatus === "review_required" && !r.voidedAt && <span className="chip chip-warn">review</span>}
                {r.shares.length > 0 && <span className="chip chip-neutral">split</span>}
                {r.voidedAt && <span className="chip chip-neutral">voided</span>}
                <Cents value={r.signedCents} signed className={`text-[13.5px] ${r.voidedAt ? "text-ink-3" : r.signedCents > 0 ? "text-good" : ""}`} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Drawer open={row !== null} onClose={() => setOpenId(null)} title={row?.description ?? ""} eyebrow={row ? `${row.spaceName} · ${dateLabel(row.date)}` : undefined} testId="activity-detail">
        {row && <Detail row={row} persons={persons} meId={meId} onClose={() => setOpenId(null)} />}
      </Drawer>
    </>
  );
}

function Detail({ row, persons, meId, onClose }: { row: ActivityRow; persons: { id: string; name: string }[]; meId: string | null; onClose: () => void }) {
  const voidFlow = useDraftAction(`void-${row.id}`);
  const splitFlow = useDraftAction(`split-${row.id}`);
  const partner = persons.find((p) => p.id !== meId);
  const canSplit = row.canEdit && row.kind === "expense" && !row.voidedAt && row.spaceKind !== "company" && persons.length >= 2;
  return (
    <div className="space-y-4">
      <p className="num text-[24px] font-semibold">
        <Cents value={row.signedCents} signed />
      </p>
      <dl className="divide-y divide-line rounded-lg border border-line text-[13px]">
        {[
          ["Kind", row.kindLabel],
          ["Account", row.counterAccountName ? `${row.accountName} → ${row.counterAccountName}` : row.accountName],
          ["Category", row.categoryName ?? "—"],
          ["Beneficiary", row.beneficiary ?? "—"],
          ["Purpose", row.purpose ?? "—"],
          ["Tax treatment", row.treatmentLabel ?? "—"],
          ["Review", row.reviewStatus.replace("_", " ")],
          ["Source", row.source],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 px-3 py-1.5">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {row.shares.length > 0 && (
        <div>
          <p className="label">Shares</p>
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line text-[13px]">
            {row.shares.map((s) => (
              <li key={s.personId} className="flex justify-between px-3 py-1.5">
                <span>{s.name}</span>
                <Cents value={s.cents} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {row.documentId && (
        <a className="link text-[13px]" href={`/api/documents/${row.documentId}`} target="_blank" rel="noreferrer">
          Open attached document
        </a>
      )}
      {row.voidedAt && <p className="text-[12.5px] text-ink-3">Voided {row.voidedAt.slice(0, 10)}{row.voidReason ? `: ${row.voidReason}` : ""}. Kept for the audit trail; excluded from every total.</p>}
      {row.canEdit && !row.voidedAt && (
        <div className="space-y-3 border-t border-line pt-3">
          {canSplit && partner && !splitFlow.action && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={splitFlow.busy} onClick={() => splitFlow.draft("food_split", { transactionId: row.id, shares: equalShares(row.amountCents, [meId!, partner.id]) })} data-testid="split-equally">
              Split equally with {partner.name}
            </button>
          )}
          {splitFlow.error && <p className="text-[13px] text-bad">{splitFlow.error}</p>}
          {splitFlow.action && <ActionFlowCard action={splitFlow.action} onChange={splitFlow.onChange} onDone={onClose} />}
          {!voidFlow.action && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
                if (reason) voidFlow.draft("void_transaction", { transactionId: row.id, reason });
              }}
            >
              <label className="flex-1 text-sm">
                <span className="label">Void with a reason</span>
                <input name="reason" className="input mt-1" placeholder="e.g. duplicate entry" required maxLength={200} data-testid="void-reason" />
              </label>
              <button className="btn btn-danger btn-sm" disabled={voidFlow.busy} data-testid="void-preview">
                Preview void
              </button>
            </form>
          )}
          {voidFlow.error && <p className="text-[13px] text-bad">{voidFlow.error}</p>}
          {voidFlow.action && <ActionFlowCard action={voidFlow.action} onChange={voidFlow.onChange} onDone={onClose} />}
          <p className="text-[12px] text-ink-3">Entries are never deleted; voiding keeps the audit trail and removes the entry from totals.</p>
        </div>
      )}
    </div>
  );
}

function equalShares(cents: number, personIds: string[]) {
  const base = Math.floor(cents / personIds.length);
  let rem = cents - base * personIds.length;
  return personIds.map((personId) => ({ personId, cents: base + (rem-- > 0 ? 1 : 0) }));
}
