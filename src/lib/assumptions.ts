import { z } from "zod";
import { PAYROLL_RULES_2026 } from "./finance/payroll";

/**
 * Editable workspace assumptions, version 3. Every monetary field is
 * `number | null` where null means "unknown" and is never treated as zero.
 * Superseded values are kept in `superseded` with dates and reasons.
 */

export const withholdingSchema = z.object({
  incomeTaxCents: z.number().int().nullable(),
  incomeTaxLowCents: z.number().int().nullable(),
  incomeTaxHighCents: z.number().int().nullable(),
  source: z.enum(["none", "estimate", "paystub", "provider"]),
});

export const personalAllocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  monthlyCents: z.number().int().nonnegative(),
  kind: z.enum(["savings", "investment", "spending"]),
});

export const ownerAssumptionsSchema = z.object({
  grossSalaryCents: z.number().int().nullable(),
  withholding: withholdingSchema,
  otherNetIncomeCents: z.number().int().nullable(),
  householdContributionCents: z.number().int().nullable(),
  /** Monthly food target, funded from take-home. Null until the person sets it. */
  foodTargetCents: z.number().int().nullable(),
  /** Optional personal allocations after food (savings, investment, shopping, friends...). */
  allocations: z.array(personalAllocationSchema).max(30),
});

export const supersededSchema = z.object({
  key: z.string(),
  label: z.string(),
  previousValue: z.string(),
  supersededAt: z.string(),
  reason: z.string(),
});

export const assumptionsSchema = z.object({
  version: z.literal(3),
  company: z.object({
    entity: z.object({
      reportedTaxStatus: z.enum(["s_corp", "c_corp", "llc_default", "unknown"]),
      state: z.string().max(40),
      verified: z.boolean(),
      note: z.string().max(400),
    }),
    anticipatedRevenueCents: z.number().int().nullable(),
    revenueBasis: z.enum(["anticipated", "contracted"]),
    payer: z.object({ relationship: z.enum(["related_party", "third_party", "unknown"]), description: z.string().max(300) }),
    employerPayrollCostRatePct: z.number().min(0).max(100).nullable(),
    taxes: z.object({
      reserveRatePct: z.number().min(0).max(100).nullable(),
      reserveSource: z.string().max(200).nullable(),
      reserveYear: z.number().int().nullable(),
      reviewStatus: z.enum(["unreviewed", "cpa_reviewed"]),
      caEntityRule: z.object({ ratePct: z.number(), minimumAnnualCents: z.number().int(), applicabilityReviewed: z.boolean(), source: z.string() }),
      note: z.string().max(600),
    }),
    otherOverheadCents: z.number().int().nullable(),
    cashReserveTargetMonths: z.number().min(0).max(36).nullable(),
  }),
  payrollRules: z.object({ ficaEmployeePct: z.number().nullable(), sdiPct: z.number().nullable(), effectiveYear: z.number().int(), source: z.string() }),
  owners: z.record(z.string(), ownerAssumptionsSchema),
  household: z.object({ plannedCompanyDistributionCents: z.number().int().nullable() }),
  superseded: z.array(supersededSchema).max(100),
  notes: z.string().max(4000),
  onboardingCompleted: z.boolean(),
});

export type WorkspaceAssumptions = z.infer<typeof assumptionsSchema>;
export type OwnerAssumptions = z.infer<typeof ownerAssumptionsSchema>;
export type PersonalAllocation = z.infer<typeof personalAllocationSchema>;
export type Superseded = z.infer<typeof supersededSchema>;

export function defaultOwnerAssumptions(): OwnerAssumptions {
  return {
    grossSalaryCents: 300000,
    withholding: { incomeTaxCents: null, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "none" },
    otherNetIncomeCents: 0,
    householdContributionCents: 0,
    foodTargetCents: null,
    allocations: [],
  };
}

/**
 * Owner-stated planning facts as of 2026-09-11: $30k anticipated related-party
 * service receipts, two $3k gross salaries, no other employees, company-paid
 * rent and cars recorded as bills elsewhere. Taxes, employer costs, overhead
 * and food targets stay unknown until entered.
 */
