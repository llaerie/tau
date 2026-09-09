import { z } from "zod";
import type { EmployeeClassification } from "./finance/company";

/**
 * Editable workspace assumptions. Every monetary field is `number | null`
 * where null means "unknown" and is presented as such — never as zero.
 */
export const ownerAssumptionsSchema = z.object({
  grossSalaryCents: z.number().int().nullable(),
  withholdingRatePct: z.number().min(0).max(100).nullable(),
  otherNetIncomeCents: z.number().int().nullable(),
  householdContributionCents: z.number().int().nullable(),
});

export const assumptionsSchema = z.object({
  version: z.literal(1),
  company: z.object({
    anticipatedRevenueCents: z.number().int().nullable(),
    revenueBasis: z.enum(["anticipated", "contracted"]),
    employeeAllocationCents: z.number().int().nullable(),
    employeeClassification: z.enum(["unresolved", "w2_gross", "w2_gross_plus_employer_costs", "contractor"]),
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
export type OwnerAssumptions = z.infer<typeof ownerAssumptionsSchema>;

/**
 * Defaults reflect the request: $30k anticipated revenue, $8k employee
 * allocation with unresolved classification, $3k gross owner salaries, and
 * everything else unknown until someone enters it.
 */
export function defaultAssumptions(personIds: string[]): WorkspaceAssumptions {
  const owners: Record<string, OwnerAssumptions> = {};
  for (const id of personIds) {
    owners[id] = { grossSalaryCents: 300000, withholdingRatePct: null, otherNetIncomeCents: 0, householdContributionCents: null };
  }
  return {
    version: 1,
    company: {
      anticipatedRevenueCents: 3000000,
      revenueBasis: "anticipated",
      employeeAllocationCents: 800000,
      employeeClassification: "unresolved",
      employerPayrollCostRatePct: null,
      incomeTaxReserveRatePct: null,
      otherOverheadCents: null,
      cashReserveTargetMonths: null,
    },
    owners,
    household: { plannedCompanyDistributionCents: 0 },
    notes: "",
    onboardingCompleted: false,
  };
}

export function parseAssumptions(json: string, personIds: string[]): WorkspaceAssumptions {
  const parsed = assumptionsSchema.safeParse(JSON.parse(json));
  const base = parsed.success ? parsed.data : defaultAssumptions(personIds);
  for (const id of personIds) {
    if (!base.owners[id]) base.owners[id] = defaultAssumptions([id]).owners[id];
  }
  return base;
}

/** Human list of what is still unresolved, used by the overview and the assistant. */
export function unresolvedAssumptions(a: WorkspaceAssumptions, personNames: Record<string, string>): { key: string; label: string; where: string }[] {
  const out: { key: string; label: string; where: string }[] = [];
  const c = a.company;
  if (c.anticipatedRevenueCents === null) out.push({ key: "revenue", label: "Monthly service revenue", where: "Settings → Company" });
  if (c.employeeAllocationCents === null) out.push({ key: "employees", label: "Employee allocation", where: "Settings → Company" });
  if (c.employeeClassification === "unresolved") out.push({ key: "classification", label: "Employee allocation payroll classification", where: "Settings → Company" });
  if (c.employerPayrollCostRatePct === null) out.push({ key: "employer-rate", label: "Employer payroll cost rate", where: "Settings → Company" });
  if (c.incomeTaxReserveRatePct === null) out.push({ key: "tax-rate", label: "Business income tax reserve rate", where: "Settings → Company" });
  if (c.otherOverheadCents === null) out.push({ key: "overhead", label: "Other business overhead", where: "Settings → Company" });
  for (const [pid, o] of Object.entries(a.owners)) {
    const name = personNames[pid] ?? pid;
    if (o.grossSalaryCents === null) out.push({ key: `${pid}-gross`, label: `${name}'s gross salary`, where: "Settings → Owners" });
    if (o.withholdingRatePct === null) out.push({ key: `${pid}-withholding`, label: `${name}'s payroll withholding estimate`, where: "Settings → Owners" });
    if (o.householdContributionCents === null) out.push({ key: `${pid}-contribution`, label: `${name}'s household contribution`, where: "Settings → Household" });
  }
  if (a.household.plannedCompanyDistributionCents === null) out.push({ key: "distribution", label: "Planned company distribution to household", where: "Settings → Household" });
  return out;
}

export const EMPLOYEE_CLASSIFICATION_OPTIONS: { value: EmployeeClassification; label: string }[] = [
  { value: "unresolved", label: "Unresolved (still to be decided)" },
  { value: "w2_gross", label: "W-2 gross wages; employer payroll costs are extra" },
  { value: "w2_gross_plus_employer_costs", label: "W-2 all-in; employer payroll costs included" },
  { value: "contractor", label: "Contractor payments; no employer payroll costs" },
];
