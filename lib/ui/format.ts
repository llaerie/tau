/**
 * Display formatting helpers for the UI. Money is never a JS number in storage;
 * these helpers only format DecimalStrings for presentation.
 */
import { fmtMoney as coreFmtMoney, fmtPercent as coreFmtPercent, D } from "@/lib/core/money";
import { fmtDate as coreFmtDate } from "@/lib/core/dates";
import type { CurrencyCode, DecimalString, ISODate, ISODateTime } from "@/lib/core/types";

export function fmtMoney(v: DecimalString | number | null | undefined, currency: CurrencyCode = "USD", opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || v === "") return "—";
  try {
    return coreFmtMoney(v, currency, opts);
  } catch {
    return String(v);
  }
}

/** Money with an explicit sign for deltas ("+$1,200.00" / "-$300.00"). */
export function fmtSigned(v: DecimalString | number | null | undefined, currency: CurrencyCode = "USD"): string {
  if (v === null || v === undefined) return "—";
  const d = D(v);
  const s = fmtMoney(d.abs().toFixed(4), currency);
  return d.isZero() ? s : d.isNegative() ? `-${s}` : `+${s}`;
}

export function fmtPercent(v: number | null | undefined, dp = 1): string {
  return coreFmtPercent(v, dp);
}

export function fmtRatio(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(dp);
}

export function fmtNumber(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(v);
}

export function fmtDate(s: ISODate | null | undefined): string {
  return coreFmtDate(s);
}

export function fmtDateTime(s: ISODateTime | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtMonth(m: string | null | undefined): string {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, 1));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });
}

export function shortId(id: string | null | undefined, n = 10): string {
  if (!id) return "—";
  return id.length > n + 3 ? `${id.slice(0, n)}…` : id;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function isNegative(v: DecimalString | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  try {
    return D(v).isNegative() && !D(v).isZero();
  } catch {
    return false;
  }
}

export function toNum(v: DecimalString | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  try {
    return D(v).toNumber();
  } catch {
    return 0;
  }
}
