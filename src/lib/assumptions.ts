import { z } from "zod";

/**
 * Editable workspace assumptions. Every monetary field is `number | null`
 * where null means "unknown" and is presented as such — never as zero.
 */

export const allocationKindSchema = z.enum(["business", "employees_w2", "employees_unresolved", "contractors", "household", "mixed"]);
export type AllocationKind = z.infer<typeof allocationKindSchema>;

export const ALLOCATION_KIND_LABELS: Record<AllocationKind, string> = {
  business: "Business tools, software and equipment (operating expense)",
  employees_w2: "Employee W-2 gross wages (employer payroll costs apply)",
  employees_unresolved: "Employees, payroll classification unresolved",
  contractors: "Contractor payments (no employer payroll costs)",
  household: "Paid to the household (an owner distribution, not a business expense)",
  mixed: "Business and household mixed; split not entered yet",
};

export const allocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  amountCents: z.number().int().nullable(),
  kind: allocationKindSchema,
  note: z.string().max(300).optional(),
});
export type Allocation = z.infer<typeof allocationSchema>;

export const withholdingSchema = z.object({
  /** Employee Social Security + Medicare, percent of gross. 7.65% is the statutory rate. Null = unknown. */
  ficaRatePct: z.number().min(0).max(100).nullable(),
  /** Federal + state income tax withheld per month, best estimate. Null = unknown. */
  incomeTaxCents: z.number().int().nullable(),
  /** Optional range around the estimate, shown as a caveat. */
  incomeTaxLowCents: z.number().int().nullable(),
  incomeTaxHighCents: z.number().int().nullable(),
});
export type Withholding = z.infer<typeof withholdingSchema>;

export const ownerAssumptionsSchema = z.object({
  grossSalaryCents: z.number().int().nullable(),
  withholding: withholdingSchema,
  otherNetIncomeCents: z.number().int().nullable(),
  householdContributionCents: z.number().int().nullable(),
});
export type OwnerAssumptions = z.infer<typeof ownerAssumptionsSchema>;

export const assumptionsSchema = z.object({
  version: z.literal(2),
  company: z.object({
    anticipatedRevenueCents: z.number().int().nullable(),
    revenueBasis: z.enum(["anticipated", "contracted"]),
    allocations: z.array(allocationSchema).max(20),
    employerPayrollCostRatePct: z.number().min(0).max(100).nullable(),
    incomeTaxReserveRatePct: z.number().min(0).max(100).nullable(),
    otherOverheadCents: z.number().int().nullable(),
    cashReserveTargetMonths: z.number().min(0).max(36).nullable(),
  }),
  owners: z.record(z.string(), ownerAssumptionsSchema),
  household: z.object({
    plannedCompanyDistributionCents: z.number().int().nullable(),
  }),
  notes: z.string().max(4000),
  onboardingCompleted: z.boolean(),
});

export type WorkspaceAssumptions = z.infer<typeof assumptionsSchema>;

/** The standard employee FICA rate (Social Security 6.2% + Medicare 1.45%). */
export const FICA_EMPLOYEE_RATE_PCT = 7.65;

export function defaultOwnerAssumptions(): OwnerAssumptions {
  return {
    grossSalaryCents: 300000,
    withholding: { ficaRatePct: FICA_EMPLOYEE_RATE_PCT, incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000 },
    otherNetIncomeCents: 0,
    householdContributionCents: 0,
  };
}

/**
 * Defaults follow the stated plan: $30k anticipated revenue, an $8k monthly
 * operating allocation for tools, equipment and apartment furnishing whose
 * business/household split is not yet entered, $3k gross W-2 salaries for
 * each owner with FICA plus an income-tax estimate, and the household funded
 * by company distributions. Everything else stays unknown until entered.
 */
export function defaultAssumptions(personIds: string[]): WorkspaceAssumptions {
  const owners: Record<string, OwnerAssumptions> = {};
  for (const id of personIds) owners[id] = defaultOwnerAssumptions();
  return {
    version: 2,
    company: {
      anticipatedRevenueCents: 3000000,
      revenueBasis: "anticipated",
      allocations: [
        {
          id: "operating",
          name: "Tools, equipment & apartment furnishing",
          amountCents: 800000,
          kind: "mixed",
          note: "Claude Max, ChatGPT Pro, a 2026 Mac mini, and furniture for the new apartment. Split the business and household parts into two lines when known.",
        },
      ],
      employerPayrollCostRatePct: null,
      incomeTaxReserveRatePct: null,
      otherOverheadCents: null,
      cashReserveTargetMonths: null,
    },
    owners,
    household: { plannedCompanyDistributionCents: null },
    notes: "",
    onboardingCompleted: false,
  };
}

/** Accepts stored JSON from any version; unknown or older shapes fall back to defaults per field. */
export function parseAssumptions(json: string, personIds: string[]): WorkspaceAssumptions {
  let raw: unknown = {};
  try {
    raw = JSON.parse(json);
  } catch {
    raw = {};
  }
  const parsed = assumptionsSchema.safeParse(raw);
  const base = parsed.success ? parsed.data : migrateLegacy(raw, personIds);
  for (const id of personIds) {
    if (!base.owners[id]) base.owners[id] = defaultOwnerAssumptions();
  }
  return base;
}

