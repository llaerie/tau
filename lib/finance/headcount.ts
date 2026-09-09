/**
 * Employer payroll cost framework.
 *
 * Rates are NEVER hard-coded here: every rate/wage base is passed in as a
 * `PayrollRateAssumption` carrying its own FieldStatus and sourceId (a TaxRule / KnowledgeSource).
 * If any rate is not CONFIRMED the result carries that assumption flagged
 * `requiresProfessionalReview`. Unknown (null) rates → INSUFFICIENT_INFORMATION, never zero.
 */
import type { Assumption, CalcResult, Compensation, DecimalString, FieldStatus, ID, ISODate, PayrollRun, Transaction } from "@/lib/core/types";
import Decimal from "decimal.js";
import { D, abs, add, sub, within } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, type NumericInput } from "./calc-result";

export interface PayrollRateAssumption {
  value: DecimalString | number | null;
  status: FieldStatus;
  sourceId?: ID;
  note?: string;
}

export interface PayrollRateAssumptionSet {
  id?: ID;
  label?: string;
  taxYear?: number;
  isSynthetic?: boolean;
  socialSecurityRate: PayrollRateAssumption;
  socialSecurityWageBase: PayrollRateAssumption;
  medicareRate: PayrollRateAssumption;
  futaRate: PayrollRateAssumption;
  futaWageBase: PayrollRateAssumption;
  suiRate: PayrollRateAssumption;
  suiWageBase: PayrollRateAssumption;
  ettRate: PayrollRateAssumption;
  /** Employee-paid (e.g. CA SDI); carried for withholding context, not an employer cost. */
  sdiRate: PayrollRateAssumption;
  /** Additional Medicare etc. can be appended by callers. */
  [extra: string]: PayrollRateAssumption | ID | string | number | boolean | undefined;
}

const RATE_KEYS = ["socialSecurityRate", "socialSecurityWageBase", "medicareRate", "futaRate", "futaWageBase", "suiRate", "suiWageBase", "ettRate", "sdiRate"] as const;
type RateKey = (typeof RATE_KEYS)[number];

function rateAssumptions(rates: PayrollRateAssumptionSet, keys: readonly RateKey[]): Assumption[] {
  return keys.map((k) => {
    const r = rates[k];
    return {
      key: `payroll_rate:${k}`,
      description: `${k} (${rates.label ?? rates.id ?? "rate set"}${rates.taxYear ? `, tax year ${rates.taxYear}` : ""})${r.note ? `: ${r.note}` : ""}`,
      value: r.value,
      status: r.status,
      sourceId: r.sourceId,
      requiresProfessionalReview: r.status !== "CONFIRMED",
    };
  });
}

export interface FullyLoadedCostInput {
  compensation: Compensation;
  rates: PayrollRateAssumptionSet;
  /** Annual employer-paid benefits; null = unknown. */
  benefits: NumericInput;
  /** Annual allocated overhead (equipment, software seats, etc.); null = unknown. */
  overhead: NumericInput;
  /** Wages already paid this year (affects wage-base caps). Default 0 = start of year. */
  ytdWagesBefore?: DecimalString | number;
  /** Required for HOURLY compensation. */
  hoursPerYear?: number;
  asOfDate: ISODate;
  sourceIds?: ID[];
  workerId?: ID;
}

export interface FullyLoadedCost {
  annualGrossWages: DecimalString;
  socialSecurity: DecimalString;
  medicare: DecimalString;
  futa: DecimalString;
  sui: DecimalString;
  ett: DecimalString;
  employerTaxes: DecimalString;
  wagesPlusEmployerTaxes: DecimalString;
  benefits: DecimalString | null;
  overhead: DecimalString | null;
  /** null when benefits or overhead are unknown */
  total: DecimalString | null;
  /** effective employer tax rate = employerTaxes / gross */
  employerTaxRate: number | null;
  isContractor: boolean;
}

function annualize(c: Compensation, hoursPerYear?: number): { amount: Decimal | null; missing: string | null } {
  const a = D(c.amount);
  if (c.period === "ANNUAL") return { amount: a, missing: null };
  if (c.period === "MONTHLY") return { amount: a.times(12), missing: null };
  if (hoursPerYear === undefined || hoursPerYear === null) return { amount: null, missing: "hours per year for HOURLY compensation" };
  return { amount: a.times(hoursPerYear), missing: null };
}

function cappedWages(gross: Decimal, wageBase: Decimal | null, ytdBefore: Decimal): Decimal {
  if (wageBase === null) return gross;
  const room = Decimal.max(wageBase.minus(ytdBefore), 0);
  return Decimal.min(gross, room);
}

