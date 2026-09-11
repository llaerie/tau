"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecideButtons({ approvalId, disabled, size = "sm", showComment = false }: { approvalId: string; disabled?: boolean; size?: "sm" | "md"; showComment?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [comment, setComment] = useState("");

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision);
    setMsg(null);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, comment: comment || undefined }) });
      const body = (await res.json()) as { approval?: { status: string }; execution?: { status: string; blockedReason?: string } | null; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      const exec = body.execution ? ` · action ${body.execution.status}${body.execution.blockedReason ? ` (${body.execution.blockedReason})` : ""}` : "";
      setMsg({ tone: decision === "APPROVED" ? "ok" : "bad", text: `Recorded ${decision}. Request is ${body.approval?.status}${exec}.` });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  const cls = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";
  return (
    <div className="flex flex-col gap-1.5">
      {showComment ? <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Decision comment (optional)" className="input" /> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <button disabled={disabled || busy !== null} onClick={() => void decide("APPROVED")} className={`inline-flex items-center rounded-md border border-ok/50 bg-surface font-medium text-ok hover:bg-ok-soft disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
          {busy === "APPROVED" ? "…" : "Approve"}
        </button>
        <button disabled={disabled || busy !== null} onClick={() => void decide("REJECTED")} className={`inline-flex items-center rounded-md border border-bad/50 bg-surface font-medium text-bad hover:bg-bad-soft disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
          {busy === "REJECTED" ? "…" : "Reject"}
        </button>
      </div>
      {msg ? <div className={`text-[12px] ${msg.tone === "ok" ? "text-ok" : "text-bad"}`}>{msg.text}</div> : null}
    </div>
  );
}
