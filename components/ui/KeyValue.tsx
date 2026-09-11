import type { ReactNode } from "react";

export interface KV {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
}

export function KeyValue({ items, className = "", dense = false }: { items: KV[]; className?: string; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 ${dense ? "gap-y-1" : "gap-y-2"} text-[13px] ${className}`}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{it.k}</dt>
          <dd className={`min-w-0 break-words ${it.mono ? "mono" : ""}`}>{it.v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
