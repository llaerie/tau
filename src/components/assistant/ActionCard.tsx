"use client";

import { useEffect, useRef, useState } from "react";
import { actionsApi, type ActionView } from "./client";

const STATUS_LABEL: Record<ActionView["status"], string> = { draft: "Waiting for you", approved: "Approved, applying", applied: "Applied", cancelled: "Cancelled", failed: "Failed", reversed: "Reversed" };

/**
 * Preview → approve → apply for one reviewed action. Nothing is written until
 * the person approves; apply is idempotent so a retry cannot double-record.
 */
export function ActionCard({ actionId, initial, onChange }: { actionId: string; initial?: ActionView; onChange?: (a: ActionView) => void }) {
  const [action, setAction] = useState<ActionView | null>(initial ?? null);
  const footerRef = useRef<HTMLDivElement>(null);
  const broughtIntoView = useRef(false);
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

  useEffect(() => {
    if (!action || broughtIntoView.current) return;
    if (action.status !== "draft" && action.status !== "approved") return;
    broughtIntoView.current = true;
    // Compute the offset rather than relying on scroll-margin, which the browser
    // does not apply consistently here. --fd-dock-space is the measured composer.
    const id = window.setTimeout(() => {
      const el = footerRef.current;
      if (!el) return;
      const dock = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--fd-dock-space"), 10) || 240;
      const delta = el.getBoundingClientRect().bottom - (window.innerHeight - dock);
      if (delta > 8) window.scrollBy({ top: delta, behavior: "smooth" });
    }, 90);
    return () => window.clearTimeout(id);
  }, [action]);

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
      <div className="card p-5" data-testid="action-card-loading">
        {error ? <p className="text-[13px] text-bad">{error}</p> : <div className="space-y-2"><div className="skeleton h-4 w-2/5" /><div className="skeleton h-3 w-4/5" /><div className="skeleton h-3 w-3/5" /></div>}
      </div>
    );
  }
  const p = action.preview;
  const done = action.status === "applied";
  const closed = action.status === "cancelled" || action.status === "reversed";
  return (
    <section
      className="fade-in card overflow-hidden"
      style={{ boxShadow: done ? "var(--fd-highlight), 0 0 0 1.5px var(--fd-success), var(--fd-shadow-panel)" : closed ? "var(--fd-highlight), var(--fd-shadow-panel)" : "var(--fd-highlight), 0 0 0 1.5px var(--fd-primary), var(--fd-shadow-raised)", opacity: closed ? 0.85 : 1 }}
      data-testid={`action-${action.type}`}
      data-status={action.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5 px-5 pt-4">
        <div className="min-w-0">
          <p className="label text-[12px]">{p.scopeLabel}</p>
          <h3 className="mt-1 text-[17px] font-semibold leading-snug">{p.title}</h3>
          <p className="mt-1 text-[13.5px] text-ink-2">{p.summary}</p>
        </div>
        <span className={`chip ${done ? "chip-good" : closed ? "chip-neutral" : action.status === "failed" ? "chip-bad" : "chip-accent"}`}>{STATUS_LABEL[action.status]}</span>
      </div>
      {p.rows.length > 0 && (
        <div className="mt-3 border-t border-line">
          {p.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-line px-5 py-2.5 text-[13.5px] last:border-b-0">
              <span className="text-ink-2">{r.label}</span>
              <span className="text-right">
                {r.before !== null && r.before !== r.after && <span className="fd-money mr-2 text-ink-3 line-through">{r.before}</span>}
                <span className="fd-money font-semibold">{r.after}</span>
              </span>
              {r.note && <span className="col-span-2 text-[12.5px] leading-snug text-ink-3">{r.note}</span>}
            </div>
          ))}
        </div>
      )}
      {(p.warnings.length > 0 || p.boundaries.length > 0 || p.privacyNote) && (
        <div className="border-t border-line bg-surface-2 px-5 py-3 text-[13px] text-ink-2">
          {p.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-warn">{w}</p>
          ))}
          {p.boundaries.length > 0 && (
            <>
              <p className="label mb-1 text-[12px]">What this does, and does not do</p>
              <ul className="space-y-1">
                {p.boundaries.map((b, i) => (
                  <li key={`b${i}`} className="flex gap-2 text-ink-2">
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.privacyNote && <p className="mt-0.5 text-ink-3">{p.privacyNote}</p>}
        </div>
      )}
      {error && <p className="border-t border-line px-5 py-2.5 text-[13.5px] text-bad">{error}</p>}
      {action.error && action.status === "failed" && <p className="border-t border-line px-5 py-2.5 text-[13.5px] text-bad">{action.error}</p>}
      <div ref={footerRef} className="flex flex-wrap items-center gap-2.5 border-t border-line px-5 py-4" style={{ scrollMarginBottom: "var(--fd-dock-space, 15.5rem)" }}>
        {!done && !closed && action.status !== "failed" && (
          <>
            <button type="button" className="btn btn-primary flex-1 sm:flex-none" disabled={busy !== null} onClick={approveAndApply} data-testid="action-approve">
              {busy === "approve" ? "Applying…" : "Approve and apply"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={cancel} data-testid="action-cancel">
              Cancel
            </button>
          </>
        )}
        {done && <p className="text-[13px] font-medium text-good">Saved. Asking again will not record it twice.</p>}
        {closed && <p className="text-[13px] text-ink-3">Nothing was saved.</p>}
      </div>
    </section>
  );
}
