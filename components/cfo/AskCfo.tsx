"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentResponse } from "@/lib/core/contracts";
import { ExecutiveResponseView } from "./ExecutiveResponseView";
import { Notice } from "@/components/ui/Notice";

export interface AskTurn {
  id: string;
  question: string;
  task?: { kind: string; params?: Record<string, unknown> };
  at: string;
  status: "pending" | "ok" | "error";
  response?: AgentResponse;
  error?: string;
}

const SUGGESTED: { label: string; message: string; task?: AskTurn["task"] }[] = [
  { label: "Cash position", message: "What is our cash position today?", task: { kind: "cash.position" } },
  { label: "13-week cash", message: "Show the 13-week cash forecast and the lowest week.", task: { kind: "cash.thirteen_week" } },
  { label: "Runway", message: "What is our runway and monthly burn?", task: { kind: "cash.runway" } },
  { label: "Budget variance", message: "Explain the budget variance for the current month." },
  { label: "AR aging", message: "Who owes us money and what is overdue?", task: { kind: "ar.aging" } },
  { label: "Next payroll", message: "When is the next payroll and what will it cost?", task: { kind: "payroll.calendar" } },
  { label: "Tax calendar", message: "What tax obligations are coming up?", task: { kind: "tax.calendar" } },
  { label: "Can I take a distribution?", message: "Can I take a $20,000 shareholder distribution this month?" },
];

const STORAGE_KEY = "tau.askcfo.history";

export function AskCfo({ initialTask, initialMessage, compact = false }: { initialTask?: AskTurn["task"]; initialMessage?: string; compact?: boolean }) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [text, setText] = useState(initialMessage ?? "");
  const [busy, setBusy] = useState(false);
  const ranInitial = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setTurns(JSON.parse(raw) as AskTurn[]);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-20)));
    } catch {}
  }, [turns]);

  async function ask(message: string, task?: AskTurn["task"]) {
    const m = message.trim();
    if (!m || busy) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, question: m, task, at: new Date().toISOString(), status: "pending" }]);
    setBusy(true);
    setText("");
    try {
      const res = await fetch("/api/cfo/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m, task }) });
      const body = (await res.json()) as { response?: AgentResponse; error?: { message: string; code: string } };
      if (!res.ok || !body.response) throw new Error(body.error?.message ?? `Request failed (${res.status})`);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "ok", response: body.response } : x)));
    } catch (err) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "error", error: err instanceof Error ? err.message : "Request failed" } : x)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialTask && !ranInitial.current) {
      ranInitial.current = true;
      void ask(initialMessage ?? `Run ${initialTask.kind}`, initialTask);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
        className="rounded-lg border border-line bg-surface p-3"
      >
        <label htmlFor="askcfo" className="sr-only">
          Ask the CFO
        </label>
        <textarea id="askcfo" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(text); }} placeholder="Ask a finance question. Every number comes from the ledger and deterministic calculations, never from the model." className="textarea" rows={compact ? 2 : 3} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => (
              <button key={s.label} type="button" onClick={() => void ask(s.message, s.task)} disabled={busy} className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[12px] hover:bg-surface-2 disabled:opacity-50">
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {turns.length ? (
              <button type="button" onClick={() => setTurns([])} className="text-[12px] text-muted hover:underline">
                Clear session
              </button>
            ) : null}
            <button type="submit" disabled={busy || !text.trim()} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
              {busy ? "Working…" : "Ask CFO"}
            </button>
          </div>
        </div>
      </form>

      <div className="space-y-4">
        {[...turns].reverse().map((t) => (
          <div key={t.id} className="fade-in">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">You</span>
              <span className="text-[13px] font-medium">{t.question}</span>
              {t.task ? <span className="mono text-[11px] text-faint">task {t.task.kind}</span> : null}
            </div>
            {t.status === "pending" ? <div className="h-16 animate-pulse rounded-lg bg-surface-2" /> : null}
            {t.status === "error" ? (
              <Notice tone="bad" title="The CFO could not answer">
                {t.error}
              </Notice>
            ) : null}
            {t.status === "ok" && t.response ? <ExecutiveResponseView res={t.response} compact={compact} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
