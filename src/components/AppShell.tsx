"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/lib/actions/auth";

export type Destination = "assistant" | "money" | "activity" | "documents" | "settings";

export interface NavItem {
  key: Destination;
  href: string;
  label: string;
}

const ICONS: Record<Destination, string> = {
  assistant: "M4 6h16v10H10l-4 4v-4H4zM8 10h8M8 13h5",
  money: "M3 7h18v10H3zM3 11h18M7 15h3M12 7V5M12 19v-2",
  activity: "M4 18 9 11l4 4 3-5 4 6M4 6h16",
  documents: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4-1.6.6a6.6 6.6 0 0 1-.8 2l.8 1.5-2.1 2.1-1.5-.8a6.6 6.6 0 0 1-2 .8L12 20l-.6-1.6a6.6 6.6 0 0 1-2-.8l-1.5.8-2.1-2.1.8-1.5a6.6 6.6 0 0 1-.8-2L4 12l1.6-.6a6.6 6.6 0 0 1 .8-2l-.8-1.5 2.1-2.1 1.5.8a6.6 6.6 0 0 1 2-.8L12 4l.6 1.6a6.6 6.6 0 0 1 2 .8l1.5-.8 2.1 2.1-.8 1.5a6.6 6.6 0 0 1 .8 2Z",
};

export function Icon({ name, className = "h-5 w-5" }: { name: Destination; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const DESTINATIONS: NavItem[] = [
  { key: "assistant", href: "/", label: "Assistant" },
  { key: "money", href: "/money", label: "Money" },
  { key: "activity", href: "/activity", label: "Activity" },
  { key: "documents", href: "/documents", label: "Documents" },
  { key: "settings", href: "/settings", label: "Settings" },
];

export function AppShell({ workspaceName, userName, isDemo, children }: { workspaceName: string; userName: string; isDemo: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const mobile = DESTINATIONS.filter((d) => d.key !== "settings");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[200px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-line lg:bg-surface">
        <div className="px-4 pb-2 pt-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">Finance Desk</span>
              <span className="block truncate text-[12px] text-ink-3">{workspaceName}</span>
            </span>
          </Link>
        </div>
        <nav className="flex-1 px-3 pt-3" aria-label="Primary">
          <ul className="space-y-0.5">
            {DESTINATIONS.map((it) => (
              <li key={it.key}>
                <Link href={it.href} className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors ${active(it.href) ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`} aria-current={active(it.href) ? "page" : undefined}>
                  <Icon name={it.key} className={`h-[17px] w-[17px] ${active(it.href) ? "text-accent" : "text-ink-3"}`} />
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-line px-4 py-3">
          <ModeBadge isDemo={isDemo} />
          <p className="mt-2 truncate text-[13px] font-medium">{userName}</p>
          <form action={signOut}>
            <button className="text-[12.5px] text-ink-3 hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <Mark small />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight">Finance Desk</span>
              <span className="block truncate text-[11.5px] text-ink-3">{workspaceName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ModeBadge isDemo={isDemo} />
            <ProfileMenu userName={userName} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
          <ul className="grid grid-cols-4 px-1">
            {mobile.map((it) => (
              <li key={it.key}>
                <Link href={it.href} className={`flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10.5px] font-medium ${active(it.href) ? "text-accent" : "text-ink-3"}`} aria-current={active(it.href) ? "page" : undefined}>
                  <Icon name={it.key} />
                  <span className="truncate">{it.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function Mark({ small }: { small?: boolean }) {
  return <span className={`flex items-center justify-center rounded-lg bg-accent font-bold text-on-accent ${small ? "h-7 w-7 text-[12px]" : "h-8 w-8 text-[13px]"}`}>F</span>;
}

function ProfileMenu({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initial = userName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-[12.5px] font-semibold text-ink" aria-haspopup="menu" aria-expanded={open} aria-label="Profile menu" data-testid="profile-menu" onClick={() => setOpen((v) => !v)}>
        {initial}
      </button>
      {open && (
        <div role="menu" className="fade-in absolute right-0 mt-2 w-48 rounded-lg border border-line bg-surface p-1 shadow-float">
          <p className="truncate px-2.5 py-1.5 text-[12.5px] text-ink-3">{userName}</p>
          <Link role="menuitem" href="/settings" className="block rounded-md px-2.5 py-2 text-[13.5px] hover:bg-surface-2" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <Link role="menuitem" href="/settings#appearance" className="block rounded-md px-2.5 py-2 text-[13.5px] hover:bg-surface-2" onClick={() => setOpen(false)}>
            Appearance
          </Link>
          <form action={signOut}>
            <button role="menuitem" className="block w-full rounded-md px-2.5 py-2 text-left text-[13.5px] hover:bg-surface-2">
              Sign out
            </button>
          </form>
        </div>
      )}
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