/** Fully loaded annual cost of a worker: gross + employer payroll taxes + benefits + overhead. */
export function fullyLoadedCost(input: FullyLoadedCostInput): CalcResult<FullyLoadedCost | null> {
  const name = "fully_loaded_cost";
  const formula =
    "total = annual_gross + employer_taxes + benefits + overhead; employer_taxes = SS(min(gross, ss_base - ytd) * ss_rate) + Medicare(gross * medicare_rate) + FUTA(min(gross, futa_base - ytd) * futa_rate) + SUI(min(gross, sui_base - ytd) * sui_rate) + ETT(min(gross, sui_base - ytd) * ett_rate)";
  const { compensation: c, rates } = input;
  const isContractor = c.type === "CONTRACT" || c.basis === "CONTRACT_FEE";
  const ytd = D(input.ytdWagesBefore ?? 0);
  const inputs: Record<string, unknown> = {
    workerId: input.workerId ?? null,
    compensation: { type: c.type, amount: dec(c.amount), period: c.period, basis: c.basis, status: c.status },
    rates: Object.fromEntries(RATE_KEYS.map((k) => [k, rates[k].value === null ? null : dec(rates[k].value as DecimalString)])),
    benefits: isUnknown(input.benefits) ? null : dec(input.benefits),
    overhead: isUnknown(input.overhead) ? null : dec(input.overhead),
    ytdWagesBefore: ytd.toFixed(4),
    hoursPerYear: input.hoursPerYear ?? null,
  };
  const assumptions: Assumption[] = [];
  if (c.status !== "CONFIRMED") {
    assumptions.push({ key: "compensation", description: `Compensation figure is ${c.status}${c.note ? `: ${c.note}` : ""}`, value: c.amount, status: c.status, requiresProfessionalReview: c.status === "PROFESSIONAL_REVIEW_REQUIRED" });
  }
  const missing: string[] = [];
  if (c.basis === "UNKNOWN") missing.push("compensation basis (gross vs net vs employer cost)");
  if (c.basis === "NET") missing.push("gross compensation (only NET is known; grossing up requires withholding rules)");
  const { amount: annual, missing: annualMissing } = annualize(c, input.hoursPerYear);
  if (annualMissing) missing.push(annualMissing);

  const employerKeys: RateKey[] = isContractor ? [] : ["socialSecurityRate", "socialSecurityWageBase", "medicareRate", "futaRate", "futaWageBase", "suiRate", "suiWageBase", "ettRate"];
  for (const k of employerKeys) if (rates[k].value === null) missing.push(`payroll rate assumption ${k}`);
  assumptions.push(...rateAssumptions(rates, employerKeys).filter((a) => a.status !== "CONFIRMED"));

  if (missing.length) return insufficient({ name, unit: "OBJECT", formula, inputs, asOfDate: input.asOfDate, missing, sourceIds: input.sourceIds, assumptions });
  const gross = annual as Decimal;
  const rv = (k: RateKey) => D(rates[k].value as DecimalString);

  let ss = D(0);
  let medicare = D(0);
  let futa = D(0);
  let sui = D(0);
  let ett = D(0);
  if (!isContractor) {
    ss = cappedWages(gross, rv("socialSecurityWageBase"), ytd).times(rv("socialSecurityRate"));
    medicare = gross.times(rv("medicareRate"));
    futa = cappedWages(gross, rv("futaWageBase"), ytd).times(rv("futaRate"));
    const suiWages = cappedWages(gross, rv("suiWageBase"), ytd);
    sui = suiWages.times(rv("suiRate"));
    ett = suiWages.times(rv("ettRate"));
  }
  const employerTaxes = ss.plus(medicare).plus(futa).plus(sui).plus(ett);
  const wagesPlusTaxes = gross.plus(employerTaxes);
  const benefits = isUnknown(input.benefits) ? null : dec(input.benefits);
  const overhead = isUnknown(input.overhead) ? null : dec(input.overhead);
  const notes: string[] = [];
  if (c.basis === "EMPLOYER_COST") notes.push("Compensation basis is EMPLOYER_COST: taxes computed on this figure may double count; confirm gross wages.");
  if (isContractor) notes.push("Contractor: no employer payroll taxes applied; classification must be CONFIRMED before relying on this.");
  const unknownParts: string[] = [];
  if (benefits === null) unknownParts.push("benefits");
  if (overhead === null) unknownParts.push("overhead");
  const total = unknownParts.length ? null : wagesPlusTaxes.plus(D(benefits as DecimalString)).plus(D(overhead as DecimalString)).toFixed(4);
  if (unknownParts.length) {
    notes.push(`INSUFFICIENT_INFORMATION: ${unknownParts.join(", ")} unknown; total is null (wagesPlusEmployerTaxes is complete).`);
    for (const p of unknownParts) assumptions.push({ key: `missing:${p}`, description: `Unknown input: ${p}`, value: null, status: "UNCONFIRMED" });
  }
  if (assumptions.some((a) => a.requiresProfessionalReview)) notes.push("Payroll rate assumptions are not all CONFIRMED; professional review required before use.");
  const value: FullyLoadedCost = {
    annualGrossWages: gross.toFixed(4),
    socialSecurity: ss.toFixed(4),
    medicare: medicare.toFixed(4),
    futa: futa.toFixed(4),
    sui: sui.toFixed(4),
    ett: ett.toFixed(4),
    employerTaxes: employerTaxes.toFixed(4),
    wagesPlusEmployerTaxes: wagesPlusTaxes.toFixed(4),
    benefits,
    overhead,
    total,
    employerTaxRate: gross.isZero() ? null : round(employerTaxes.div(gross).toNumber()),
    isContractor,
  };
  return makeCalc<FullyLoadedCost | null>({ name, value, unit: "OBJECT", formula, inputs, asOfDate: input.asOfDate, sourceIds: [...(input.sourceIds ?? []), ...(rates.id ? [rates.id] : [])], assumptions, notes });
}

