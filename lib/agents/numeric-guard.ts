/**
 * Numeric guard for model-written narrative: every number that appears in the narrative must
 * be present in the set of deterministic numbers (calc values, key figures, structured
 * values) within tolerance. Otherwise the narrative is rejected and the deterministic text
 * is kept. The model is never the calculator.
 */
import { D } from "@/lib/core/money";

export interface NumericGuardResult {
  ok: boolean;
  /** Numbers found in the narrative that have no deterministic counterpart. */
  unsupported: string[];
  /** Numbers found and matched. */
  supported: string[];
}

const NUMBER_RE = /-?\(?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?%?|-?\$?\s?\d+(?:\.\d+)?%?/g;

/** Extract numeric tokens from free text as JS numbers (percentages become ratios). */
export function extractNumbersFromText(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const isPct = raw.endsWith("%");
    const cleaned = raw.replace(/[$,()\s%]/g, "");
    if (!cleaned || cleaned === "-" ) continue;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) continue;
    out.push({ raw, value: isPct ? n / 100 : n });
    if (isPct) out.push({ raw, value: n });
  }
  return out;
}

/** Collect every finite number reachable in a structured value (strings that parse as decimals included). */
export function collectNumbers(value: unknown, acc: Set<number> = new Set(), depth = 0): Set<number> {
  if (depth > 8 || value === null || value === undefined) return acc;
  if (typeof value === "number") {
    if (Number.isFinite(value)) acc.add(value);
    return acc;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      try {
        acc.add(D(s).toNumber());
      } catch {
        /* not numeric */
      }
    } else if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) {
      // dates: allow year and day components to appear in prose
      for (const part of s.split("-")) acc.add(Number(part));
    }
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, acc, depth + 1);
    return acc;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, acc, depth + 1);
  }
  return acc;
}

function matches(n: number, allowed: Set<number>, absTol: number, relTol: number): boolean {
  for (const a of allowed) {
    const diff = Math.abs(a - n);
    if (diff <= absTol) return true;
    if (Math.abs(a) > 0 && diff / Math.abs(a) <= relTol) return true;
    // rounded display forms (e.g. 12,345.68 shown as 12,346 or 12.3k)
    if (Math.abs(Math.round(a) - n) <= absTol) return true;
    if (Math.abs(a) >= 1000 && Math.abs(a / 1000 - n) <= 0.05) return true;
    if (Math.abs(a) >= 1_000_000 && Math.abs(a / 1_000_000 - n) <= 0.05) return true;
    // ratios shown as percentages
    if (Math.abs(a) <= 1 && Math.abs(a * 100 - n) <= 0.05) return true;
  }
  return false;
}

export interface NumericGuardOptions {
  absTolerance?: number;
  relTolerance?: number;
  /** Small integers (0..12) are allowed by default: "3 months", "two of the five items". */
  allowSmallIntegersUpTo?: number;
}

/** Check that every number in `narrative` is supported by `allowed` (a set built with collectNumbers). */
export function checkNarrativeNumbers(narrative: string, allowed: Set<number>, opts: NumericGuardOptions = {}): NumericGuardResult {
  const absTol = opts.absTolerance ?? 0.006;
  const relTol = opts.relTolerance ?? 0.0015;
  const small = opts.allowSmallIntegersUpTo ?? 12;
  const unsupported: string[] = [];
  const supported: string[] = [];
  const seenRaw = new Map<string, boolean>();
  const found = extractNumbersFromText(narrative);
  // group alternatives (pct and ratio) by raw token: a token is supported if any alternative matches
  for (const f of found) {
    const prev = seenRaw.get(f.raw);
    const ok = (Number.isInteger(f.value) && Math.abs(f.value) <= small) || matches(f.value, allowed, absTol, relTol);
    seenRaw.set(f.raw, Boolean(prev) || ok);
  }
  for (const [raw, ok] of seenRaw) (ok ? supported : unsupported).push(raw);
  return { ok: unsupported.length === 0, unsupported, supported };
}
