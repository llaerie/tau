import { fmtMoney, fmtSigned, isNegative } from "@/lib/ui/format";
import type { CurrencyCode, DecimalString } from "@/lib/core/types";

export function Money({ value, currency = "USD", signed = false, colorize = false, compact = false, className = "" }: { value: DecimalString | number | null | undefined; currency?: CurrencyCode; signed?: boolean; colorize?: boolean; compact?: boolean; className?: string }) {
  const neg = isNegative(value);
  const text = signed ? fmtSigned(value, currency) : fmtMoney(value, currency, { compact });
  const color = colorize ? (neg ? "text-bad" : value === null || value === undefined ? "text-muted" : "") : "";
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{text}</span>;
}

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`mono text-muted ${className}`}>{children}</span>;
}
