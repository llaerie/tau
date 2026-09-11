"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NAV, VERSION_TAG, type NavItem } from "./nav";

export interface ShellProps {
  actor: { id: string; role: string; displayName?: string };
  profile: { displayName: string; isSynthetic: boolean; asOfDate: string };
  badges: { approvals: number; attention: number };
  children: ReactNode;
}

function NavLink({ item, active, collapsed, badge, onNavigate }: { item: NavItem; active: boolean; collapsed: boolean; badge?: number; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${active ? "bg-accent-soft font-semibold text-accent" : "text-fg hover:bg-surface-2"}`}
    >
      <span className={`truncate ${collapsed ? "sr-only" : ""}`}>{item.label}</span>
      {collapsed ? <span className="mx-auto text-[12px] font-semibold">{item.label.slice(0, 2)}</span> : null}
      {!collapsed && badge ? <span className={`num rounded px-1.5 text-[11px] font-semibold ${active ? "bg-accent text-accent-fg" : "bg-warn-soft text-warn"}`}>{badge}</span> : null}
    </Link>
  );
}

export function Shell({ actor, profile, badges, children }: ShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("tau.sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("tau.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };
  useEffect(() => setOpen(false), [pathname]);

  const groups = ["Command", "Operations", "Governance"] as const;
  const badgeFor = (i: NavItem) => (i.badgeKey ? badges[i.badgeKey] : undefined);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navBody = (mobile: boolean) => (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3" aria-label="Primary">
      {groups.map((g) => (
        <div key={g}>
          {!collapsed || mobile ? <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-faint">{g}</div> : <div className="my-2 border-t border-line" />}
          <div className="flex flex-col gap-0.5">
            {NAV.filter((i) => i.group === g).map((i) => (
              <NavLink key={i.href} item={i} active={isActive(i.href)} collapsed={collapsed && !mobile} badge={badgeFor(i)} onNavigate={mobile ? () => setOpen(false) : undefined} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (mobile: boolean) => (
    <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
      {!collapsed || mobile ? (
        <>
          <div className="font-semibold text-fg">{VERSION_TAG}</div>
          <div className="mt-0.5 truncate">
            {actor.displayName ?? actor.id} · <span className="mono">{actor.role}</span>
          </div>
          <div className="mt-0.5 num">As of {profile.asOfDate}</div>
        </>
      ) : (
        <div className="text-center font-semibold" title={VERSION_TAG}>
          P1
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      {profile.isSynthetic ? (
        <div className="sticky top-0 z-40 border-b border-warn/40 bg-warn-soft px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-warn" role="status">
          SYNTHETIC LAB DATA — no live financial accounts connected
        </div>
      ) : null}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface md:flex ${collapsed ? "w-14" : "w-56"}`} style={profile.isSynthetic ? { top: 0 } : undefined}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
            {!collapsed ? (
              <Link href="/overview" className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight">Tau AI CFO</div>
                <div className="truncate text-[11px] text-muted">{profile.displayName}</div>
              </Link>
            ) : (
              <Link href="/overview" className="mx-auto text-[15px] font-semibold">
                τ
              </Link>
            )}
            <button onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2">
              {collapsed ? "»" : "«"}
            </button>
          </div>
          {navBody(false)}
          {footer(false)}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 md:hidden">
            <Link href="/overview" className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight">Tau AI CFO</div>
              <div className="truncate text-[11px] text-muted">{profile.displayName}</div>
            </Link>
            <button onClick={() => setOpen(true)} className="rounded-md border border-line-strong px-2.5 py-1 text-[13px] font-medium" aria-label="Open navigation">
              Menu
            </button>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
      </div>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="fade-in absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-xl border-t border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-[14px] font-semibold">Navigate</div>
              <button onClick={() => setOpen(false)} className="text-[12px] text-muted">
                Close ✕
              </button>
            </div>
            {navBody(true)}
            {footer(true)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