function migrateLegacy(raw: unknown, personIds: string[]): WorkspaceAssumptions {
  const d = defaultAssumptions(personIds);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const c = (r.company ?? {}) as Record<string, unknown>;
  if (typeof c.anticipatedRevenueCents === "number" || c.anticipatedRevenueCents === null) d.company.anticipatedRevenueCents = c.anticipatedRevenueCents as number | null;
  if (c.revenueBasis === "contracted") d.company.revenueBasis = "contracted";
  if (typeof c.employeeAllocationCents === "number") {
    d.company.allocations = [{ id: "employees", name: "Employee allocation", amountCents: c.employeeAllocationCents, kind: c.employeeClassification === "contractor" ? "contractors" : c.employeeClassification === "w2_gross" ? "employees_w2" : "employees_unresolved" }];
  }
  for (const k of ["employerPayrollCostRatePct", "incomeTaxReserveRatePct", "otherOverheadCents", "cashReserveTargetMonths"] as const) {
    if (typeof c[k] === "number" || c[k] === null) d.company[k] = c[k] as number | null;
  }
  const owners = (r.owners ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, o] of Object.entries(owners)) {
    const base = defaultOwnerAssumptions();
    if (typeof o.grossSalaryCents === "number" || o.grossSalaryCents === null) base.grossSalaryCents = o.grossSalaryCents as number | null;
    if (typeof o.withholdingRatePct === "number" && typeof base.grossSalaryCents === "number") {
      // Old single-rate model: keep the total as an income-tax estimate with FICA folded in.
      base.withholding = { ficaRatePct: 0, incomeTaxCents: Math.round((base.grossSalaryCents * o.withholdingRatePct) / 100), incomeTaxLowCents: null, incomeTaxHighCents: null };
    } else if (o.withholdingRatePct === null) {
      base.withholding = { ficaRatePct: null, incomeTaxCents: null, incomeTaxLowCents: null, incomeTaxHighCents: null };
    }
    if (typeof o.otherNetIncomeCents === "number" || o.otherNetIncomeCents === null) base.otherNetIncomeCents = o.otherNetIncomeCents as number | null;
    if (typeof o.householdContributionCents === "number" || o.householdContributionCents === null) base.householdContributionCents = o.householdContributionCents as number | null;
    d.owners[id] = base;
  }
  const h = (r.household ?? {}) as Record<string, unknown>;
  if (typeof h.plannedCompanyDistributionCents === "number" || h.plannedCompanyDistributionCents === null) d.household.plannedCompanyDistributionCents = h.plannedCompanyDistributionCents as number | null;
  if (typeof r.notes === "string") d.notes = r.notes;
  if (typeof r.onboardingCompleted === "boolean") d.onboardingCompleted = r.onboardingCompleted;
  return d;
}

/** Human list of what is still unresolved, used by the overview and the assistant. */
export function unresolvedAssumptions(a: WorkspaceAssumptions, personNames: Record<string, string>): { key: string; label: string; where: string }[] {
  const out: { key: string; label: string; where: string }[] = [];
  const c = a.company;
  if (c.anticipatedRevenueCents === null) out.push({ key: "revenue", label: "Monthly service revenue", where: "Settings → Company" });
  for (const al of c.allocations) {
    if (al.amountCents === null) out.push({ key: `alloc-${al.id}-amount`, label: `${al.name}: amount`, where: "Settings → Company → Allocations" });
    if (al.kind === "mixed") out.push({ key: `alloc-${al.id}-split`, label: `${al.name}: business vs household split`, where: "Settings → Company → Allocations" });
    if (al.kind === "employees_unresolved") out.push({ key: `alloc-${al.id}-class`, label: `${al.name}: payroll classification`, where: "Settings → Company → Allocations" });
  }
  if (c.employerPayrollCostRatePct === null) out.push({ key: "employer-rate", label: "Employer payroll cost rate", where: "Settings → Company" });
  if (c.incomeTaxReserveRatePct === null) out.push({ key: "tax-rate", label: "Business income tax reserve rate", where: "Settings → Company" });
  if (c.otherOverheadCents === null) out.push({ key: "overhead", label: "Other business overhead", where: "Settings → Company" });
  for (const [pid, o] of Object.entries(a.owners)) {
    const name = personNames[pid] ?? pid;
    if (o.grossSalaryCents === null) out.push({ key: `${pid}-gross`, label: `${name}'s gross salary`, where: "Settings → People" });
    if (o.withholding.ficaRatePct === null) out.push({ key: `${pid}-fica`, label: `${name}'s FICA rate`, where: "Settings → People" });
    if (o.withholding.incomeTaxCents === null) out.push({ key: `${pid}-withholding`, label: `${name}'s income-tax withholding estimate`, where: "Settings → People" });
    if (o.householdContributionCents === null) out.push({ key: `${pid}-contribution`, label: `${name}'s household contribution`, where: "Settings → Household" });
  }
  if (a.household.plannedCompanyDistributionCents === null) out.push({ key: "distribution", label: "Planned monthly company distribution to the household", where: "Settings → Household" });
  return out;
}

export const ALLOCATION_KIND_OPTIONS: { value: AllocationKind; label: string }[] = (Object.keys(ALLOCATION_KIND_LABELS) as AllocationKind[]).map((value) => ({ value, label: ALLOCATION_KIND_LABELS[value] }));
