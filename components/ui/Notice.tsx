import type { ReactNode } from "react";

export function Notice({ tone = "info", title, children, className = "" }: { tone?: "info" | "warn" | "bad" | "ok"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const cls = tone === "warn" ? "border-warn/40 bg-warn-soft text-fg" : tone === "bad" ? "border-bad/40 bg-bad-soft text-fg" : tone === "ok" ? "border-ok/40 bg-ok-soft text-fg" : "border-line-strong bg-surface-2 text-fg";
  return (
    <div className={`rounded-md border px-3 py-2 text-[13px] ${cls} ${className}`} role={tone === "bad" ? "alert" : "status"}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className={title ? "mt-0.5 text-muted" : ""}>{children}</div> : null}
    </div>
  );
}

export function ModuleNotice({ notice }: { notice: string | null | undefined }) {
  if (!notice) return null;
  return (
    <Notice tone="warn" title="Subsystem not available yet">
      {notice}. This panel will populate once the module is built; nothing here is estimated in its place.
    </Notice>
  );
}
