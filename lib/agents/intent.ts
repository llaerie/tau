/**
 * Deterministic natural-language intent helpers: entity extraction (amounts, dates, months,
 * account codes, percentages, "13-week", ids) and a tiny rule-based router used by every
 * specialist. No model call is involved; the same message always yields the same result.
 */
import { isValidISODate, monthEnd } from "@/lib/core/dates";
import { money } from "@/lib/core/money";
import type { DecimalString, ISODate } from "@/lib/core/types";
import type { TaskKind } from "./task-catalog";
import type { RouterResult } from "./types";

export interface ExtractedEntities {
  /** Money amounts in order of appearance, canonical 4dp strings (no sign). */
  amounts: DecimalString[];
  /** Percentages as ratios (12% -> 0.12). */
  percents: number[];
  /** Bare numbers (not part of an amount or percent), in order of appearance. */
  numbers: number[];
  /** ISO dates found or parsed from "March 15, 2026" / "3/15/2026". */
  dates: ISODate[];
  /** YYYY-MM months from "March 2026", "2026-03", "last December" (relative to asOf). */
  months: string[];
  years: number[];
  /** 4-digit chart-of-accounts codes mentioned explicitly (1000..9999). */
  accountCodes: string[];
  /** Tokens that look like record ids (prefix_hex). */
  ids: string[];
  thirteenWeek: boolean;
  /** Integer "N months"/"N weeks"/"N days" durations. */
  durations: { value: number; unit: "DAY" | "WEEK" | "MONTH" | "YEAR" }[];
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  const i = MONTH_NAMES.indexOf(w);
  if (i >= 0) return i;
  return MONTH_SHORT.indexOf(w.slice(0, 3));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function extractEntities(message: string, asOf: ISODate = "2026-09-09"): ExtractedEntities {
  const text = message ?? "";
  const out: ExtractedEntities = { amounts: [], percents: [], numbers: [], dates: [], months: [], years: [], accountCodes: [], ids: [], thirteenWeek: false, durations: [] };
  const consumed: [number, number][] = [];
  const mark = (m: RegExpMatchArray) => {
    if (m.index !== undefined) consumed.push([m.index, m.index + m[0].length]);
  };
  const isConsumed = (idx: number) => consumed.some(([a, b]) => idx >= a && idx < b);

  out.thirteenWeek = /\b(13|thirteen)[\s-]*week/i.test(text);

  // Record ids: prefix_hex16 or prefix_word (je_..., tx_..., inv_...)
  for (const m of text.matchAll(/\b([a-z]{2,10})_([A-Za-z0-9_-]{3,})\b/g)) {
    out.ids.push(m[0]);
    mark(m);
  }
  // ISO dates
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (isValidISODate(m[0])) out.dates.push(m[0]);
    mark(m);
  }
  // US dates 3/15/2026
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const d = `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
    if (isValidISODate(d)) out.dates.push(d);
    mark(m);
  }
  // "March 15, 2026" / "March 15 2026" / "15 March 2026"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mi = monthIndex(m[1]);
    if (mi < 0) continue;
    const d = `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
    if (isValidISODate(d)) out.dates.push(d);
    mark(m);
  }
  // YYYY-MM months
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})\b(?!-\d)/g)) {
    if (Number(m[2]) >= 1 && Number(m[2]) <= 12) out.months.push(`${m[1]}-${m[2]}`);
    mark(m);
  }
  // "March 2026"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const mi = monthIndex(m[1]);
    if (mi < 0) continue;
    out.months.push(`${m[2]}-${pad(mi + 1)}`);
    mark(m);
  }
  // Relative months: "last December", "this month", "last month"
  const asOfYear = Number(asOf.slice(0, 4));
  const asOfMonth = Number(asOf.slice(5, 7));
  for (const m of text.matchAll(/\b(last|this|next)\s+([A-Za-z]{3,9})\b/g)) {
    const mi = monthIndex(m[2]);
    if (mi >= 0) {
      let year = asOfYear;
      if (m[1] === "last" && mi + 1 >= asOfMonth) year -= 1;
      if (m[1] === "next" && mi + 1 <= asOfMonth) year += 1;
      out.months.push(`${year}-${pad(mi + 1)}`);
    } else if (m[2].toLowerCase() === "month") {
      let y = asOfYear;
      let mo = asOfMonth + (m[1] === "last" ? -1 : m[1] === "next" ? 1 : 0);
      if (mo < 1) {
        mo = 12;
        y -= 1;
      }
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
      out.months.push(`${y}-${pad(mo)}`);
    } else if (m[2].toLowerCase() === "year") {
      out.years.push(asOfYear + (m[1] === "last" ? -1 : m[1] === "next" ? 1 : 0));
    }
  }
  // Percentages
  for (const m of text.matchAll(/(-?\d+(?:\.\d+)?)\s?(%|percent\b)/gi)) {
    out.percents.push(Number(m[1]) / 100);
    mark(m);
  }
  // Amounts: $1,234.56 | 1,234.56 dollars | $3k | 12k
  for (const m of text.matchAll(/(?:\$|usd\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|m)?\b|\b(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|m)?\s?(?:dollars|usd|bucks)\b/gi)) {
    const whole = (m[1] ?? m[4] ?? "").replace(/,/g, "");
    const frac = m[2] ?? m[5] ?? "";
    const suffix = (m[3] ?? m[6] ?? "").toLowerCase();
    let n = Number(`${whole}${frac}`);
    if (suffix === "k") n *= 1000;
    if (suffix === "m") n *= 1_000_000;
    if (Number.isFinite(n)) out.amounts.push(money(n));
    mark(m);
  }
  // Durations
  for (const m of text.matchAll(/\b(\d+)\s*-?\s*(day|week|month|year)s?\b/gi)) {
    out.durations.push({ value: Number(m[1]), unit: m[2].toUpperCase() as "DAY" | "WEEK" | "MONTH" | "YEAR" });
  }
  // Account codes (explicit 4-digit codes in the lab ranges)
  for (const m of text.matchAll(/\b([1-9]\d{3})\b/g)) {
    if (m.index === undefined || isConsumed(m.index)) continue;
    const n = Number(m[1]);
    if (n >= 2000 && n <= 2100 && /\b(19|20)\d{2}\b/.test(m[1]) && !/\b(account|acct|code|to|in)\s*$/i.test(text.slice(Math.max(0, m.index - 10), m.index))) {
      // year-like number; treat as a year unless prefixed by "account"
      out.years.push(n);
      continue;
    }
    if ((n >= 1000 && n <= 9999) && /^(1|2|3|4|5|6|7|9)/.test(m[1])) out.accountCodes.push(m[1]);
  }
  // Years (standalone 20xx not consumed)
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    if (m.index !== undefined && !isConsumed(m.index) && !out.years.includes(Number(m[1]))) out.years.push(Number(m[1]));
  }
  // Bare numbers not consumed by the above
  for (const m of text.matchAll(/(?<![\w.$-])(-?\d+(?:\.\d+)?)(?![\w%])/g)) {
    if (m.index === undefined || isConsumed(m.index)) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.numbers.push(n);
  }
  out.months = [...new Set(out.months)];
  out.years = [...new Set(out.years)];
  out.accountCodes = [...new Set(out.accountCodes)];
  return out;
}

