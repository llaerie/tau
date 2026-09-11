"use client";
import { useEffect, type ReactNode } from "react";

/** Right-side sheet on desktop, bottom sheet on mobile. */
export function Drawer({ open, onClose, title, children, width = "max-w-xl", footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`fade-in absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-xl border-t border-line bg-surface shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:h-full md:max-h-none md:w-full md:rounded-none md:border-l md:border-t-0 ${width}`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 text-[14px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-[12px] text-muted hover:bg-surface-2" aria-label="Close drawer">
            Close ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
