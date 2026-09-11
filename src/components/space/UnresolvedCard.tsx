import Link from "next/link";
import { Card } from "@/components/ui";

export function UnresolvedCard({ items, title = "Still unknown" }: { items: { key?: string; label: string; where?: string }[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-unknown/25 bg-unknown-soft/40">
      <h3 className="text-[13.5px] font-semibold">{title}</h3>
      <p className="mt-0.5 text-sm text-ink-2">These stay unknown until someone enters them. They are never treated as zero.</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((u, i) => (
          <li key={u.key ?? i} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>{u.label}</span>
            {u.where && <Link href="/settings" className="link text-xs">{u.where}</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
