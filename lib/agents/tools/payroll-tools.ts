/**
 * Payroll tools. Rates are never hard-coded: an explicit `rateSet` in the request is used
 * (labelled UNCONFIRMED unless stated), otherwise CONFIRMED rules from dataset.taxRules; when
 * neither exists the result is null with INSUFFICIENT_INFORMATION. Payroll changes and runs are
 * RED and blocked in Phase One. Worker classification is never decided here.
 */
import type { ToolContext } from "@/lib/core/contracts";
import type { Assumption, CalcResult, DecimalString, FieldStatus, PayrollRun, Transaction, Worker } from "@/lib/core/types";
import { addMonths, daysBetween } from "@/lib/core/dates";
import { D, abs, money, mul, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { fullyLoadedCost, payrollReconciliation, type PayrollRateAssumption, type PayrollRateAssumptionSet } from "@/lib/finance/headcount";
import { detectPayrollCadence, projectPayDates } from "@/lib/forecasting/drivers";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, moneyFigure, ok, pct, propose, textFigure, toDec } from "./common";
import { cpaQueueFor, taxRuleStoreFor } from "./runtime-bridge";

// ---------------------------------------------------------------------------
// Rate set resolution
// ---------------------------------------------------------------------------

const RATE_RULE_KEYS: Record<string, string> = {
  socialSecurityRate: "fed_social_security_rate",
  socialSecurityWageBase: "fed_social_security_wage_base",
  medicareRate: "fed_medicare_rate",
  futaRate: "futa_rate",
  futaWageBase: "futa_wage_base",
  suiRate: "ca_sui_rate_new_employer",
  ettRate: "ca_ett_rate",
  sdiRate: "ca_sdi_rate",
};
const PROVIDED_ALIASES: Record<string, string> = { socialSecurityEmployer: "socialSecurityRate", socialSecurityEmployee: "socialSecurityRate", medicareEmployer: "medicareRate", medicareEmployee: "medicareRate", sdiEmployee: "sdiRate", ettWageBase: "suiWageBase" };
const EMPLOYER_RATE_KEYS = ["socialSecurityRate", "medicareRate", "futaRate", "suiRate", "ettRate"] as const;

export interface RateSetBuild {
  rates: PayrollRateAssumptionSet;
  source: "PROVIDED" | "TAX_RULES" | "NONE";
  missingEmployerRates: string[];
  allConfirmed: boolean;
}

function unknownRate(note: string): PayrollRateAssumption {
  return { value: null, status: "UNCONFIRMED", note };
}

export function buildRateSet(ctx: ToolContext, provided?: Record<string, string | number>, status: FieldStatus = "UNCONFIRMED"): RateSetBuild {
  const keys = ["socialSecurityRate", "socialSecurityWageBase", "medicareRate", "futaRate", "futaWageBase", "suiRate", "suiWageBase", "ettRate", "sdiRate"] as const;
  const rates = {} as PayrollRateAssumptionSet;
  let source: RateSetBuild["source"] = "NONE";
  if (provided && Object.keys(provided).length) {
    source = "PROVIDED";
    const normalized: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(provided)) normalized[PROVIDED_ALIASES[k] ?? k] = v;
    for (const k of keys) rates[k] = normalized[k] === undefined ? unknownRate("not supplied in rateSet") : { value: String(normalized[k]), status, note: `supplied by requester (${status})` };
    rates.id = "rates_provided_by_request";
    rates.label = `Rate set supplied with the request (${status}; not an authoritative source)`;
  } else {
    const store = taxRuleStoreFor(ctx.dataset);
    const year = Number(ctx.asOfDate.slice(0, 4));
    let any = false;
    for (const k of keys) {
      const ruleKey = RATE_RULE_KEYS[k];
      const res = ruleKey ? store.resolveRule(ruleKey, year, ctx.asOfDate) : null;
      const p = res?.rule?.parameters ?? {};
      const raw = p.rate ?? p.wageBase ?? p.amount ?? p.value ?? null;
      if (res?.usable && raw !== null && raw !== undefined && raw !== false) {
        any = true;
        rates[k] = { value: String(raw), status: "CONFIRMED", sourceId: res.rule!.id, note: `TaxRule ${ruleKey} (${res.rule!.status})` };
      } else rates[k] = unknownRate(ruleKey ? `rule ${ruleKey}: ${res?.reason ?? "not registered"}` : "no rule key");
    }
    source = any ? "TAX_RULES" : "NONE";
    rates.id = "rates_from_tax_rules";
    rates.label = "Rates resolved from TaxRule records (CONFIRMED only)";
  }
  rates.taxYear = Number(ctx.asOfDate.slice(0, 4));
  const missing = EMPLOYER_RATE_KEYS.filter((k) => rates[k].value === null);
  return { rates, source, missingEmployerRates: [...missing], allConfirmed: EMPLOYER_RATE_KEYS.every((k) => rates[k].status === "CONFIRMED") };
}

