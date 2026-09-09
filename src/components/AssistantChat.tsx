"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantTurn } from "@/lib/assistant/run";

const SUGGESTIONS = [
  "How much cash belongs to the business right now?",
  "What is already committed each month?",
  "What can the company put toward the household?",
  "What do I actually have available after my goals?",
  "Can I afford a $1,800 laptop this month?",
  "Could the household take on $250 a month for a car?",
  "What is still unknown?",
];

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((para, i) => (
        <div key={i} className="space-y-0.5">
          {para.split("\n").map((line, j) => {
            const bold = line.match(/^\*\*(.+)\*\*$/);
            if (bold) return <p key={j} className="font-semibold">{bold[1]}</p>;
            if (line.startsWith("- ")) return <p key={j} className="pl-3">• {line.slice(2)}</p>;
            return <p key={j}>{line.replace(/\*\*/g, "")}</p>;
          })}
        </div>
      ))}
    </div>
  );
}

export function AssistantChat({ initial, connected, personName }: { initial: AssistantTurn[]; connected: boolean; personName: string }) {
  const [turns, setTurns] = useState<AssistantTurn[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setTurns((t) => [...t, { role: "user", text: message, createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setTurns((t) => [...t, data.turn]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await fetch("/api/assistant", { method: "DELETE" });
    setTurns([]);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="card flex min-h-[28rem] flex-col">
        <div className="flex-1 space-y-4 p-4 sm:p-5">
          {turns.length === 0 && <p className="text-sm text-ink-3">Ask a question, {personName}. Try one of the suggestions.</p>}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
              {t.role === "user" ? (
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-4 py-2 text-[15px]">{t.text}</p>
              ) : (
                <div className="max-w-full" data-testid="assistant-reply">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`chip ${t.mode === "claude" ? "chip-good" : "chip-unknown"}`}>{t.mode === "claude" ? "Claude · tool-computed" : "Deterministic preview · no model connected"}</span>
                  </div>
                  <Paragraphs text={t.text} />
                  {t.toolCalls && t.toolCalls.length > 0 && (
                    <details className="mt-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-ink-2">{t.toolCalls.length} tool call(s): {t.toolCalls.map((c) => c.name).join(", ")}</summary>
                      <div className="mt-2 space-y-2">
                        {t.toolCalls.map((c, j) => (
                          <div key={j}>
                            <p className="font-medium">{c.name} {Object.keys(c.input).length ? JSON.stringify(c.input) : ""}</p>
                            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-snug">{c.error ?? JSON.stringify(c.result, null, 1)}</pre>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-sm text-ink-3">{connected ? "Asking Claude…" : "Running tools…"}</p>}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about cash, commitments, goals or a purchase…" aria-label="Message" data-testid="assistant-input" />
          <button className="btn btn-primary" disabled={busy || !input.trim()} data-testid="assistant-send">Send</button>
        </form>
      </div>
      <aside className="space-y-2">
        <p className="label">Suggestions</p>
        {SUGGESTIONS.map((sug) => (
          <button key={sug} type="button" className="block w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => void send(sug)} disabled={busy}>
            {sug}
          </button>
        ))}
        {turns.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear conversation</button>}
      </aside>
    </div>
  );
}
