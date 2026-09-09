/**
 * Tax workpapers — every tax figure is presented with FACT / CALCULATION / ASSUMPTION /
 * PROFESSIONAL JUDGMENT separated. CPA review is always required in Phase One.
 */
import type { HighRiskBreakdown } from "@/lib/core/contracts";
import type { Assumption, CalcResult, ISODateTime, Jurisdiction, TaxWorkpaper } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";

export interface WorkpaperFact {
  label: string;
  value: unknown;
  sourceIds: string[];
}

export interface BuildWorkpaperInput {
  title: string;
  taxYear: number;
  jurisdiction: Jurisdiction;
  obligationId?: string;
  facts: WorkpaperFact[];
  calculations: CalcResult[];
  assumptions: Assumption[];
  professionalJudgmentItems: string[];
  createdBy: string;
  createdAt?: ISODateTime;
  id?: string;
}

/**
 * Deterministic confidence: starts at 1, reduced for each unconfirmed/professional-review
 * assumption, unsourced fact, and calculation whose own assumptions are unconfirmed.
 * Never above 0.9 in Phase One (CPA review is always outstanding).
 */
export function workpaperConfidence(input: Pick<BuildWorkpaperInput, "facts" | "calculations" | "assumptions" | "professionalJudgmentItems">): number {
  let c = 0.9;
  for (const a of input.assumptions) {
    if (a.status === "PROFESSIONAL_REVIEW_REQUIRED") c -= 0.2;
    else if (a.status === "UNCONFIRMED") c -= 0.1;
  }
  for (const f of input.facts) if (!f.sourceIds.length) c -= 0.05;
  for (const calc of input.calculations) for (const a of calc.assumptions) if (a.status !== "CONFIRMED") c -= 0.05;
  c -= 0.05 * input.professionalJudgmentItems.length;
  return Math.max(0, Math.round(c * 100) / 100);
}

export function buildTaxWorkpaper(input: BuildWorkpaperInput): TaxWorkpaper {
  const createdAt = input.createdAt ?? nowISO();
  return {
    id: input.id ?? deterministicId("wp", input.title, input.taxYear, input.jurisdiction, createdAt),
    title: input.title,
    taxYear: input.taxYear,
    jurisdiction: input.jurisdiction,
    obligationId: input.obligationId,
    facts: input.facts.map((f) => ({ label: f.label, value: f.value, sourceIds: [...f.sourceIds] })),
    calculations: input.calculations.map((c) => c.id),
    assumptions: input.assumptions.map((a) => ({ ...a })),
    professionalJudgmentItems: [...input.professionalJudgmentItems],
    confidence: workpaperConfidence(input),
    cpaReviewRequired: true,
    cpaReviewStatus: "NOT_REQUESTED",
    createdAt,
    createdBy: input.createdBy,
  };
}

const fmt = (v: unknown): string => (v === null || v === undefined ? "UNKNOWN" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Render the four sections for an ExecutiveResponse.highRisk block. */
export function workpaperSections(wp: TaxWorkpaper, calcs: CalcResult[] = []): HighRiskBreakdown {
  const byId = new Map(calcs.map((c) => [c.id, c]));
  return {
    facts: wp.facts.map((f) => `${f.label}: ${fmt(f.value)}${f.sourceIds.length ? ` [sources: ${f.sourceIds.join(", ")}]` : " [NO SOURCE]"}`),
    calculations: wp.calculations.map((id) => {
      const c = byId.get(id);
      return c ? `${c.name} = ${fmt(c.value)} ${c.unit} (formula: ${c.formula})` : `calculation ${id}`;
    }),
    assumptions: wp.assumptions.map((a) => `${a.key} [${a.status}]: ${a.description} (value: ${fmt(a.value)})`),
    professionalJudgment: [...wp.professionalJudgmentItems, "CPA review required before any figure is relied upon or filed."],
  };
}

export function requestCpaReview(wp: TaxWorkpaper): TaxWorkpaper {
  return { ...wp, cpaReviewStatus: "REQUESTED" };
}

export function recordCpaReview(wp: TaxWorkpaper, outcome: "REVIEWED" | "REJECTED"): TaxWorkpaper {
  if (wp.cpaReviewStatus !== "REQUESTED") throw new Error(`Workpaper ${wp.id} review not requested`);
  return { ...wp, cpaReviewStatus: outcome };
}