export function rateAssumptions(rs: RateSetBuild): Assumption[] {
  return EMPLOYER_RATE_KEYS.map((k) => ({ key: `payroll_rate:${k}`, description: `${k}: ${rs.rates[k].note ?? ""}`, value: rs.rates[k].value, status: rs.rates[k].status, sourceId: rs.rates[k].sourceId, requiresProfessionalReview: rs.rates[k].status !== "CONFIRMED" }));
}

/** Employer taxes for a gross amount using the five employer rates (wage-base caps not applied). */
export function employerTaxesUncapped(gross: DecimalString, rs: RateSetBuild, asOf: string) {
  const rate = EMPLOYER_RATE_KEYS.reduce((acc, k) => acc.plus(D(rs.rates[k].value as DecimalString)), D(0));
  const taxes = D(gross).times(rate).toFixed(4);
  return makeCalc<DecimalString>({
    name: "employer_payroll_taxes",
    value: taxes,
    unit: "USD",
    formula: "employer_taxes = gross × (ss_rate + medicare_rate + futa_rate + sui_rate + ett_rate) — wage-base caps not applied",
    inputs: { gross, rates: Object.fromEntries(EMPLOYER_RATE_KEYS.map((k) => [k, rs.rates[k].value])), effectiveRate: rate.toString() },
    asOfDate: asOf,
    sourceIds: EMPLOYER_RATE_KEYS.map((k) => rs.rates[k].sourceId).filter((x): x is string => Boolean(x)),
    assumptions: rateAssumptions(rs),
    notes: rs.allConfirmed ? [] : ["Rate assumptions are not all CONFIRMED from an authoritative source; professional review required before use."],
  });
}

const RATE_ESCALATION = "Payroll tax rates must come from an authoritative source (retrieved TaxRule with a CURRENT KnowledgeSource) or be supplied explicitly with the request; none are available, so the value is null.";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const payrollCalendarTool = defineTool({
  name: "payroll_calendar",
  description: "Upcoming payroll dates projected from the detected run cadence, with the last run's net pay and tax deposit amounts as assumptions.",
  riskLevel: "GREEN",
  capabilityKey: "payroll_monitoring",
  inputSchema: TASKS["payroll.calendar"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const pattern = detectPayrollCadence(ctx.dataset.payrollRuns);
    if (pattern.cadence === "UNKNOWN") return ok(insufficient(["payroll history (at least two non-draft runs) or the payroll schedule"], "I can't project payroll dates: the run cadence is unknown."), { assumptions: [] });
    const until = addMonths(asOf, input.months ?? 3);
    const dates = projectPayDates(pattern, asOf, until);
    const last = [...ctx.dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? -1 : 1)).pop()!;
    const taxes = D(last.totals.employeeTaxes).plus(D(last.totals.employerTaxes)).toFixed(4);
    const calc = makeCalc<DecimalString>({ name: "projected_payroll_cash_out", value: D(last.totals.netPay).plus(D(taxes)).times(dates.length).toFixed(4), unit: "USD", formula: "(last run net pay + employee & employer taxes) × projected pay dates", inputs: { cadence: pattern.cadence, payDates: dates, netPay: last.totals.netPay, taxes }, asOfDate: asOf, sourceIds: [last.id], assumptions: [{ key: "payroll_pattern", description: `Future runs assumed equal to the last run ${last.id} (${pattern.cadence}).`, value: last.totals.netPay, status: "UNCONFIRMED", sourceId: last.id }] });
    return ok({
      answer: `Payroll runs ${pattern.cadence.toLowerCase().replace("_", "-")}; ${dates.length} pay date(s) through ${until}: ${dates.join(", ")}. Each run is expected to need about ${last.totals.netPay} net pay plus ${taxes} in tax deposits (based on the last run).`,
      numbers: [textFigure("Cadence", pattern.cadence), textFigure("Next pay date", dates[0] ?? "none in window"), moneyFigure("Net pay per run (last run)", last.totals.netPay), moneyFigure("Tax deposits per run (last run)", taxes), moneyFigure("Projected cash out", calc.value, calc.id)],
      why: [`Cadence detected from ${pattern.runIds.length} run(s); last pay date ${pattern.lastPayDate}.`],
      risks: ["Deposit due dates depend on the deposit schedule rule, which must be confirmed by the payroll provider/CPA."],
      confidence: 0.8,
      structured: { value: calc.value, values: { runs: dates.length, netPayPerRun: last.totals.netPay, taxesPerRun: taxes }, cadence: pattern.cadence, payDates: dates },
    }, { calcs: [calc] });
  },
});

function runFor(ctx: ToolContext, id?: string, payDate?: string): PayrollRun | undefined {
  if (id) return ctx.dataset.payrollRuns.find((r) => r.id === id);
  if (payDate) return ctx.dataset.payrollRuns.find((r) => r.payDate === payDate);
  return [...ctx.dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? -1 : 1)).pop();
}

