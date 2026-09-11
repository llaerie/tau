"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnswerFieldForm({ fieldKey, label, currentValue, currentStatus, requiredConfirmer, compact = false }: { fieldKey: string; label: string; currentValue: unknown; currentStatus: string; requiredConfirmer?: string; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(currentValue === null || currentValue === undefined ? "" : typeof currentValue === "string" ? currentValue : JSON.stringify(currentValue));
  const [status, setStatus] = useState<"CONFIRMED" | "UNCONFIRMED" | "PROFESSIONAL_REVIEW_REQUIRED">(currentStatus === "PROFESSIONAL_REVIEW_REQUIRED" ? "PROFESSIONAL_REVIEW_REQUIRED" : "CONFIRMED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    let parsed: unknown = value;
    const t = value.trim();
    if (t === "") parsed = null;
    else if (/^-?\d+(\.\d+)?$/.test(t)) parsed = t; // keep numerics as strings (money is never a JS number)
    else if (t === "true" || t === "false") parsed = t === "true";
    else if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        parsed = JSON.parse(t);
      } catch {
        parsed = t;
      }
    }
    try {
      const res = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: fieldKey, value: parsed, status, note: note || undefined }) });
      const body = (await res.json()) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setMsg({ ok: true, text: `Saved as ${status}. Prior version kept as SUPERSEDED.` });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`grid gap-2 ${compact ? "" : "rounded-md border border-line bg-surface-2 p-3"}`}>
      <div className="text-[12px] text-muted">
        Answer <span className="font-medium text-fg">{label}</span> <span className="mono">{fieldKey}</span>
        {requiredConfirmer ? (
          <>
            {" "}
            · confirmer <span className="mono">{requiredConfirmer}</span>
          </>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value (leave empty to record a note without a value)" className="input" />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="select sm:w-64">
          <option value="CONFIRMED">CONFIRMED — I know this is true</option>
          <option value="UNCONFIRMED">UNCONFIRMED — proposed / not sure</option>
          <option value="PROFESSIONAL_REVIEW_REQUIRED">PROFESSIONAL REVIEW REQUIRED</option>
        </select>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / source (optional)" className="input" />
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[12px] ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-faint"}`}>{msg ? msg.text : "Never guess: leave unknown values empty and mark them UNCONFIRMED."}</div>
        <button type="submit" disabled={busy} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {busy ? "Saving…" : "Save answer"}
        </button>
      </div>
    </form>
  );
}
