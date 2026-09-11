import type { ReactNode } from "react";
import Link from "next/link";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent";

const toneText: Record<Tone, string> = { neutral: "", ok: "text-ok", warn: "text-warn", bad: "text-bad", accent: "text-accent" };

export function Stat({ label, value, sub, tone = "neutral", href, hint, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; href?: string; hint?: string; size?: "md" | "lg" }) {
  const body = (
    <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow)]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted" title={hint}>
        {label}
      </div>
      <div className={`num mt-1.5 font-semibold tracking-tight ${size === "lg" ? "text-[28px]" : "text-[22px]"} ${toneText[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-[12px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}