export const reconcileRunTool = defineTool({
  name: "reconcile_payroll_run",
  description: "Reconcile a payroll run's net pay and tax deposits to bank transactions.",
  riskLevel: "GREEN",
  capabilityKey: "payroll_reconciliation",
  inputSchema: TASKS["payroll.reconcile_run"].params,
  async execute(input, ctx) {
    const run = runFor(ctx, input.payrollRunId, input.payDate);
    if (!run) return ok(insufficient(["payroll run"], `No payroll run ${input.payrollRunId ?? input.payDate ?? ""} found.`));
    const txById = new Map(ctx.dataset.transactions.map((t) => [t.id, t]));
    let netTx: Transaction[] = run.netPayTransactionIds.map((id) => txById.get(id)).filter((t): t is Transaction => Boolean(t));
    if (!netTx.length) netTx = ctx.dataset.transactions.filter((t) => D(t.amount).lt(0) && Math.abs(daysBetween(t.date, run.payDate)) <= 3 && /payroll|net pay|direct dep|gusto|paystream|rippling/i.test(`${t.descriptionRaw} ${t.merchantNormalized ?? ""}`));
    const liabTx = ctx.dataset.payrollLiabilities.filter((l) => l.payrollRunId === run.id && l.paidTransactionId).map((l) => txById.get(l.paidTransactionId!)).filter((t): t is Transaction => Boolean(t));
    const calc = payrollReconciliation(run, netTx, liabTx);
    const v = calc.value;
    return ok({
      answer: `Payroll run ${run.id} (paid ${run.payDate}): net pay ${v.netPay.matched ? "matches" : "does NOT match"} the bank (${v.netPay.actual} vs ${v.netPay.expected}, variance ${v.netPay.variance}); ${v.liabilities.note} Overall: ${v.status}.`,
      numbers: [moneyFigure("Net pay expected", v.netPay.expected), moneyFigure("Net pay in bank", v.netPay.actual), moneyFigure("Net pay variance", v.netPay.variance, calc.id), moneyFigure("Liabilities expected", v.liabilities.expected), moneyFigure("Liabilities paid", v.liabilities.actual)],
      why: [`${netTx.length} net-pay transaction(s) and ${liabTx.length} deposit transaction(s) considered.`],
      risks: v.status === "VARIANCE" ? ["Variance between the payroll register and the bank must be explained before the period closes."] : [],
      confidence: v.status === "MATCHED" ? 0.9 : 0.7,
      structured: { value: v.totalVariance, values: { netPayExpected: v.netPay.expected, netPayActual: v.netPay.actual, netPayVariance: v.netPay.variance, liabilitiesExpected: v.liabilities.expected, liabilitiesActual: v.liabilities.actual }, status: v.status, payrollRunId: run.id },
    }, { calcs: [calc], sourceIds: [run.id] });
  },
});

