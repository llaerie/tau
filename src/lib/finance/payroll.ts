import { formatCents, isKnown, known, percentOf, total, totalOf, unknown, type Amount, type Total } from "./money";

/**
 * Employee withholding is PART OF gross pay: gross − withholding = take-home.
 * Nothing here is an additional company expense. Employer costs are separate.
 */
export interface PayrollRules {
  /** Employee Social Security + Medicare, percent of gross (6.2 + 1.45 = 7.65 for 2026). */
  ficaEmployeePct: number | null;
  /** California SDI, percent of covered wages (1.3 for 2026). Null = unknown / not applicable yet. */
  sdiPct: number | null;
  effectiveYear: number;
  source: string;
}

export interface WithholdingEstimate {
  /** Federal + state income tax withheld per month. Null = not estimated. */
  incomeTaxCents: number | null;
  incomeTaxLowCents: number | null;
  incomeTaxHighCents: number | null;
  /** Where the withholding figures come from. Only pay-stub/provider values are verified. */
  source: "none" | "estimate" | "paystub" | "provider";
}

export interface TakeHomeResult {
  gross: Amount;
  fica: Amount;
  sdi: Amount;
  incomeTax: Amount;
  /** Gross minus statutory employee withholding, before income tax. */
  beforeIncomeTax: Total;
  takeHome: Total;
  /** True only when every component comes from a pay stub or payroll provider. */
  verified: boolean;
  status: "verified" | "estimate" | "incomplete";
  assumptions: string[];
  rangeCents: [number, number] | null;
}

export function computeTakeHome(gross: Amount, rules: PayrollRules, w: WithholdingEstimate): TakeHomeResult {
  const fica = percentOf(gross, rules.ficaEmployeePct, "Employee FICA rate not set");
  const sdi = percentOf(gross, rules.sdiPct, "California SDI rate not set");
  const incomeTax = w.incomeTaxCents === null ? unknown("Income-tax withholding not estimated") : known(w.incomeTaxCents);
  const g = totalOf(gross);
  const beforeIncomeTax = total(g.knownCents - (isKnown(fica) ? fica.cents : 0) - (isKnown(sdi) ? sdi.cents : 0), [
    ...g.unknowns,
    ...(isKnown(fica) ? [] : [fica.reason]),
    ...(isKnown(sdi) ? [] : [sdi.reason]),
  ]);
  const takeHome = total(beforeIncomeTax.knownCents - (isKnown(incomeTax) ? incomeTax.cents : 0), [...beforeIncomeTax.unknowns, ...(isKnown(incomeTax) ? [] : [incomeTax.reason])]);
  const verified = w.source === "paystub" || w.source === "provider";
  const status: TakeHomeResult["status"] = !takeHome.complete ? "incomplete" : verified ? "verified" : "estimate";
  const range = w.incomeTaxLowCents !== null && w.incomeTaxHighCents !== null && beforeIncomeTax.complete ? ([beforeIncomeTax.knownCents - w.incomeTaxHighCents, beforeIncomeTax.knownCents - w.incomeTaxLowCents] as [number, number]) : null;
  const assumptions = [
    rules.ficaEmployeePct === null ? "Employee FICA rate is not set." : `Employee FICA ${rules.ficaEmployeePct}% of gross (${rules.source}, ${rules.effectiveYear}).`,
    rules.sdiPct === null ? "California SDI is not set; it may apply." : `California SDI ${rules.sdiPct}% of covered wages (${rules.source}, ${rules.effectiveYear}).`,
    w.incomeTaxCents === null
      ? "Income-tax withholding has not been estimated, so take-home is incomplete."
      : `${verified ? "Income tax withheld per pay stub" : "Income-tax withholding estimated"} at ${formatCents(w.incomeTaxCents)} per month${range ? ` (plausible range ${formatCents(w.incomeTaxLowCents!)}–${formatCents(w.incomeTaxHighCents!)})` : ""}.`,
    verified ? "Figures come from payroll records." : "Not a verified paycheck: payroll or a CPA sets the exact withholding.",
  ];
  return { gross, fica, sdi, incomeTax, beforeIncomeTax, takeHome, verified, status, assumptions, rangeCents: range };
}

/** Employer-side payroll cost on W-2 wages. Unknown until a rate is configured. */
export function employerPayrollCost(grossWages: Total, employerRatePct: number | null): Amount {
  if (employerRatePct === null) return unknown("Employer payroll cost rate not set");
  if (!grossWages.complete) return unknown("Gross wages incomplete");
  return known(Math.round((grossWages.knownCents * employerRatePct) / 100));
}

export const PAYROLL_RULES_2026: PayrollRules = {
  ficaEmployeePct: 7.65,
  sdiPct: 1.3,
  effectiveYear: 2026,
  source: "IRS Publication 15 and California EDD rates, 2026",
};
