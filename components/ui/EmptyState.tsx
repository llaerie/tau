import type { ReactNode } from "react";

export function EmptyState({ title, children, className = "" }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-dashed border-line-strong px-4 py-8 text-center ${className}`}>
      <div className="text-[13px] font-medium">{title}</div>
      {children ? <div className="mt-1 text-[12px] text-muted">{children}</div> : null}
    </div>
  );
}