export const employerCostTool = defineTool({
  name: "employer_payroll_cost",
  description: "Employer payroll cost for a gross amount using provided/confirmed rates; null + INSUFFICIENT_INFORMATION when no authoritative rates exist.",
  riskLevel: "GREEN",
  capabilityKey: "payroll_monitoring",
  inputSchema: TASKS["payroll.employer_cost"].params,
  async execute(input, ctx) {
    const gross = money(input.gross);
    const period = input.period ?? "MONTHLY";
    const rs = buildRateSet(ctx, input.rateSet, input.rateSetStatus ?? "UNCONFIRMED");
    if (rs.missingEmployerRates.length) {
      return ok({ ...insufficient(rs.missingEmployerRates.map((k) => `payroll rate ${k}`), `Gross ${period.toLowerCase()} wages are ${gross}, but I can't compute employer payroll taxes: ${RATE_ESCALATION}`, { numbers: [moneyFigure("Gross wages", gross)], structured: { values: { gross }, rateSource: rs.source } }), escalation: esc("INSUFFICIENT_INFORMATION", RATE_ESCALATION, { missingItems: rs.missingEmployerRates, requiredRole: "CPA" }) }, { assumptions: rateAssumptions(rs) });
    }
    const annualGross = period === "ANNUAL" ? gross : mul(gross, 12);
    const status: FieldStatus = rs.source === "PROVIDED" ? (input.rateSetStatus ?? "UNCONFIRMED") : rs.allConfirmed ? "CONFIRMED" : "UNCONFIRMED";
    const capped = fullyLoadedCost({ compensation: { type: "SALARY", amount: annualGross, currency: "USD", period: "ANNUAL", basis: "GROSS", status }, rates: rs.rates, benefits: null, overhead: null, asOfDate: ctx.asOfDate });
    const calcs: CalcResult[] = [];
    const flagged = !rs.allConfirmed || status !== "CONFIRMED";
    const rateNote = rs.allConfirmed && status === "CONFIRMED" ? "Rates are CONFIRMED (supplied as confirmed / from approved tax rules)." : `Rates are ${rs.source === "PROVIDED" ? "supplied with the request and NOT CONFIRMED" : "partly unconfirmed"}; every rate assumption is flagged for professional review — verify against an authoritative source before relying on them.`;
    if (capped.value) {
      const v = capped.value;
      calcs.push(capped);
      const monthlyTaxes = period === "MONTHLY" ? D(v.employerTaxes).div(12).toFixed(4) : null;
      return ok({
        answer: `On ${annualGross} of annual gross wages${period === "MONTHLY" ? ` (${gross}/month)` : ""}, employer payroll taxes are ${v.employerTaxes} (Social Security ${v.socialSecurity}, Medicare ${v.medicare}, FUTA ${v.futa}, SUI ${v.sui}, ETT ${v.ett}; wage-base caps applied; effective ${pct(v.employerTaxRate, 2)}), for wages plus employer taxes of ${v.wagesPlusEmployerTaxes}${monthlyTaxes ? ` — about ${monthlyTaxes} of employer taxes per month` : ""}. ${rateNote}`,
        numbers: [moneyFigure("Annual gross wages", v.annualGrossWages), moneyFigure("Employer taxes", v.employerTaxes, capped.id), moneyFigure("Social Security (employer)", v.socialSecurity), moneyFigure("Medicare (employer)", v.medicare), moneyFigure("FUTA", v.futa), moneyFigure("SUI", v.sui), moneyFigure("ETT", v.ett), moneyFigure("Wages + employer taxes", v.wagesPlusEmployerTaxes)],
        why: [capped.formula],
        risks: flagged ? ["Rates are assumptions, not authoritative; do not use for filings or deposits until confirmed."] : [],
        confidence: flagged ? 0.6 : 0.85,
        structured: { value: v.wagesPlusEmployerTaxes, values: { gross, annualGross: v.annualGrossWages, employerTaxes: v.employerTaxes, socialSecurity: v.socialSecurity, medicare: v.medicare, futa: v.futa, sui: v.sui, ett: v.ett, totalEmployerCost: v.wagesPlusEmployerTaxes, wagesPlusEmployerTaxes: v.wagesPlusEmployerTaxes, employerTaxRate: v.employerTaxRate, monthlyEmployerTaxes: monthlyTaxes }, rateSource: rs.source, ratesConfirmed: rs.allConfirmed && status === "CONFIRMED" },
      }, { calcs, assumptions: rateAssumptions(rs) });
    }
    // Wage bases unknown: uncapped estimate on the period amount.
    const taxes = employerTaxesUncapped(gross, rs, ctx.asOfDate);
    calcs.push(taxes);
    const total = D(gross).plus(D(taxes.value)).toFixed(4);
    return ok({
      answer: `On ${gross} gross (${period.toLowerCase()}), employer payroll taxes are about ${taxes.value} (effective ${pct(D(taxes.value).div(D(gross)).toNumber(), 2)}; wage-base caps NOT applied because the wage bases were not supplied), for a total employer cost of ${total}. ${rateNote}`,
      numbers: [moneyFigure("Gross wages", gross), moneyFigure("Employer taxes (uncapped)", taxes.value, taxes.id), moneyFigure("Total employer cost", total)],
      why: [`Employer taxes = gross × sum of employer rates (${EMPLOYER_RATE_KEYS.map((k) => `${k} ${rs.rates[k].value}`).join(", ")}).`],
      risks: ["Wage-base caps not applied; the figure overstates taxes for wages above the Social Security / FUTA / SUI bases.", ...(flagged ? ["Rates are assumptions, not authoritative; do not use for filings or deposits."] : [])],
      confidence: 0.55,
      structured: { value: total, values: { gross, employerTaxes: taxes.value, totalEmployerCost: total, effectiveRate: D(taxes.value).div(D(gross)).toNumber() }, rateSource: rs.source, ratesConfirmed: false, capsApplied: false },
    }, { calcs, assumptions: rateAssumptions(rs) });
  },
});

export const grossToNetTool = defineTool({
  name: "gross_to_net",
  description: "Gross-to-net using explicitly provided withholding amounts or rates (never invented).",
  riskLevel: "GREEN",
  capabilityKey: "payroll_monitoring",
  inputSchema: TASKS["payroll.gross_to_net"].params,
  async execute(input, ctx) {
    const gross = money(input.gross);
    const lines: { key: string; amount: DecimalString; basis: string }[] = [];
    if (input.withholdings && Object.keys(input.withholdings).length) {
      for (const [k, v] of Object.entries(input.withholdings)) lines.push({ key: k, amount: money(v), basis: "amount supplied" });
    } else if (input.rateSet && Object.keys(input.rateSet).length) {
      for (const [k, v] of Object.entries(input.rateSet)) lines.push({ key: k, amount: D(gross).times(D(v)).toFixed(4), basis: `gross × ${v} (rate supplied)` });
    } else {
      return ok({ ...insufficient(["withholding amounts or employee-side rates"], `Gross pay is ${gross}. I can't compute net pay without the withholding amounts or rates — federal/state withholding depend on elections and tables that must come from the payroll provider, not from me.`, { numbers: [moneyFigure("Gross", gross)], structured: { values: { gross } } }), escalation: esc("INSUFFICIENT_INFORMATION", "Withholdings must be supplied (payroll provider register) — never estimated.", { missingItems: ["withholdings"], requiredRole: "PAYROLL_PROFESSIONAL" }) });
    }
    const totalWithheld = lines.reduce((acc, l) => acc.plus(D(l.amount)), D(0)).toFixed(4);
    const net = sub(gross, totalWithheld);
    const calc = makeCalc<DecimalString>({ name: "net_pay", value: net, unit: "USD", formula: "net = gross - sum(withholdings)", inputs: { gross, withholdings: lines }, asOfDate: ctx.asOfDate, assumptions: lines.map((l) => ({ key: `withholding:${l.key}`, description: `${l.key}: ${l.basis}`, value: l.amount, status: "UNCONFIRMED" as const, requiresProfessionalReview: true })) });
    return ok({
      answer: `Gross ${gross} less withholdings ${totalWithheld} (${lines.map((l) => `${l.key} ${l.amount}`).join(", ")}) = net pay ${net}. These withholdings are as supplied; the payroll provider's register is authoritative.`,
      numbers: [moneyFigure("Gross", gross), moneyFigure("Total withheld", totalWithheld), moneyFigure("Net pay", net, calc.id)],
      educationKey: "gross_vs_net",
      confidence: 0.8,
      structured: { value: net, values: { gross, totalWithheld, netPay: net }, withholdings: lines },
    }, { calcs: [calc] });
  },
});