export interface PayrollRunEmployerCost {
  gross: DecimalString;
  socialSecurityEmployer: DecimalString;
  medicareEmployer: DecimalString;
  federalUnemploymentEmployer: DecimalString;
  stateUnemploymentEmployer: DecimalString;
  stateTrainingTaxEmployer: DecimalString;
  otherEmployerCosts: DecimalString;
  employerTaxes: DecimalString;
  totalEmployerCost: DecimalString;
  employeeTaxesWithheld: DecimalString;
  otherDeductions: DecimalString;
  netPay: DecimalString;
  lineCount: number;
  /** Differences between line sums and run.totals (empty when consistent). */
  discrepancies: string[];
}

/** Sum a payroll run's lines into employer cost components and check them against run.totals. */
export function employerPayrollCostForRun(run: PayrollRun): CalcResult<PayrollRunEmployerCost> {
  const s = (pick: (l: PayrollRun["lines"][number]) => DecimalString) => run.lines.reduce((acc, l) => add(acc, pick(l)), "0.0000");
  const gross = s((l) => l.gross);
  const ss = s((l) => l.socialSecurityEmployer);
  const med = s((l) => l.medicareEmployer);
  const futa = s((l) => l.federalUnemploymentEmployer);
  const sui = s((l) => l.stateUnemploymentEmployer);
  const ett = s((l) => l.stateTrainingTaxEmployer);
  const other = s((l) => l.otherEmployerCosts);
  const employerTaxes = add(ss, med, futa, sui, ett);
  const totalEmployerCost = add(gross, employerTaxes, other);
  const employeeTaxes = s((l) => add(l.federalIncomeTaxWithheld, l.stateIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.stateDisabilityEmployee));
  const otherDeductions = s((l) => l.otherDeductions);
  const netPay = s((l) => l.netPay);
  const discrepancies: string[] = [];
  const check = (label: string, computed: DecimalString, reported: DecimalString) => {
    if (!within(computed, reported)) discrepancies.push(`${label}: lines sum to ${computed} but run.totals reports ${reported}`);
  };
  check("gross", gross, run.totals.gross);
  check("netPay", netPay, run.totals.netPay);
  check("employerTaxes", employerTaxes, run.totals.employerTaxes);
  check("totalEmployerCost", totalEmployerCost, run.totals.totalEmployerCost);
  check("employeeTaxes", employeeTaxes, run.totals.employeeTaxes);
  const lineTotalsSum = s((l) => l.totalEmployerCost);
  if (!within(lineTotalsSum, totalEmployerCost)) discrepancies.push(`line totalEmployerCost sums to ${lineTotalsSum} but components sum to ${totalEmployerCost}`);
  const expectedNet = sub(sub(gross, employeeTaxes), otherDeductions);
  if (!within(expectedNet, netPay)) discrepancies.push(`gross - employee taxes - deductions = ${expectedNet} but net pay lines sum to ${netPay}`);
  const value: PayrollRunEmployerCost = {
    gross,
    socialSecurityEmployer: ss,
    medicareEmployer: med,
    federalUnemploymentEmployer: futa,
    stateUnemploymentEmployer: sui,
    stateTrainingTaxEmployer: ett,
    otherEmployerCosts: other,
    employerTaxes,
    totalEmployerCost,
    employeeTaxesWithheld: employeeTaxes,
    otherDeductions,
    netPay,
    lineCount: run.lines.length,
    discrepancies,
  };
  return makeCalc<PayrollRunEmployerCost>({
    name: "employer_payroll_cost_for_run",
    value,
    unit: "OBJECT",
    formula: "employer_taxes = sum(SS_er + Medicare_er + FUTA + SUI + ETT); total_employer_cost = gross + employer_taxes + other_employer_costs",
    inputs: { payrollRunId: run.id, payDate: run.payDate, lines: run.lines.map((l) => ({ workerId: l.workerId, gross: l.gross, totalEmployerCost: l.totalEmployerCost })), reportedTotals: run.totals },
    sourceIds: [run.id, ...(run.journalEntryId ? [run.journalEntryId] : [])],
    asOfDate: run.payDate,
    notes: discrepancies.length ? discrepancies.map((d) => `DISCREPANCY: ${d}`) : [],
  });
}