export function defaultAssumptions(personIds: string[]): WorkspaceAssumptions {
  const owners: Record<string, OwnerAssumptions> = {};
  for (const id of personIds) owners[id] = defaultOwnerAssumptions();
  return {
    version: 3,
    company: {
      entity: { reportedTaxStatus: "s_corp", state: "California", verified: false, note: "Owner reports a California LLC taxed as an S corporation. Election documentation not uploaded." },
      anticipatedRevenueCents: 3000000,
      revenueBasis: "anticipated",
      payer: { relationship: "related_party", description: "Service payment from Will's father or an associated payer, for actual company services. Customer name, contract, invoices and dates unconfirmed." },
      employerPayrollCostRatePct: null,
      taxes: {
        reserveRatePct: null,
        reserveSource: null,
        reserveYear: null,
        reviewStatus: "unreviewed",
        caEntityRule: { ratePct: 1.5, minimumAnnualCents: 80000, applicabilityReviewed: false, source: "California FTB S-corporation guidance" },
        note: "No flat tax figure. Federal S-corp income generally passes through to the shareholder; California levies 1.5% of taxable net income with an $800 minimum, subject to applicability. Needs CPA review.",
      },
      otherOverheadCents: null,
      cashReserveTargetMonths: null,
    },
    payrollRules: { ...PAYROLL_RULES_2026 },
    owners,
    household: { plannedCompanyDistributionCents: null },
    superseded: [],
    notes: "",
    onboardingCompleted: false,
  };
}

/** Accepts stored JSON from any version; older shapes migrate field by field and the old values are archived in `superseded`. */
export function parseAssumptions(json: string, personIds: string[]): WorkspaceAssumptions {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json);
  } catch {
    raw = {};
  }
  const parsed = assumptionsSchema.safeParse(raw);
  const base = parsed.success ? parsed.data : migrateLegacy(raw, personIds);
  for (const id of personIds) if (!base.owners[id]) base.owners[id] = defaultOwnerAssumptions();
  return base;
}

function migrateLegacy(raw: unknown, personIds: string[]): WorkspaceAssumptions {
  const d = defaultAssumptions(personIds);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const c = (r.company ?? {}) as Record<string, unknown>;
  if (typeof c.anticipatedRevenueCents === "number" || c.anticipatedRevenueCents === null) d.company.anticipatedRevenueCents = c.anticipatedRevenueCents as number | null;
  if (c.revenueBasis === "contracted") d.company.revenueBasis = "contracted";
  if (typeof c.employerPayrollCostRatePct === "number") d.company.employerPayrollCostRatePct = c.employerPayrollCostRatePct;
  if (typeof c.otherOverheadCents === "number") d.company.otherOverheadCents = c.otherOverheadCents;
  if (typeof c.cashReserveTargetMonths === "number") d.company.cashReserveTargetMonths = c.cashReserveTargetMonths;
  if (typeof c.incomeTaxReserveRatePct === "number") {
    d.superseded.push({ key: "company.incomeTaxReserveRatePct", label: "Income tax reserve rate", previousValue: `${c.incomeTaxReserveRatePct}%`, supersededAt: now, reason: "Replaced by tax rules that need a source, year and CPA review." });
  }
  if (typeof c.employeeAllocationCents === "number") {
    d.superseded.push({ key: "company.employeeAllocationCents", label: "Employee allocation", previousValue: `$${(c.employeeAllocationCents / 100).toLocaleString()}/month (${String(c.employeeClassification ?? "unresolved")})`, supersededAt: now, reason: "No other employees are in the forward payroll plan." });
  }
  if (Array.isArray(c.allocations)) {
    for (const a of c.allocations as Record<string, unknown>[]) {
      d.superseded.push({ key: `company.allocation.${String(a.id)}`, label: String(a.name ?? "Allocation"), previousValue: typeof a.amountCents === "number" ? `$${(a.amountCents / 100).toLocaleString()}/month (${String(a.kind)})` : "unknown", supersededAt: now, reason: "Retired placeholder; replaced by itemized subscriptions, API usage and one-time purchase plans." });
    }
  }
  const owners = (r.owners ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, o] of Object.entries(owners)) {
    const base = defaultOwnerAssumptions();
    if (typeof o.grossSalaryCents === "number" || o.grossSalaryCents === null) base.grossSalaryCents = o.grossSalaryCents as number | null;
    const w = (o.withholding ?? null) as Record<string, unknown> | null;
    if (w && (typeof w.incomeTaxCents === "number" || w.incomeTaxCents === null)) {
      base.withholding = { incomeTaxCents: w.incomeTaxCents as number | null, incomeTaxLowCents: (w.incomeTaxLowCents as number | null) ?? null, incomeTaxHighCents: (w.incomeTaxHighCents as number | null) ?? null, source: w.incomeTaxCents === null ? "none" : "estimate" };
    } else if (typeof o.withholdingRatePct === "number" && typeof base.grossSalaryCents === "number") {
      base.withholding = { incomeTaxCents: Math.max(0, Math.round((base.grossSalaryCents * o.withholdingRatePct) / 100) - Math.round(base.grossSalaryCents * 0.0765)), incomeTaxLowCents: null, incomeTaxHighCents: null, source: "estimate" };
    }
    if (typeof o.otherNetIncomeCents === "number" || o.otherNetIncomeCents === null) base.otherNetIncomeCents = o.otherNetIncomeCents as number | null;
    if (typeof o.householdContributionCents === "number" || o.householdContributionCents === null) base.householdContributionCents = o.householdContributionCents as number | null;
    d.owners[id] = base;
  }
  const h = (r.household ?? {}) as Record<string, unknown>;
  if (typeof h.plannedCompanyDistributionCents === "number") d.household.plannedCompanyDistributionCents = h.plannedCompanyDistributionCents;
  if (typeof r.notes === "string") d.notes = r.notes;
  if (typeof r.onboardingCompleted === "boolean") d.onboardingCompleted = r.onboardingCompleted;
  return d;
}