export const payrollLiabilitiesTool = defineTool({
  name: "payroll_liabilities",
  description: "Outstanding (accrued, unpaid) payroll liabilities with due dates.",
  riskLevel: "GREEN",
  capabilityKey: "payroll_monitoring",
  inputSchema: TASKS["payroll.liabilities"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const open = ctx.dataset.payrollLiabilities.filter((l) => l.status !== "PAID" && l.accruedDate <= asOf);
    const total = open.reduce((acc, l) => acc.plus(D(l.amount)), D(0)).toFixed(4);
    const unknownDue = open.filter((l) => l.dueDate === null);
    const overdue = open.filter((l) => l.dueDate && l.dueDate < asOf);
    const calc = makeCalc<DecimalString>({ name: "open_payroll_liabilities", value: total, unit: "USD", formula: "sum(accrued payroll liabilities not yet paid)", inputs: { asOf, count: open.length }, asOfDate: asOf, sourceIds: open.map((l) => l.id) });
    return ok({
      answer: open.length ? `${open.length} open payroll liabilit${open.length === 1 ? "y" : "ies"} totaling ${total} as of ${asOf}; ${overdue.length} past due, ${unknownDue.length} with unknown due dates.` : "No open payroll liabilities are recorded.",
      numbers: [moneyFigure("Open payroll liabilities", total, calc.id), textFigure("Past due", overdue.length), textFigure("Unknown due date", unknownDue.length)],
      why: open.slice(0, 10).map((l) => `${l.kind}: ${l.amount} accrued ${l.accruedDate}, due ${l.dueDate ?? "UNKNOWN"}`),
      risks: [...(overdue.length ? ["Past-due payroll tax deposits carry penalties; confirm with the payroll provider."] : []), ...(unknownDue.length ? ["Deposit due dates are unknown for some liabilities because the deposit-schedule rule is not confirmed."] : [])],
      educationKey: "payroll_liabilities",
      confidence: 0.85,
      structured: { value: total, values: { total, count: open.length, overdue: overdue.length, unknownDue: unknownDue.length }, liabilities: open.map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, accruedDate: l.accruedDate, dueDate: l.dueDate, status: l.status })) },
    }, { calcs: [calc] });
  },
});

function workerFacts(w: Worker): string[] {
  return [`${w.displayName}: ${w.roleTitle}, ${w.country}, type ${w.workerType}, classification ${w.classificationStatus}`, `Pay method ${w.payMethod ?? "UNKNOWN"}; compensation basis ${w.compensation.basis} (${w.compensation.status})`, `Started ${w.startDate}${w.endDate ? `, ended ${w.endDate}` : ""}; owner ${w.isOwner ? "yes" : "no"}; related party ${w.relatedParty ? "yes" : "no"}`];
}

