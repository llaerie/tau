"use client";

import { useEffect, useState } from "react";
import { actionsApi, type ActionView } from "./client";

const STATUS_LABEL: Record<ActionView["status"], string> = { draft: "Waiting for your approval", approved: "Approved, not yet applied", applied: "Applied", cancelled: "Cancelled", failed: "Failed", reversed: "Reversed" };

/**
 * Preview → approve → apply for one reviewed action. Nothing is written until
 * the person approves; apply is idempotent so a retry cannot double-record.
 */
export function ActionCard({ actionId, initial, onChange }: { actionId: string; initial?: ActionView; onChange?: (a: ActionView) => void }) {
  const [action, setAction] = useState<ActionView | null>(initial ?? null);
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    actionsApi
      .get(actionId)
      .then((a) => !cancelled && setAction(a))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [actionId, initial]);

  const update = (a: ActionView) => {
    setAction(a);
    onChange?.(a);
  };

  const approveAndApply = async () => {
    if (!action) return;
    setBusy("approve");
    setError(null);
    try {
      const approved = action.status === "approved" ? action : await actionsApi.approve(action.id, action.version);
      update(approved);
      const applied = await actionsApi.apply(approved.id);
      update(applied);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed. Nothing was saved.");
      try {
        update(await actionsApi.get(action.id));
      } catch {
        /* keep last known state */
      }
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!action) return;
    setBusy("cancel");
    setError(null);
    try {
      update(await actionsApi.cancel(action.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(null);
    }
  };

  if (!action) {
    return (
      <div className="rounded-xl border border-line bg-surface p-4" data-testid="action-card-loading">
        {error ? <p className="text-[13px] text-bad">{error}</p> : <div className="space-y-2"><div className="skeleton h-4 w-2/5" /><div className="skeleton h-3 w-4/5" /><div className="skeleton h-3 w-3/5" /></div>}
      </div>
    );
  }
  const p = action.preview;
  const done = action.status === "applied";
  const closed = action.status === "cancelled" || action.status === "reversed";
  return (
    <section className={`fade-in rounded-xl border bg-surface ${done ? "border-good/40" : closed ? "border-line opacity-80" : "border-accent/40"}`} data-testid={`action-${action.type}`} data-status={action.status}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="label">{p.scopeLabel}</p>
          <h3 className="mt-0.5 text-[14px] font-semibold">{p.title}</h3>
          <p className="mt-0.5 text-[13px] text-ink-2">{p.summary}</p>
        </div>
        <span className={`chip ${done ? "chip-good" : closed ? "chip-neutral" : action.status === "failed" ? "chip-bad" : "chip-accent"}`}>{STATUS_LABEL[action.status]}</span>
      </div>
      {p.rows.length > 0 && (
        <div className="mt-3 border-t border-line">
          {p.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0">
              <span className="text-ink-2">{r.label}</span>
              <span className="text-right">
                {r.before !== null && <span className="num mr-2 text-ink-3 line-through">{r.before}</span>}
                <span className="num font-medium">{r.after}</span>
              </span>
              {r.note && <span className="col-span-2 text-[11.5px] text-ink-3">{r.note}</span>}
            </div>
          ))}
        </div>
      )}
      {(p.warnings.length > 0 || p.boundaries.length > 0 || p.privacyNote) && (
        <div className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-2">
          {p.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-warn">{w}</p>
          ))}
          {p.boundaries.length > 0 && <p className="text-ink-3">Will not: {p.boundaries.join("; ")}.</p>}
          {p.privacyNote && <p className="text-ink-3">{p.privacyNote}</p>}
        </div>
      )}
      {error && <p className="border-t border-line px-4 py-2 text-[13px] text-bad">{error}</p>}
      {action.error && action.status === "failed" && <p className="border-t border-line px-4 py-2 text-[13px] text-bad">{action.error}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {!done && !closed && action.status !== "failed" && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={approveAndApply} data-testid="action-approve">
              {busy === "approve" ? "Applying…" : "Approve and apply"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={cancel} data-testid="action-cancel">
              Cancel
            </button>
          </>
        )}
        {done && <p className="text-[12.5px] text-good">Saved {action.appliedAt ? `at ${action.appliedAt.slice(11, 16)} UTC` : ""}. Applying again changes nothing.</p>}
        {closed && <p className="text-[12.5px] text-ink-3">Nothing was saved.</p>}
      </div>
    </section>
  );
}