export interface PayrollReconciliation {
  status: "MATCHED" | "VARIANCE";
  netPay: { expected: DecimalString; actual: DecimalString; variance: DecimalString; matched: boolean; transactionIds: ID[] };
  liabilities: { expected: DecimalString; actual: DecimalString; variance: DecimalString; matched: boolean; transactionIds: ID[]; note: string };
  totalVariance: DecimalString;
}

/**
 * Reconcile a payroll run against bank activity: net pay transactions vs run.totals.netPay and
 * tax deposit transactions vs (employee taxes withheld + employer taxes).
 * Transaction amounts are signed (negative = outflow); absolute values are used.
 */
export function payrollReconciliation(run: PayrollRun, netPayTransactions: Transaction[], liabilityPayments: Transaction[], opts: { tolerance?: DecimalString | number } = {}): CalcResult<PayrollReconciliation> {
  const tol = opts.tolerance ?? "0.005";
  const sumTx = (txs: Transaction[]) => txs.reduce((acc, t) => add(acc, abs(t.amount)), "0.0000");
  const expectedNet = D(run.totals.netPay).toFixed(4);
  const actualNet = sumTx(netPayTransactions);
  const netVar = sub(actualNet, expectedNet);
  const expectedLiab = add(run.totals.employeeTaxes, run.totals.employerTaxes);
  const actualLiab = sumTx(liabilityPayments);
  const liabVar = sub(actualLiab, expectedLiab);
  const netMatched = within(actualNet, expectedNet, tol);
  const liabMatched = liabilityPayments.length === 0 ? false : within(actualLiab, expectedLiab, tol);
  const liabNote = liabilityPayments.length === 0 ? "No liability payment transactions supplied; tax deposits are unreconciled (not assumed paid)." : liabMatched ? "Tax deposits match employee withholdings + employer taxes." : "Tax deposits differ from accrued payroll liabilities.";
  const status: PayrollReconciliation["status"] = netMatched && (liabMatched || liabilityPayments.length === 0) ? "MATCHED" : "VARIANCE";
  const value: PayrollReconciliation = {
    status,
    netPay: { expected: expectedNet, actual: actualNet, variance: netVar, matched: netMatched, transactionIds: netPayTransactions.map((t) => t.id) },
    liabilities: { expected: expectedLiab, actual: actualLiab, variance: liabVar, matched: liabMatched, transactionIds: liabilityPayments.map((t) => t.id), note: liabNote },
    totalVariance: add(abs(netVar), liabilityPayments.length ? abs(liabVar) : 0),
  };
  const notes: string[] = [];
  if (!netMatched) notes.push(`Net pay variance ${netVar}: bank ${actualNet} vs payroll register ${expectedNet}`);
  if (liabilityPayments.length && !liabMatched) notes.push(`Liability payment variance ${liabVar}: bank ${actualLiab} vs accrued ${expectedLiab}`);
  if (!liabilityPayments.length) notes.push(liabNote);
  return makeCalc<PayrollReconciliation>({
    name: "payroll_reconciliation",
    value,
    unit: "OBJECT",
    formula: "net_variance = sum(|net pay transactions|) - run.totals.netPay; liability_variance = sum(|deposit transactions|) - (employeeTaxes + employerTaxes); matched when |variance| <= tolerance",
    inputs: { payrollRunId: run.id, expectedNet, netPayTransactionAmounts: netPayTransactions.map((t) => t.amount), expectedLiab, liabilityTransactionAmounts: liabilityPayments.map((t) => t.amount), tolerance: dec(tol) },
    sourceIds: [run.id, ...netPayTransactions.map((t) => t.id), ...liabilityPayments.map((t) => t.id)],
    asOfDate: run.payDate,
    notes,
  });
}
