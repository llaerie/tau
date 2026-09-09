/**
 * Decimal-safe money arithmetic. Money is never a JS number in storage.
 * All public functions accept DecimalString | number | Decimal and return
 * DecimalString (4 decimal places of internal precision, 2 for display).
 */
import Decimal from "decimal.js";
import type { CurrencyCode, DecimalString, Money } from "./types";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type Numeric = DecimalString | number | Decimal;

export const D = (v: Numeric | null | undefined): Decimal => {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Non-finite number passed to money: ${v}`);
    return new Decimal(v.toString());
  }
  const s = String(v).trim().replace(/,/g, "");
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === "-" || s === "") {
    throw new Error(`Invalid decimal string: "${v}"`);
  }
  return new Decimal(s);
};

/** Normalize to a canonical 4-dp decimal string ("1234.5600"). */
export const money = (v: Numeric | null | undefined): DecimalString => D(v).toFixed(4);
/** Round to cents (2 dp) as canonical decimal string. */
export const cents = (v: Numeric): DecimalString => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);

export const add = (...vals: Numeric[]): DecimalString =>
  vals.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0)).toFixed(4);
export const sub = (a: Numeric, b: Numeric): DecimalString => D(a).minus(D(b)).toFixed(4);
export const mul = (a: Numeric, b: Numeric): DecimalString => D(a).times(D(b)).toFixed(4);
export const div = (a: Numeric, b: Numeric): DecimalString => {
  const den = D(b);
  if (den.isZero()) throw new Error("Division by zero in money.div");
  return D(a).div(den).toFixed(4);
};
export const neg = (a: Numeric): DecimalString => D(a).neg().toFixed(4);
export const abs = (a: Numeric): DecimalString => D(a).abs().toFixed(4);
export const min = (...vals: Numeric[]): DecimalString => Decimal.min(...vals.map(D)).toFixed(4);
export const max = (...vals: Numeric[]): DecimalString => Decimal.max(...vals.map(D)).toFixed(4);
export const sum = (vals: Numeric[]): DecimalString => add(...(vals.length ? vals : [0]));

export const cmp = (a: Numeric, b: Numeric): -1 | 0 | 1 => D(a).cmp(D(b)) as -1 | 0 | 1;
export const eq = (a: Numeric, b: Numeric): boolean => D(a).eq(D(b));
export const gt = (a: Numeric, b: Numeric): boolean => D(a).gt(D(b));
export const gte = (a: Numeric, b: Numeric): boolean => D(a).gte(D(b));
export const lt = (a: Numeric, b: Numeric): boolean => D(a).lt(D(b));
export const lte = (a: Numeric, b: Numeric): boolean => D(a).lte(D(b));
export const isZero = (a: Numeric): boolean => D(a).isZero();
export const isNeg = (a: Numeric): boolean => D(a).isNegative() && !D(a).isZero();
export const isPos = (a: Numeric): boolean => D(a).isPositive() && !D(a).isZero();

/** |a - b| <= tolerance */
export const within = (a: Numeric, b: Numeric, tolerance: Numeric = "0.005"): boolean =>
  D(a).minus(D(b)).abs().lte(D(tolerance));

/** Ratio as a JS number (for display / thresholds only — never stored as money). */
export const ratio = (num: Numeric, den: Numeric): number | null => {
  const d = D(den);
  if (d.isZero()) return null;
  return D(num).div(d).toNumber();
};

export const toNumber = (v: Numeric): number => D(v).toNumber();

export const M = (amount: Numeric, currency: CurrencyCode = "USD"): Money => ({ amount: money(amount), currency });

export function fmtMoney(v: Numeric | null | undefined, currency: CurrencyCode = "USD", opts?: { compact?: boolean }): string {
  if (v === null || v === undefined) return "—";
  const d = D(v);
  const n = d.toDecimalPlaces(2).toNumber();
  if (opts?.compact && Math.abs(n) >= 1000) {
    const abs = Math.abs(n);
    const unit = abs >= 1_000_000 ? "M" : "K";
    const scaled = abs >= 1_000_000 ? abs / 1_000_000 : abs / 1000;
    return `${n < 0 ? "-" : ""}${currencySymbol(currency)}${scaled.toFixed(1)}${unit}`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency === "CNY" ? "CNY" : currency === "USD" ? "USD" : "USD", currencyDisplay: "narrowSymbol" }).format(n);
}

export function fmtPercent(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

function currencySymbol(c: CurrencyCode): string {
  switch (c) {
    case "USD":
      return "$";
    case "CNY":
      return "¥";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    default:
      return `${c} `;
  }
}

/** Allocate a total across weights with no rounding leakage (largest remainder). */
export function allocate(total: Numeric, weights: Numeric[], dp = 2): DecimalString[] {
  const t = D(total);
  const ws = weights.map(D);
  const wsum = ws.reduce((a, b) => a.plus(b), new Decimal(0));
  if (wsum.isZero()) return weights.map(() => money(0));
  const raw = ws.map((w) => t.times(w).div(wsum));
  const floored = raw.map((r) => r.toDecimalPlaces(dp, Decimal.ROUND_DOWN));
  let remainder = t.minus(floored.reduce((a, b) => a.plus(b), new Decimal(0)));
  const unit = new Decimal(1).div(new Decimal(10).pow(dp));
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floored[i]) }))
    .sort((a, b) => b.frac.cmp(a.frac));
  const out = [...floored];
  let k = 0;
  while (remainder.abs().gte(unit) && k < order.length * 2) {
    const idx = order[k % order.length].i;
    out[idx] = out[idx].plus(remainder.isNegative() ? unit.neg() : unit);
    remainder = remainder.minus(remainder.isNegative() ? unit.neg() : unit);
    k++;
  }
  return out.map((o) => o.toFixed(4));
}
