"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "./useSpeech";

export type Scope = "me" | "company" | "household";

const SCOPE_LABEL: Record<Scope, string> = { company: "Company", household: "Household", me: "My money" };

export function Composer({
  scopes,
  scope,
  onScope,
  onSend,
  busy,
  onStop,
  docked,
}: {
  scopes: Scope[];
  scope: Scope;
  onScope: (s: Scope) => void;
  onSend: (text: string) => void;
  busy: boolean;
  onStop: () => void;
  docked: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const onFinal = useCallback((t: string) => setText((v) => (v ? `${v} ${t}` : t)), []);
  const speech = useSpeechRecognition(onFinal);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 152)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  const listening = speech.state === "listening";
  return (
    <div
      className={`rounded-[var(--fd-radius-feature)] bg-surface transition-shadow ${docked ? "shadow-overlay" : "shadow-panel"}`}
      style={{ boxShadow: docked ? undefined : "var(--fd-highlight), var(--fd-shadow-raised)" }}
      data-testid="composer"
    >
      <div className="px-4 pt-3.5">
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
          placeholder={scope === "company" ? "Ask about the company…" : scope === "household" ? "Ask about the household…" : "Ask about your money…"}
          className="block w-full resize-none bg-transparent py-1 text-[16px] leading-6 text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          disabled={busy}
        />
        {listening && (
          <p className="pb-1 text-[13.5px] text-accent" aria-live="polite" data-testid="voice-transcript">
            <span className="pulse-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
            {speech.interim || "Listening. Release to finish."}
          </p>
        )}
        {speech.state === "denied" && <p className="pb-1 text-[13px] text-warn">Microphone access was denied. Typing still works.</p>}
        {speech.state === "error" && <p className="pb-1 text-[13px] text-warn">Speech recognition stopped. Try again or type instead.</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1.5">
        <div className="flex items-center gap-1 rounded-[var(--fd-radius-pill)] bg-surface-2 p-1" role="radiogroup" aria-label="Scope">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              className={`min-h-[36px] rounded-[var(--fd-radius-pill)] px-3.5 text-[13.5px] font-medium transition-colors ${scope === s ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:text-ink"}`}
              onClick={() => onScope(s)}
              data-testid={`scope-${s}`}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {speech.supported ? (
            <button
              type="button"
              className={`btn btn-icon ${listening ? "btn-primary" : "btn-secondary"}`}
              aria-label={listening ? "Stop listening" : "Push to talk"}
              aria-pressed={listening}
              title="Hold to speak. The transcript appears before you send it."
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
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
              </svg>
            </button>
          ) : (
            <span className="text-[12.5px] text-ink-3" title="This browser does not offer speech recognition.">
              Voice unavailable
            </span>
          )}
          {busy ? (
            <button type="button" className="btn btn-secondary" onClick={onStop} data-testid="composer-stop">
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!text.trim()} data-testid="composer-send">
              Send
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h13m-5-5 5 5-5 5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Contextual starters. Vertical list on narrow screens, wrapped chips when there is room. */
export function ActionStarters({ starters, onPick, busy }: { starters: { label: string; hint: string; message: string }[]; onPick: (m: string) => void; busy: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="starters">
      {starters.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={busy}
          onClick={() => onPick(s.message)}
          data-testid={`starter-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
          className="card flex min-h-[44px] flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <span className="text-[14px] font-semibold">{s.label}</span>
          <span className="text-[12.5px] leading-snug text-ink-3">{s.hint}</span>
        </button>
      ))}
    </div>
  );
}
