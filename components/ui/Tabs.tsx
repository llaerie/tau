import Link from "next/link";
import type { ReactNode } from "react";

export interface TabDef {
  key: string;
  label: ReactNode;
  count?: number;
}

/** Link-based tabs: deep-linkable via ?tab= and rendered on the server. */
export function Tabs({ tabs, active, basePath, param = "tab", preserve = {} }: { tabs: TabDef[]; active: string; basePath: string; param?: string; preserve?: Record<string, string | undefined> }) {
  const qs = (key: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(preserve)) if (v) sp.set(k, v);
    sp.set(param, key);
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="scroll-x mb-4 border-b border-line">
      <nav className="-mb-px flex min-w-max gap-1" aria-label="Tabs">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={qs(t.key)}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${isActive ? "border-accent text-fg" : "border-transparent text-muted hover:border-line-strong hover:text-fg"}`}
            >
              {t.label}
              {t.count !== undefined ? <span className={`num rounded px-1.5 text-[11px] ${isActive ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>{t.count}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function pickTab(value: string | string[] | undefined, keys: string[], fallback = keys[0]): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && keys.includes(v) ? v : fallback;
}