export const classificationFlagTool = defineTool({
  name: "worker_classification_flag",
  description: "Flag a worker classification question for professional review — the system never decides employee vs contractor.",
  riskLevel: "YELLOW",
  capabilityKey: "worker_classification",
  inputSchema: TASKS["payroll.classification_flag"].params,
  async execute(input, ctx) {
    const w = input.workerId ? ctx.dataset.workers.find((x) => x.id === input.workerId) : undefined;
    if (input.workerId && !w) return ok(insufficient([`worker ${input.workerId}`], `No worker ${input.workerId}.`));
    const country = (input.country ?? w?.country ?? "UNKNOWN").toUpperCase();
    const international = country !== "US" && country !== "UNKNOWN";
    const cn = country === "CN" || country === "CHINA";
    const facts = w ? workerFacts(w) : [`Description: ${input.description ?? "(none)"}`, `Country: ${country}`];
    const judgment = [
      "Employee vs contractor status is a legal determination (behavioral control, financial control, relationship) made by the CPA/attorney — not by this system.",
      ...(international ? ["Cross-border workers additionally raise employing-entity, local labor law, withholding and permanent-establishment questions for an attorney and the CPA."] : []),
      ...(cn ? ["China-based workers: local employment law, currency/payment method and social insurance obligations require specialist review; payments are held in 6060 (classification pending)."] : []),
    ];
    cpaQueueFor(ctx.dataset).addUnique({ topic: "worker_classification", question: `Classification of ${w?.displayName ?? input.description ?? "worker"} (${country})`, context: facts.join(" | "), urgency: international ? "HIGH" : "MEDIUM", relatedConfigKeys: ["international_workforce.china_worker_classification"] });
    return ok({
      answer: `${w?.displayName ?? "This worker"} (${country}) needs a professional classification review — I flag the question and gather facts but never decide employee vs contractor.${international ? " Because the worker is outside the US, an attorney and the CPA must both weigh in." : ""}`,
      escalation: esc("PROFESSIONAL_REVIEW_REQUIRED", `Worker classification${international ? " (international)" : ""} is a professional determination.`, { requiredRole: international ? "ATTORNEY" : "CPA", relatedConfigKeys: ["international_workforce.china_worker_classification"] }),
      why: facts,
      risks: ["Misclassification exposes the company to back taxes, penalties and labor claims."],
      recommendation: "Route to the CPA/attorney with the facts above; keep payments coded to the pending-classification account until resolved.",
      confidence: 0.9,
      highRisk: { facts, calculations: ["None — no amounts were computed."], assumptions: [`Country ${country}${w ? "" : " as stated"}`], professionalJudgment: judgment },
      structured: { value: null, workerId: w?.id ?? null, country, international, escalation: "PROFESSIONAL_REVIEW_REQUIRED", facts, professionalJudgment: judgment },
    }, { sourceIds: w ? [w.id, ...w.documentIds] : [] });
  },
});

export const internationalReviewTool = defineTool({
  name: "international_worker_review",
  description: "Cross-border worker review checklist and status (fields remain unknown until a professional confirms them).",
  riskLevel: "GREEN",
  capabilityKey: "international_worker_compliance",
  inputSchema: TASKS["payroll.international_review"].params,
  async execute(input, ctx) {
    const requested = input.workerId ? ctx.dataset.workers.find((w) => w.id === input.workerId) : undefined;
    if (input.workerId && !requested) return ok(insufficient([`worker ${input.workerId}`], `No worker ${input.workerId}.`));
    if (requested && requested.country === "US") {
      return ok({
        answer: `${requested.displayName} is a US-based (domestic) ${requested.workerType.toLowerCase()} — not an international worker, so the cross-border review is not applicable. Domestic classification and payroll documentation still follow the normal US process.`,
        confidence: 0.9,
        structured: { value: null, workerId: requested.id, country: requested.country, international: false, applicable: false },
      }, { sourceIds: [requested.id] });
    }
    const workers = requested ? [requested] : ctx.dataset.workers.filter((w) => w.country !== "US");
    if (!workers.length) return ok(insufficient(["non-US workers"], "No non-US workers are on record; the international review is not applicable."));
    const rows = workers.map((w) => {
      const fields = w.internationalReview?.fields ?? [];
      const confirmed = fields.filter((f) => f.status === "CONFIRMED").length;
      return { workerId: w.id, name: w.displayName, country: w.country, status: w.internationalReview?.status ?? "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED", reviewer: w.internationalReview?.reviewerRole ?? "ATTORNEY", fields: fields.map((f) => ({ key: f.key, label: f.label, status: f.status, value: f.value })), confirmed, total: fields.length };
    });
    const facts = rows.flatMap((r) => [`${r.name} (${r.country}): review ${r.status}; ${r.confirmed}/${r.total} fields confirmed`]);
    return ok({
      answer: `${rows.length} international worker(s) under review: ${rows.map((r) => `${r.name} — ${r.status.replace(/_/g, " ").toLowerCase()} (${r.confirmed}/${r.total} fields confirmed)`).join("; ")}. Every unconfirmed field stays UNKNOWN until the reviewing professional answers it.`,
      escalation: esc("PROFESSIONAL_REVIEW_REQUIRED", "Cross-border worker compliance requires attorney + CPA review.", { requiredRole: "ATTORNEY" }),
      why: rows.flatMap((r) => r.fields.filter((f) => f.status !== "CONFIRMED").slice(0, 6).map((f) => `${r.name}: ${f.label} — ${f.status}`)),
      confidence: 0.9,
      highRisk: { facts, calculations: ["None."], assumptions: ["No assumptions: unknown fields are reported as unknown."], professionalJudgment: ["Employing entity, local labor law, withholding and permanent-establishment questions are for the attorney and CPA."] },
      structured: { value: null, workers: rows, facts },
    }, { sourceIds: workers.map((w) => w.id) });
  },
});

