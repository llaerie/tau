/**
 * Cross-border worker review checklist. Every non-US worker carries these fields with
 * `value: null` until counsel / the CPA confirms them. Shared by the synthetic generator and
 * the real company workspace so the two never drift apart.
 */
import type { ConfigField, InternationalWorkerReview, Role } from "@/lib/core/types";

export const INTERNATIONAL_REVIEW_SECTION = "international_worker";

export const CN_REVIEW_FIELDS: readonly { key: string; label: string }[] = Object.freeze([
  { key: "employment_status", label: "Employment vs. contractor status" },
  { key: "employing_entity", label: "Employing / contracting entity" },
  { key: "work_location", label: "Work location" },
  { key: "citizenship_residency", label: "Citizenship and tax residency" },
  { key: "payment_method", label: "Payment method" },
  { key: "contract", label: "Written contract on file" },
  { key: "local_payroll_arrangement", label: "Local payroll / employer-of-record arrangement" },
  { key: "benefits", label: "Benefits and social insurance obligations" },
  { key: "withholding_responsibilities", label: "Withholding responsibilities (US and local)" },
  { key: "currency", label: "Contract and payment currency" },
  { key: "tax_documentation", label: "Tax documentation (W-8BEN / local forms)" },
  { key: "permanent_establishment_concern", label: "Permanent-establishment concern" },
  { key: "labor_law_review_status", label: "Local labor-law review status" },
]);

/** All checklist fields for one worker, every value null (unknown), PROFESSIONAL_REVIEW_REQUIRED. */
export function internationalReviewFields(workerKey: string, opts: { synthetic: boolean; reviewer?: Role } = { synthetic: false }): ConfigField[] {
  const reviewer: Role = opts.reviewer ?? "ATTORNEY";
  return CN_REVIEW_FIELDS.map((f) => ({
    key: `worker.${workerKey}.${f.key}`,
    section: INTERNATIONAL_REVIEW_SECTION,
    label: f.label,
    value: null,
    status: "PROFESSIONAL_REVIEW_REQUIRED",
    requiredConfirmer: reviewer,
    note: "Unknown. Cross-border worker facts must be confirmed by counsel before any classification or filing.",
    synthetic: opts.synthetic,
  }));
}

export function incompleteInternationalReview(workerKey: string, opts: { synthetic: boolean; reviewer?: Role; notes?: string[] } = { synthetic: false }): InternationalWorkerReview {
  return {
    status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED",
    fields: internationalReviewFields(workerKey, opts),
    reviewerRole: opts.reviewer ?? "ATTORNEY",
    notes: opts.notes ?? ["Employment vs. contractor status is unresolved; no classification may be made without professional review.", "No W-9 / W-8 documentation on file."],
  };
}
