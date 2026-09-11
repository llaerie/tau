"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, type ButtonVariant, type ButtonSize } from "./Button";

export interface ActionResult {
  ok: boolean;
  text: string;
  level?: string;
}

/** POSTs JSON to an API route and shows the outcome inline. Refreshes server data on success. */
export function ActionButton({ url, body, children, variant = "secondary", size = "sm", confirm, disabled, method = "POST", summarize, className = "", refresh = true }: { url: string; body?: unknown; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; confirm?: string; disabled?: boolean; method?: "POST" | "DELETE"; summarize?: (body: Record<string, unknown>) => ActionResult; className?: string; refresh?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ActionResult | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message: string } };
      if (!r.ok) throw new Error(data.error?.message ?? `Failed (${r.status})`);
      const out = summarize ? summarize(data) : defaultSummary(data);
      setRes(out);
      if (refresh) router.refresh();
    } catch (err) {
      setRes({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <button onClick={() => void run()} disabled={disabled || busy} className={buttonClass(variant, size)}>
        {busy ? "…" : children}
      </button>
      {res ? <div className={`max-w-md text-[11px] leading-snug ${res.ok ? "text-ok" : "text-bad"}`}>{res.text}</div> : null}
    </div>
  );
}

export function defaultSummary(data: Record<string, unknown>): ActionResult {
  const action = data.action as { status?: string; risk?: { level?: string; reasons?: string[] }; approvalId?: string; blockedReason?: string } | undefined;
  if (action) {
    const ok = action.status === "EXECUTED" || action.status === "AWAITING_APPROVAL" || action.status === "SIMULATED";
    return { ok, level: action.risk?.level, text: `${action.risk?.level ?? ""} → ${action.status}${action.approvalId ? ` · approval ${action.approvalId}` : ""}${action.blockedReason ? ` · ${action.blockedReason}` : ""}${action.risk?.reasons?.length ? ` · ${action.risk.reasons.join(" ")}` : ""}` };
  }
  if (typeof data.message === "string") return { ok: true, text: data.message };
  return { ok: true, text: "Done" };
}