export const payrollChangeTool = defineTool({
  name: "payroll_change",
  description: "Any request to run or change payroll: proposes CHANGE_PAYROLL (RED, blocked in Phase One) and returns the prepared change package.",
  riskLevel: "RED",
  capabilityKey: "payroll_execution",
  inputSchema: TASKS["payroll.change"].params,
  async execute(input, ctx) {
    const w = input.workerId ? ctx.dataset.workers.find((x) => x.id === input.workerId) : undefined;
    const amount = toDec(input.amount);
    const run = /\brun\b|process|execute|submit/i.test(input.description);
    const action = propose(ctx, { kind: run ? "RUN_PAYROLL" : "CHANGE_PAYROLL", description: `${run ? "Run payroll" : "Change payroll"}: ${input.description}${w ? ` (${w.displayName})` : ""}${amount ? ` ${amount}` : ""}`, reason: input.description, amount, targetIds: w ? [w.id] : [], payload: { package: { description: input.description, workerId: w?.id ?? null, amount } }, context: { touchesPayroll: true, movesMoney: run, involvesRelatedParty: w?.isOwner || w?.relatedParty }, reversible: false });
    return ok({
      answer: `I can't ${run ? "run payroll" : "change payroll"} — payroll execution and changes are RED actions that are blocked in Phase One and are always carried out by the payroll provider after owner${w?.isOwner ? " and CPA" : ""} approval. Here is the prepared change package: ${input.description}${w ? ` for ${w.displayName}` : ""}${amount ? `, amount ${amount}` : ""}.`,
      escalation: esc("REFUSED_CONTROL_VIOLATION", `${run ? "RUN_PAYROLL" : "CHANGE_PAYROLL"} cannot execute in Phase One (simulation only); the package is returned for a human to submit to the payroll provider after approval.`, { requiredRole: "OWNER" }),
      numbers: amount ? [moneyFigure("Requested amount", amount)] : [],
      risks: [...(w?.isOwner ? ["Owner compensation changes are a reasonable-compensation question for the CPA."] : []), "Payroll changes affect withholding, deposits and quarterly filings."],
      recommendation: "Approve the package and submit the change through the payroll provider; I will reconcile the next run.",
      confidence: 0.95,
      highRisk: { facts: w ? workerFacts(w) : [`Request: ${input.description}`], calculations: amount ? [`Requested amount ${amount} (as stated, not computed)`] : ["None."], assumptions: ["None."], professionalJudgment: ["Payroll changes are executed by the payroll provider; owner compensation levels require CPA judgment."] },
      structured: { value: amount, riskLevel: "RED", actionsExecuted: 0, changePackage: { description: input.description, workerId: w?.id ?? null, amount } },
    }, { proposedActions: [action], sourceIds: w ? [w.id] : [] });
  },
});

