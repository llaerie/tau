"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface SettingsGroup {
  id: string;
  label: string;
  summary: string;
  content: ReactNode;
  /** Rarely-needed material: shown under a separate heading in the rail. */
  advanced?: boolean;
}

/**
 * Settings used to be one continuous scroll, so daily choices sat in the same
 * column as tax workpapers. Each group is now its own view, deep-linkable by
 * hash, with the advanced material listed apart from the everyday settings.
 */
export function SettingsTabs({ groups }: { groups: SettingsGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? "");

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace("#", "");
      if (id && groups.some((g) => g.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (id: string) => {
    setActive(id);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${id}`);
  };

  const everyday = groups.filter((g) => !g.advanced);
  const advanced = groups.filter((g) => g.advanced);
  const current = groups.find((g) => g.id === active) ?? groups[0];

  const item = (g: SettingsGroup) => (
    <button
      key={g.id}
      type="button"
      role="tab"
      aria-selected={g.id === current?.id}
      aria-controls={`settings-panel-${g.id}`}
      id={`settings-tab-${g.id}`}
      className={`shrink-0 whitespace-nowrap rounded-[var(--fd-radius-field)] px-3 py-2 text-left text-[14px] font-medium transition-colors min-[900px]:w-full ${
        g.id === current?.id ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
      onClick={() => select(g.id)}
      data-testid={`settings-tab-${g.id}`}
    >
      {g.label}
    </button>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 min-[900px]:grid-cols-[220px_minmax(0,1fr)] min-[900px]:items-start">
      <nav
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 min-[900px]:sticky min-[900px]:top-[76px] min-[900px]:mx-0 min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:px-0"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
      >
        {everyday.map(item)}
        {advanced.length > 0 && (
          <>
            <span aria-hidden="true" className="mx-1 w-px shrink-0 self-stretch bg-line min-[900px]:hidden" />
            <p className="label mt-4 hidden px-3 min-[900px]:block">Advanced</p>
            {advanced.map(item)}
          </>
        )}
      </nav>
      <div
        role="tabpanel"
        id={`settings-panel-${current?.id ?? ""}`}
        aria-labelledby={`settings-tab-${current?.id ?? ""}`}
        tabIndex={-1}
        className="min-w-0"
        data-testid="settings-panel"
      >
        {current && <p className="mb-4 max-w-2xl text-[13.5px] text-ink-3">{current.summary}</p>}
        {current?.content}
      </div>
    </div>
  );
}
