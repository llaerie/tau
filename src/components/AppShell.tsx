"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  short?: string;
  icon: keyof typeof ICONS;
}

const ICONS = {
  overview: "M3 12 12 4l9 8M5 10v10h5v-6h4v6h5V10",
  company: "M4 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14M4 20h16M8 8h4M8 12h4M8 16h4M16 12h4v8",
  household: "M3 11 12 3l9 8M5 9.5V20h14V9.5M10 20v-6h4v6",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  ledger: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  accounts: "M3 7h18v10H3zM3 11h18M7 15h3",
  scenarios: "M4 18 10 9l4 5 6-8M4 18h16",
  assistant: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4-1.6.6a6.6 6.6 0 0 1-.8 2l.8 1.5-2.1 2.1-1.5-.8a6.6 6.6 0 0 1-2 .8L12 20l-.6-1.6a6.6 6.6 0 0 1-2-.8l-1.5.8-2.1-2.1.8-1.5a6.6 6.6 0 0 1-.8-2L4 12l1.6-.6a6.6 6.6 0 0 1 .8-2l-.8-1.5 2.1-2.1 1.5.8a6.6 6.6 0 0 1 2-.8L12 4l.6 1.6a6.6 6.6 0 0 1 2 .8l1.5-.8 2.1 2.1-.8 1.5a6.6 6.6 0 0 1 .8 2Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function AppShell({
  items,
  mobileItems,
  workspaceName,
  userName,
  isDemo,
  children,
}: {
  items: NavItem[];
  mobileItems: NavItem[];
  workspaceName: string;
  userName: string;
  isDemo: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-line lg:bg-surface">
        <div className="px-4 pb-3 pt-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-[13px] font-bold text-white">F</span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">Finance Desk</span>
              <span className="block truncate text-[12px] text-ink-3">{workspaceName}</span>
            </span>
          </Link>
          <ModeBadge isDemo={isDemo} className="mt-3" />
        </div>
        <nav className="flex-1 overflow-y-auto px-3" aria-label="Primary">
          <ul className="space-y-0.5">
            {items.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors ${active(it.href) ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                  aria-current={active(it.href) ? "page" : undefined}
                >
                  <Icon name={it.icon} className={`h-[17px] w-[17px] ${active(it.href) ? "text-accent" : "text-ink-3"}`} />
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-line px-4 py-3 text-[13px]">
          <p className="truncate font-medium">{userName}</p>
          <Link href="/settings" className="text-ink-3 hover:text-ink">
            Settings &amp; sign out
          </Link>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[12px] font-bold text-white">F</span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">Finance Desk</span>
              <span className="block truncate text-[11.5px] text-ink-3">{workspaceName}</span>
            </span>
          </Link>
          <ModeBadge isDemo={isDemo} />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
          <ul className="grid grid-cols-5 px-1">
            {mobileItems.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10.5px] font-medium ${active(it.href) ? "text-accent" : "text-ink-3"}`}
                  aria-current={active(it.href) ? "page" : undefined}
                >
                  <Icon name={it.icon} />
                  <span className="truncate">{it.short ?? it.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export function ModeBadge({ isDemo, className = "" }: { isDemo: boolean; className?: string }) {
  return (
    <span className={`chip ${isDemo ? "chip-warn" : "chip-good"} ${className}`} data-testid="mode-badge">
      {isDemo ? "Synthetic demo data" : "Live data"}
    </span>
  );
}