export const ownerCompensationTool = defineTool({
  name: "owner_compensation_model",
  description: "Model a proposed owner salary: payroll cost as CALCULATION, the proposed figure as ASSUMPTION, reasonable compensation as PROFESSIONAL JUDGMENT (CPA_REVIEW_REQUIRED).",
  riskLevel: "YELLOW",
  capabilityKey: "payroll_monitoring",
  inputSchema: TASKS["payroll.owner_compensation"].params,
  async execute(input, ctx) {
    const owner = ctx.dataset.workers.find((w) => w.isOwner);
    const year = Number(ctx.asOfDate.slice(0, 4));
    const officerComp = ctx.ledger.getAccount("6010") ? ctx.ledger.accountBalance("acct_6010", ctx.asOfDate, `${year}-01-01`) : "0.0000";
    const distributions = ctx.ledger.getAccount("3100") ? D(ctx.ledger.accountBalance("acct_3100", ctx.asOfDate, `${year}-01-01`)).abs().toFixed(4) : "0.0000";
    const revenue = ctx.ledger.incomeStatement(`${year}-01-01`, ctx.asOfDate).revenue;
    const proposed = toDec(input.proposedMonthlyGross) ?? (owner && owner.compensation.period === "MONTHLY" && owner.compensation.basis === "GROSS" ? money(owner.compensation.amount) : null);
    const facts = [`Officer compensation posted YTD ${year}: ${officerComp}`, `Shareholder distributions YTD ${year}: ${distributions}`, `Revenue YTD ${year}: ${revenue}`, owner ? `Owner ${owner.displayName}: ${owner.roleTitle}, compensation ${owner.compensation.amount} ${owner.compensation.period} (${owner.compensation.basis}, ${owner.compensation.status})` : "No owner-employee record found"];
    const assumptions: Assumption[] = [];
    const calcs = [];
    const judgment = ["Whether the salary is 'reasonable compensation' for an S-corporation shareholder-employee is a professional judgment for the CPA, based on role, hours, comparable pay, revenue and distributions — this system does not decide it.", "The split between salary and distributions has payroll-tax and basis consequences that the CPA must evaluate."];
    const queue = cpaQueueFor(ctx.dataset);
    if (proposed === null) {
      queue.addUnique({ topic: "reasonable_compensation", question: "Owner compensation level", context: facts.join(" | "), urgency: "HIGH" });
      return ok({
        answer: "I can model an owner salary once you give me a proposed monthly gross; the level itself is a CPA judgment. Here are the facts on record.",
        escalation: esc("CPA_REVIEW_REQUIRED", "Reasonable compensation must be determined with the CPA.", { requiredRole: "CPA", missingItems: ["proposed monthly gross"] }),
        why: facts,
        highRisk: { facts, calculations: ["None — no proposed figure."], assumptions: [], professionalJudgment: judgment },
        confidence: 0.6,
        structured: { value: null, values: { officerCompYtd: officerComp, distributionsYtd: distributions, revenueYtd: revenue }, facts, professionalJudgment: judgment },
      });
    }
    assumptions.push({ key: "owner_salary_proposed", description: `Proposed owner salary ${proposed} gross/month is an ASSUMPTION for modelling only; reasonable compensation requires CPA judgment.`, value: proposed, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true });
    const annual = mul(proposed, 12);
    const annualCalc = makeCalc<DecimalString>({ name: "owner_salary_annual", value: annual, unit: "USD", formula: "proposed_monthly_gross × 12", inputs: { proposedMonthlyGross: proposed }, asOfDate: ctx.asOfDate, assumptions });
    calcs.push(annualCalc);
    const rs = buildRateSet(ctx, input.rateSet, "UNCONFIRMED");
    let taxLine = "Employer payroll taxes: UNKNOWN (no authoritative rates available).";
    let employerTaxes: DecimalString | null = null;
    if (!rs.missingEmployerRates.length) {
      const capped = fullyLoadedCost({ compensation: { type: "SALARY", amount: annual, currency: "USD", period: "ANNUAL", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED" }, rates: rs.rates, benefits: null, overhead: null, asOfDate: ctx.asOfDate });
      const t = capped.value ? capped : employerTaxesUncapped(annual, rs, ctx.asOfDate);
      calcs.push(t);
      employerTaxes = capped.value ? capped.value.employerTaxes : (t.value as DecimalString);
      taxLine = `Employer payroll taxes on ${annual}: ${employerTaxes} (${capped.value ? "wage-base caps applied; " : "uncapped; "}rates ${rs.allConfirmed ? "confirmed" : "supplied/unconfirmed"}).`;
    }
    const totalCost = employerTaxes ? D(annual).plus(D(employerTaxes)).toFixed(4) : null;
    queue.addUnique({ topic: "reasonable_compensation", question: `Is ${proposed}/month (${annual}/year) reasonable compensation for the owner?`, context: facts.join(" | "), urgency: "HIGH" });
    const calcLines = [`Annual salary = ${proposed} × 12 = ${annual} [${annualCalc.id}]`, taxLine, totalCost ? `Total annual employer cost = ${totalCost}` : "Total employer cost: UNKNOWN until rates are confirmed"];
    return ok({
      answer: `Modelled: a proposed owner salary of ${proposed}/month is ${annual}/year${employerTaxes ? `, plus about ${employerTaxes} in employer payroll taxes (${totalCost} total)` : "; employer payroll taxes can't be computed without authoritative rates"}. YTD the books show officer compensation ${officerComp} and distributions ${distributions} on revenue ${revenue}. Whether this level is reasonable compensation is a CPA judgment — I've queued it for review.`,
      escalation: esc("CPA_REVIEW_REQUIRED", "Reasonable compensation for the owner-employee is a professional judgment; the proposed figure is an assumption only.", { requiredRole: "CPA" }),
      numbers: [moneyFigure("Proposed monthly gross (assumption)", proposed), moneyFigure("Annual salary", annual, annualCalc.id), moneyFigure("Employer payroll taxes", employerTaxes, calcs[1]?.id, employerTaxes ? undefined : "INSUFFICIENT_INFORMATION: rates"), moneyFigure("Officer comp YTD", officerComp), moneyFigure("Distributions YTD", distributions)],
      why: facts,
      risks: ["Setting owner salary too low relative to distributions is a known S-corp examination issue; the CPA must document the basis for the level chosen."],
      recommendation: "Send this workpaper to the CPA; do not change payroll until the CPA confirms the compensation level.",
      educationKey: "reasonable_compensation",
      confidence: 0.7,
      highRisk: { facts, calculations: calcLines, assumptions: [`Proposed salary ${proposed}/month (PROFESSIONAL_REVIEW_REQUIRED)`, ...(rs.source === "NONE" ? ["Payroll tax rates unavailable — not assumed"] : rateAssumptions(rs).map((a) => `[${a.status}] ${a.description}`))], professionalJudgment: judgment },
      structured: { value: annual, values: { proposedMonthlyGross: proposed, annualSalary: annual, employerTaxes, totalEmployerCost: totalCost, officerCompYtd: officerComp, distributionsYtd: distributions, revenueYtd: revenue }, facts, professionalJudgment: judgment, cpaQueued: true },
    }, { calcs, assumptions });
  },
});

export const payrollTools = [payrollCalendarTool, reconcileRunTool, employerCostTool, grossToNetTool, payrollLiabilitiesTool, classificationFlagTool, internationalReviewTool, payrollChangeTool, ownerCompensationTool];
export { abs };