export interface ReviewItem {
  key: string;
  label: string;
  /** What is blocked while this stays unknown. */
  blocks: string;
  where: string;
  severity: "info" | "attention";
  action?: { kind: "set-food-target" | "confirm-withholding" | "open-settings" | "open-subscriptions" | "open-plans"; personId?: string };
}

/** Dependency-aware setup/review queue. Ordered by consequence, not by field order. */
export function reviewItems(a: WorkspaceAssumptions, viewer: { personId: string | null; personNames: Record<string, string>; visiblePersonIds: string[]; canSeeCompany: boolean }): ReviewItem[] {
  const out: ReviewItem[] = [];
  if (viewer.personId) {
    const o = a.owners[viewer.personId];
    if (o && o.foodTargetCents === null) out.push({ key: "food-target", label: "Set your food target", blocks: "Food budget answers stay approximate without it.", where: "Money → My money", severity: "attention", action: { kind: "set-food-target", personId: viewer.personId } });
    if (o && o.withholding.source === "none") out.push({ key: "withholding", label: "Confirm your payroll withholding", blocks: "Take-home is incomplete, so an exact available-to-spend figure cannot be given.", where: "Settings → Payroll", severity: "attention", action: { kind: "confirm-withholding", personId: viewer.personId } });
    else if (o && o.withholding.source === "estimate") out.push({ key: "withholding-estimate", label: "Take-home is an estimate", blocks: "Pay stub or payroll-provider figures would make it verified.", where: "Settings → Payroll", severity: "info", action: { kind: "confirm-withholding", personId: viewer.personId } });
  }
  if (viewer.canSeeCompany) {
    if (a.company.taxes.reviewStatus === "unreviewed") out.push({ key: "tax-reserve", label: "Tax reserve not set", blocks: "No unqualified distribution or affordability claim until taxes are reserved and reviewed.", where: "Settings → Tax", severity: "attention", action: { kind: "open-settings" } });
    if (a.company.employerPayrollCostRatePct === null) out.push({ key: "employer-costs", label: "Employer payroll costs unknown", blocks: "Company commitments are understated until payroll is set up.", where: "Settings → Payroll", severity: "info", action: { kind: "open-settings" } });
    if (a.company.otherOverheadCents === null) out.push({ key: "overhead", label: "Insurance, hosting and CPA costs unconfirmed", blocks: "The cash plan omits them.", where: "Settings → Company", severity: "info", action: { kind: "open-settings" } });
    if (!a.company.entity.verified) out.push({ key: "entity", label: "S-corporation election not verified", blocks: "Tax treatment assumptions rest on the owner's report.", where: "Documents", severity: "info" });
  }
  return out;
}
