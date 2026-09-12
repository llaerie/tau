"use client";

import { useState } from "react";
import { preferencesApi } from "@/components/assistant/client";

type Theme = "system" | "light" | "dark";

export function ThemePicker({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [error, setError] = useState<string | null>(null);
  const apply = async (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      await preferencesApi.update({ theme: next });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Theme" className="inline-flex items-center gap-1 rounded-[var(--fd-radius-pill)] bg-surface-2 p-1" data-testid="theme-picker">
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            className={`min-h-[36px] rounded-[var(--fd-radius-pill)] px-3.5 text-[13.5px] font-medium transition-colors ${theme === t ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:text-ink"}`}
            onClick={() => apply(t)}
            data-testid={`theme-${t}`}
          >
            {t === "system" ? "Match system" : t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
    </div>
  );
}

export function Toggle({ label, description, initial, field, testId }: { label: string; description: string; initial: boolean; field: "spokenReplies" | "sharePersonalSummary"; testId?: string }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={on}
        data-testid={testId}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          try {
            await preferencesApi.update({ [field]: next });
            setError(null);
          } catch (err) {
            setOn(!next);
            setError(err instanceof Error ? err.message : "Could not save.");
          }
        }}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-[26px] w-[44px] shrink-0 items-center rounded-[var(--fd-radius-pill)] border p-[3px] transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--fd-primary)] ${on ? "border-transparent bg-accent" : "border-line-2 bg-surface-2"}`}
      >
        <span className={`h-[18px] w-[18px] rounded-full bg-surface shadow-panel transition-transform ${on ? "translate-x-[18px]" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[12.5px] text-ink-3">{description}</span>
        {error && <span className="block text-[12.5px] text-bad">{error}</span>}
      </span>
    </label>
  );
}
