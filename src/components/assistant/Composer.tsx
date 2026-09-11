"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "./useSpeech";

export type Scope = "me" | "company" | "household";

export const STARTERS: { label: string; message: string }[] = [
  { label: "What can I spend?", message: "What can I spend this month?" },
  { label: "Record a receipt", message: "Record a receipt" },
  { label: "Plan a purchase", message: "Plan a purchase" },
];

const SCOPE_LABEL: Record<Scope, string> = { company: "Company", household: "Household", me: "My money" };

export function Composer({ scopes, scope, onScope, onSend, busy, onStop, showStarters }: { scopes: Scope[]; scope: Scope; onScope: (s: Scope) => void; onSend: (text: string) => void; busy: boolean; onStop: () => void; showStarters: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const onFinal = useCallback((t: string) => setText((v) => (v ? `${v} ${t}` : t)), []);
  const speech = useSpeechRecognition(onFinal);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  const listening = speech.state === "listening";
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-float" data-testid="composer">
      {showStarters && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {STARTERS.map((s) => (
            <button key={s.label} type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onSend(s.message)} data-testid={`starter-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="px-3 pt-2">
        <label htmlFor="composer-input" className="sr-only">
          Ask about your money
        </label>
        <textarea
          id="composer-input"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={scope === "company" ? "Ask about the company: receipts, payroll, commitments…" : scope === "household" ? "Ask about shared bills and the joint account…" : "Ask about your take-home, food, or record something…"}
          className="block w-full resize-none bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-ink-3"
          disabled={busy}
        />
        {listening && (
          <p className="pb-1 text-[13px] text-accent" aria-live="polite" data-testid="voice-transcript">
            <span className="pulse-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
            {speech.interim || "Listening… release to finish."}
          </p>
        )}
        {speech.state === "denied" && <p className="pb-1 text-[12.5px] text-warn">Microphone access was denied. Allow it in the browser to use push-to-talk; typing still works.</p>}
        {speech.state === "error" && <p className="pb-1 text-[12.5px] text-warn">Speech recognition stopped. Try again or type instead.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Scope">
          {scopes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors ${scope === s ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`} onClick={() => onScope(s)} data-testid={`scope-${s}`}>
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {speech.supported ? (
            <button
              type="button"
              className={`btn btn-icon ${listening ? "btn-primary" : "btn-secondary"}`}
              aria-label={listening ? "Stop listening" : "Push to talk (hold)"}
              aria-pressed={listening}
              title="Push to talk: hold to speak, release to finish. The transcript appears here before you send it."
              disabled={busy}
              onPointerDown={(e) => {
                e.preventDefault();
                speech.start();
              }}
              onPointerUp={() => speech.stop()}
              onPointerLeave={() => listening && speech.stop()}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !listening) {
                  e.preventDefault();
                  speech.start();
                }
              }}
              onKeyUp={(e) => {
                if ((e.key === " " || e.key === "Enter") && listening) speech.stop();
              }}
              data-testid="push-to-talk"
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
              </svg>
            </button>
          ) : (
            <span className="text-[11.5px] text-ink-3" title="This browser does not offer speech recognition.">
              Voice unavailable here
            </span>
          )}
          {busy ? (
            <button type="button" className="btn btn-secondary" onClick={onStop} data-testid="composer-stop">
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!text.trim()} data-testid="composer-send">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