/** First/last day helpers for month strings. */
export function monthRange(month: string): { from: ISODate; to: ISODate } {
  return { from: `${month}-01`, to: monthEnd(`${month}-01`) };
}

export function yearRange(year: number): { from: ISODate; to: ISODate } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// ---------------------------------------------------------------------------
// Rule-based router
// ---------------------------------------------------------------------------

export interface RouteRule {
  kind: TaskKind;
  /** All of these must match (AND). Each entry may be an alternation. */
  all?: RegExp[];
  /** At least one of these must match (OR). */
  any?: RegExp[];
  /** If any of these match the rule is skipped. */
  none?: RegExp[];
  /** Base weight; ties broken by number of matched patterns then order. */
  weight?: number;
  params?: (message: string, e: ExtractedEntities, asOf: ISODate) => Record<string, unknown>;
  name?: string;
}

export interface RouteMatch extends RouterResult {
  matched: number;
}

export function routeByRules(rules: RouteRule[], message: string, asOf: ISODate = "2026-09-09"): RouteMatch | null {
  const e = extractEntities(message, asOf);
  let best: RouteMatch | null = null;
  rules.forEach((rule, order) => {
    if (rule.none?.some((r) => r.test(message))) return;
    if (rule.all && !rule.all.every((r) => r.test(message))) return;
    const anyMatches = rule.any ? rule.any.filter((r) => r.test(message)).length : 0;
    if (rule.any && anyMatches === 0) return;
    const matched = (rule.all?.length ?? 0) + anyMatches;
    const score = (rule.weight ?? 1) + matched * 0.2;
    if (!best || score > best.confidence + 1e-9) {
      best = {
        kind: rule.kind,
        params: rule.params ? rule.params(message, e, asOf) : {},
        confidence: score,
        matched,
        rule: rule.name ?? `${rule.kind}#${order}`,
      };
    }
  });
  if (!best) return null;
  const b: RouteMatch = best;
  return { ...b, confidence: Math.min(1, 0.4 + b.confidence * 0.15) };
}

/** Fraction of keyword patterns present in the message (0..1), used for canHandle scoring. */
export function keywordScore(message: string, keywords: RegExp[]): number {
  if (!keywords.length) return 0;
  const hits = keywords.filter((k) => k.test(message)).length;
  return hits === 0 ? 0 : Math.min(1, 0.35 + (hits / keywords.length) * 0.65 + Math.min(hits, 3) * 0.1);
}

export function firstAmount(e: ExtractedEntities): DecimalString | undefined {
  return e.amounts[0];
}
