"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { preferencesApi } from "@/components/assistant/client";
import { signOut } from "@/lib/actions/auth";

export type Destination = "assistant" | "money" | "activity" | "documents";
export type Theme = "system" | "light" | "dark";

const ICONS: Record<Destination | "settings", string> = {
  assistant: "M4 6h16v10H10l-4 4v-4H4zM8 10h8M8 13h5",
  money: "M3 7h18v10H3zM3 11h18M7 15h3M12 7V5M12 19v-2",
  activity: "M4 18 9 11l4 4 3-5 4 6M4 6h16",
  documents: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h6M10 16h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4-1.6.6a6.6 6.6 0 0 1-.8 2l.8 1.5-2.1 2.1-1.5-.8a6.6 6.6 0 0 1-2 .8L12 20l-.6-1.6a6.6 6.6 0 0 1-2-.8l-1.5.8-2.1-2.1.8-1.5a6.6 6.6 0 0 1-.8-2L4 12l1.6-.6a6.6 6.6 0 0 1 .8-2l-.8-1.5 2.1-2.1 1.5.8a6.6 6.6 0 0 1 2-.8L12 4l.6 1.6a6.6 6.6 0 0 1 2 .8l1.5-.8 2.1 2.1-.8 1.5a6.6 6.6 0 0 1 .8 2Z",
};

const DESTINATIONS: { key: Destination; href: string; label: string }[] = [
  { key: "assistant", href: "/", label: "Assistant" },
  { key: "money", href: "/money", label: "Money" },
  { key: "activity", href: "/activity", label: "Activity" },
  { key: "documents", href: "/documents", label: "Documents" },
];

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: Destination | "settings"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function AppShell({ workspaceName, userName, isDemo, theme, children }: { workspaceName: string; userName: string; isDemo: boolean; theme: Theme; children: ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const title = DESTINATIONS.find((d) => active(d.href))?.label ?? (pathname.startsWith("/settings") ? "Settings" : "Finance Desk");

  return (
    <div className="fd-app min-h-dvh lg:grid lg:grid-cols-[var(--fd-sidebar)_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <Link href="/" className="flex items-center gap-2.5 px-4 pb-2 pt-5">
          <Mark />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-tight">Finance Desk</span>
            <span className="block truncate text-[12.5px] text-ink-3">{workspaceName}</span>
          </span>
        </Link>

        <nav className="flex-1 px-3 pt-4" aria-label="Primary">
          <ul className="space-y-1">
            {DESTINATIONS.map((d) => (
              <li key={d.key}>
                <Link
                  href={d.href}
                  aria-current={active(d.href) ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-3 rounded-[var(--fd-radius-field)] px-3 text-[14.5px] transition-colors ${
                    active(d.href) ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <Icon name={d.key} />
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-line p-3">
          <Link
            href="/settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={`flex min-h-[44px] items-center gap-3 rounded-[var(--fd-radius-field)] px-3 text-[14.5px] transition-colors ${
              pathname.startsWith("/settings") ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon name="settings" />
            Settings
          </Link>
          <div className="mt-2 rounded-[var(--fd-radius-field)] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={userName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{userName}</span>
                <ModeLine isDemo={isDemo} />
              </span>
            </div>
            <form action={signOut}>
              <button className="mt-1.5 min-h-[36px] w-full rounded-[var(--fd-radius-field)] text-left text-[13px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink" aria-label={`Sign out ${userName}`}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/92 px-4 backdrop-blur lg:h-[68px] lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="lg:hidden">
              <Mark small />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-semibold leading-tight lg:text-[17px]">{title}</span>
              <span className="block truncate text-[12.5px] text-ink-3 lg:hidden">{workspaceName}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-[13px] text-ink-3 sm:inline">{today()}</span>
            <ProfileMenu userName={userName} theme={theme} isDemo={isDemo} />
          </div>
        </header>

        <main className="mx-auto w-full flex-1 px-5 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          aria-label="Primary"
        >
          <ul className="grid grid-cols-4">
            {DESTINATIONS.map((d) => (
              <li key={d.key}>
                <Link
                  href={d.href}
                  aria-current={active(d.href) ? "page" : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium ${active(d.href) ? "text-accent" : "text-ink-3"}`}
                >
                  <Icon name={d.key} className="h-[21px] w-[21px]" />
                  <span className="truncate">{d.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
}

function Mark({ small }: { small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[12px] font-bold text-on-accent ${small ? "h-8 w-8 text-[13px]" : "h-9 w-9 text-[14px]"}`}
      style={{ background: "var(--fd-action-gradient)" }}
      aria-hidden="true"
    >
      F
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink-2" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ModeLine({ isDemo }: { isDemo: boolean }) {
  return (
    <span className="block truncate text-[12px] text-ink-3" data-testid="mode-badge">
      {isDemo ? "Synthetic demo data" : "Live data"}
    </span>
  );
}

export function ModeBadge({ isDemo, className = "" }: { isDemo: boolean; className?: string }) {
  return (
    <span className={`chip ${isDemo ? "chip-warn" : "chip-good"} ${className}`} data-testid="mode-badge">
      {isDemo ? "Synthetic demo data" : "Live data"}
    </span>
  );
}

function ProfileMenu({ userName, theme, isDemo }: { userName: string; theme: Theme; isDemo: boolean }) {
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profile and appearance"
        data-testid="profile-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={userName} />
      </button>
      {open && (
        <div role="menu" className="fade-in absolute right-0 z-40 mt-2 w-[264px] rounded-[var(--fd-radius-card)] bg-surface p-2 shadow-overlay">
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-[14px] font-semibold">{userName}</p>
            <p className="truncate text-[12.5px] text-ink-3">{isDemo ? "Synthetic demo data" : "Live data"}</p>
          </div>
          <div className="px-2.5 py-2">
            <p className="label mb-1.5 text-[12px]">Appearance</p>
            <ThemeControl initial={theme} />
          </div>
          <Link role="menuitem" href="/settings" className="mt-1 flex min-h-[44px] items-center gap-3 rounded-[var(--fd-radius-field)] px-2.5 text-[14px] hover:bg-surface-2 lg:hidden" onClick={() => setOpen(false)}>
            <Icon name="settings" />
            Settings
          </Link>
          <Link role="menuitem" href="/settings" className="mt-1 hidden min-h-[44px] items-center gap-3 rounded-[var(--fd-radius-field)] px-2.5 text-[14px] hover:bg-surface-2 lg:flex" onClick={() => setOpen(false)}>
            <Icon name="settings" />
            Settings and integrations
          </Link>
          <form action={signOut}>
            <button role="menuitem" className="flex min-h-[44px] w-full items-center rounded-[var(--fd-radius-field)] px-2.5 text-left text-[14px] hover:bg-surface-2">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Appearance control. Applies immediately and persists; never reloads, so page state survives. */
export function ThemeControl({ initial }: { initial: Theme }) {
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
    <>
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-[var(--fd-radius-field)] bg-surface-2 p-1" data-testid="theme-picker">
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            data-testid={`theme-${t}`}
            onClick={() => apply(t)}
            className={`min-h-[36px] rounded-[10px] text-[13px] font-medium transition-colors ${theme === t ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:text-ink"}`}
          >
            {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-[12.5px] text-bad">{error}</p>}
    </>
  );
}
