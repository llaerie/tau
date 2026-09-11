import type { ReactNode } from "react";

/** Native, JS-free collapsible. */
export function Details({ summary, children, open = false, className = "" }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details open={open} className={`group rounded-md border border-line bg-surface ${className}`}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium hover:bg-surface-2">
        <span className="min-w-0">{summary}</span>
        <span className="text-[11px] text-muted group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-line px-3 py-2 text-[13px]">{children}</div>
    </details>
  );
}
