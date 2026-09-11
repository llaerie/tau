"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Detail surface: a side drawer on wide screens, a bottom sheet on phones.
 * Uses the native <dialog> for focus trapping and Escape handling.
 */
export function Drawer({ open, onClose, title, eyebrow, children, testId }: { open: boolean; onClose: () => void; title: string; eyebrow?: string; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-float open:slide-up sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:h-dvh sm:w-[min(94vw,30rem)] sm:rounded-none sm:border-l sm:border-y-0 sm:border-r-0"
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col sm:h-dvh sm:max-h-none">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {eyebrow && <p className="label">{eyebrow}</p>}
              <h2 className="mt-0.5 truncate text-[16px] font-semibold">{title}</h2>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
