"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Detail surface: a side drawer on wide screens, a bottom sheet on phones.
 * Native <dialog> gives focus trapping, Escape, and focus restoration.
 */
export function Drawer({ open, onClose, title, eyebrow, children, testId, footer }: { open: boolean; onClose: () => void; title: string; eyebrow?: string; children: ReactNode; testId?: string; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88dvh] w-full max-w-none rounded-t-[var(--fd-radius-feature)] bg-surface p-0 text-ink shadow-overlay sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:max-h-none sm:w-[min(94vw,30rem)] sm:rounded-none"
    >
      {open && (
        <div className="slide-up flex max-h-[88dvh] flex-col sm:h-dvh sm:max-h-none">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {eyebrow && <p className="label text-[12px]">{eyebrow}</p>}
              <h2 id={titleId} className="mt-0.5 text-[18px] font-semibold leading-snug">
                {title}
              </h2>
            </div>
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
