/**
 * CalcResult construction helpers for the deterministic calculation engine.
 *
 * Every public calculation in lib/finance and lib/forecasting returns a
 * `CalcResult` built through `makeCalc()` so ids, fingerprints and the
 * "unknown is unknown" convention are applied uniformly:
 *
 *  - id          = deterministicId("calc", name, fingerprint(inputs))
 *  - fingerprint = fingerprint({ formula, inputs })
 *  - value null + note "INSUFFICIENT_INFORMATION: ..." + UNCONFIRMED assumption
 *    whenever a required input is unknown. Zero is never substituted.
 */
import type { Assumption, CalcResult, CalcUnit, DecimalString, ID, ISODate } from "@/lib/core/types";
import { deterministicId, fingerprint } from "@/lib/core/ids";
import { D, type Numeric } from "@/lib/core/money";

export const INSUFFICIENT = "INSUFFICIENT_INFORMATION";

/** Input that may be a decimal string, a number, or unknown (null/undefined). */
export type NumericInput = DecimalString | number | null | undefined;

export interface MakeCalcInput<T> {
  name: string;
  value: T;
  unit: CalcUnit;
  formula: string;
  inputs: Record<string, unknown>;
  asOfDate: ISODate;
  sourceIds?: ID[];
  assumptions?: Assumption[];
  notes?: string[];
}

export function makeCalc<T>(input: MakeCalcInput<T>): CalcResult<T> {
  const inputs = normalizeInputs(input.inputs);
  const fp = fingerprint({ formula: input.formula, inputs });
  return {
    id: deterministicId("calc", input.name, fingerprint(inputs)),
    name: input.name,
    value: input.value,
    unit: input.unit,
    formula: input.formula,
    inputs,
    sourceIds: uniq(input.sourceIds ?? []),
    assumptions: input.assumptions ?? [],
    asOfDate: input.asOfDate,
    notes: input.notes && input.notes.length ? input.notes : undefined,
    fingerprint: fp,
  };
}

/** Assumption describing an unknown input. */
export function unknownAssumption(key: string, description: string): Assumption {
  return { key, description, value: null, status: "UNCONFIRMED", requiresProfessionalReview: false };
}

export interface InsufficientInput {
  name: string;
  unit: CalcUnit;
  formula: string;
  inputs: Record<string, unknown>;
  asOfDate: ISODate;
  /** Human-readable list of what is missing, e.g. ["minimum cash reserve policy"] */
  missing: string[];
  sourceIds?: ID[];
  assumptions?: Assumption[];
  notes?: string[];
}

/** Build a null-valued CalcResult that says exactly what information is missing. */
export function insufficient(input: InsufficientInput): CalcResult<null> {
  const missingAssumptions = input.missing.map((m) => unknownAssumption(`missing:${slug(m)}`, `Unknown input: ${m}`));
  return makeCalc<null>({
    name: input.name,
    value: null,
    unit: input.unit,
    formula: input.formula,
    inputs: input.inputs,
    asOfDate: input.asOfDate,
    sourceIds: input.sourceIds,
    assumptions: [...missingAssumptions, ...(input.assumptions ?? [])],
    notes: [`${INSUFFICIENT}: ${input.missing.join("; ")}`, ...(input.notes ?? [])],
  });
}

export function isUnknown(v: NumericInput): v is null | undefined {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Return the names of unknown inputs among a labelled set. */
export function missingOf(fields: Record<string, NumericInput>): string[] {
  return Object.entries(fields)
    .filter(([, v]) => isUnknown(v))
    .map(([k]) => k);
}

/** Convert a known numeric input to a canonical 4-dp decimal string. */
export const dec = (v: Numeric): DecimalString => D(v).toFixed(4);

/** Ratio as a number, null when the denominator is zero. */
export function safeRatio(num: Numeric, den: Numeric): number | null {
  const d = D(den);
  if (d.isZero()) return null;
  return D(num).div(d).toNumber();
}

/** Round a JS number for stable presentation (ratios/percents only — never money). */
export function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Normalize inputs so fingerprints are stable across DecimalString/number/Decimal inputs. */
function normalizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) out[k] = normalizeValue(v);
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === "object") {
    // decimal.js instances → string
    const maybe = v as { toFixed?: (dp: number) => string; constructor?: { name?: string } };
    if (typeof maybe.toFixed === "function" && maybe.constructor?.name === "Decimal") return maybe.toFixed(4);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = normalizeValue(x);
    return out;
  }
  return String(v);
}

function uniq(ids: ID[]): ID[] {
  return Array.from(new Set(ids));
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
