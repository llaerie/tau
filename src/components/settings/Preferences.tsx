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
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2" data-testid="theme-picker">
      {(["system", "light", "dark"] as const).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} className={`btn btn-sm ${theme === t ? "btn-primary" : "btn-secondary"}`} onClick={() => apply(t)} data-testid={`theme-${t}`}>
          {t === "system" ? "Match system" : t === "light" ? "Light" : "Dark"}
        </button>
      ))}
      {error && <p className="w-full text-[13px] text-bad">{error}</p>}
    </div>
  );
}

export function Toggle({ label, description, initial, field, testId }: { label: string; description: string; initial: boolean; field: "spokenReplies" | "sharePersonalSummary"; testId?: string }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-1"
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
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[12.5px] text-ink-3">{description}</span>
        {error && <span className="block text-[12.5px] text-bad">{error}</span>}
      </span>
    </label>
  );
}
