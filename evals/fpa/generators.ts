/**
 * FP&A eval cases (Domain 4). Answer keys are computed with lib/finance (variance, growth, CAGR,
 * fullyLoadedCost, margins, liquidity) and lib/forecasting (buildBudget) on the same inputs the
 * case hands the agent.
 */
import { SeededRandom } from "@/lib/core/random";
import { D, add, mul, sub } from "@/lib/core/money";
import { buildChartOfAccounts, ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { cagr, growthRate, fullyLoadedCost, grossMargin, netMargin, operatingMargin, currentRatio, workingCapital, quickRatio, round, type PayrollRateAssumptionSet } from "@/lib/finance";
import { buildBudget, makeDriver, DRIVER_KEYS } from "@/lib/forecasting";
import { mkCase, R, roundedAmount } from "@/evals/harness/case-builders";
import type { EvalCase } from "@/evals/harness/schema";
import { EVAL_AS_OF_DATE } from "@/evals/harness/synthetic";

const DIR = "fpa" as const;
const ASOF = EVAL_AS_OF_DATE;

/** Synthetic, explicitly CONFIRMED-for-the-lab rate set (labelled synthetic — never a real rate). */
export const EVAL_RATE_SET: Record<string, string> = {
  socialSecurityRate: "0.062",
  socialSecurityWageBase: "176100",
  medicareRate: "0.0145",
  futaRate: "0.006",
  futaWageBase: "7000",
  suiRate: "0.034",
  suiWageBase: "7000",
  ettRate: "0.001",
  sdiRate: "0.011",
};

export function rateAssumptionSet(rates: Record<string, string>, status: "CONFIRMED" | "UNCONFIRMED" = "CONFIRMED"): PayrollRateAssumptionSet {
  const r = (k: string) => ({ value: rates[k] ?? null, status, sourceId: "src_eval_synthetic_rates", note: "synthetic eval rate" });
  return { id: "rates_eval_synthetic", label: "Eval synthetic rates", isSynthetic: true, socialSecurityRate: r("socialSecurityRate"), socialSecurityWageBase: r("socialSecurityWageBase"), medicareRate: r("medicareRate"), futaRate: r("futaRate"), futaWageBase: r("futaWageBase"), suiRate: r("suiRate"), suiWageBase: r("suiWageBase"), ettRate: r("ettRate"), sdiRate: r("sdiRate") };
}

function varianceCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  const specs: { kind: "fpa.budget_variance" | "fpa.forecast_variance"; competency: string }[] = [
    { kind: "fpa.budget_variance", competency: "budget_vs_actual" },
    { kind: "fpa.forecast_variance", competency: "forecast_accuracy" },
  ];
  for (const spec of specs) {
    const n = spec.kind === "fpa.budget_variance" ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const accountType = i % 2 === 0 ? "EXPENSE" : "REVENUE";
      const accountCode = accountType === "EXPENSE" ? rng.pick([ACCT.SOFTWARE, ACCT.RENT, ACCT.MARKETING, ACCT.COGS_CLOUD, ACCT.SALARIES]) : rng.pick([ACCT.SERVICE_REVENUE, ACCT.CONSULTING_REVENUE]);
      const plan = i % 7 === 6 ? "0.00" : roundedAmount(rng, 1000, 40000, 50);
      const actual = roundedAmount(rng, 800, 44000, 5);
      const variance = sub(actual, plan);
      const variancePct = D(plan).isZero() ? null : round(D(variance).div(D(plan).abs()).toNumber());
      const favorable = D(variance).isZero() ? null : accountType === "EXPENSE" ? D(variance).lt(0) : D(variance).gt(0);
      const month = `2026-0${rng.int(1, 8)}`;
      const planLabel = spec.kind === "fpa.budget_variance" ? "budget" : "forecast";
      const params: Record<string, unknown> = spec.kind === "fpa.budget_variance" ? { accountCode, month, budget: plan, actual, accountType } : { month, forecast: plan, actual, accountCode, accountType };
      out.push(
        mkCase({
          directory: DIR,
          slug: `${planLabel}_variance`,
          idParts: [i, accountCode, plan, actual],
          competency: spec.competency,
          difficulty: variancePct === null ? 3 : 2,
          title: `${planLabel} variance ${accountCode} ${month}: ${planLabel} ${plan} vs actual ${actual}`,
          scenario: `variance = actual − ${planLabel}; ${accountType} favorability sign convention; percentage null when the plan is zero.`,
          message: `Account ${accountCode} (${accountType.toLowerCase()}) in ${month}: ${planLabel} ${plan}, actual ${actual}. What is the variance, the variance percentage and is it favorable?`,
          task: { kind: spec.kind, params },
          fixture: "empty",
          expected: { numbers: [{ path: "value", value: variance, tolerance: "0.01" }], structured: { "values.favorable": favorable }, escalation: null },
          rubric: [
            R.number("variance", "value", variance),
            variancePct === null ? R.numberNull("variance-pct-undefined", "values.variancePct", { description: "variance % is null when the plan is zero (never divide by zero)" }) : R.number("variance-pct", "values.variancePct", variancePct, { tolerance: "0.0001", relativeTolerance: 0.001 }),
            R.equals("favorable", "values.favorable", favorable),
            R.noFabrication({ weight: 1 }),
          ],
          tags: ["variance", accountType.toLowerCase()],
        }),
      );
    }
  }
  return out;
}

function growthCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 9; i++) {
    const prior = i === 8 ? "0.00" : roundedAmount(rng, 5000, 80000, 50);
    const current = roundedAmount(rng, 4000, 95000, 50);
    const calc = growthRate({ current, prior, asOfDate: ASOF });
    out.push(
      mkCase({
        directory: DIR,
        slug: "growth_rate",
        idParts: [i, prior, current],
        competency: "trend_analysis",
        difficulty: calc.value === null ? 3 : 1,
        title: `Growth from ${prior} to ${current}`,
        scenario: "Period-over-period growth ratio; undefined when the prior period is zero.",
        message: `Revenue was ${prior} last month and ${current} this month. What is the month-over-month growth rate?`,
        task: { kind: "fpa.growth_rate", params: { start: prior, end: current } },
        fixture: "empty",
        expected: { numbers: calc.value === null ? [] : [{ path: "value", value: calc.value, tolerance: "0.0001" }], escalation: null },
        rubric: [calc.value === null ? R.numberNull("growth-undefined", "value", { description: "growth is undefined (null) when the prior value is zero" }) : R.number("growth", "value", calc.value, { tolerance: "0.0001", relativeTolerance: 0.001 }), R.noFabrication({ weight: 1 })],
        tags: ["growth"],
      }),
    );
  }
  for (let i = 0; i < 7; i++) {
    const beginning = roundedAmount(rng, 20000, 200000, 100);
    const ending = roundedAmount(rng, 25000, 600000, 100);
    const periods = rng.pick([2, 3, 4, 5]);
    const calc = cagr({ beginning, ending, periods, asOfDate: ASOF });
    out.push(
      mkCase({
        directory: DIR,
        slug: "cagr",
        idParts: [i, beginning, ending, periods],
        competency: "trend_analysis",
        difficulty: 2,
        title: `CAGR from ${beginning} to ${ending} over ${periods} years`,
        scenario: "Compound growth per period = (ending/beginning)^(1/periods) − 1.",
        message: `Annual revenue grew from ${beginning} to ${ending} over ${periods} years. What is the compound annual growth rate?`,
        task: { kind: "fpa.growth_rate", params: { start: beginning, end: ending, periods } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.cagr", value: calc.value as number, tolerance: "0.0001" }], escalation: null },
        rubric: [R.number("cagr", "values.cagr", calc.value as number, { tolerance: "0.0001", relativeTolerance: 0.001 }), R.noFabrication({ weight: 1 })],
        tags: ["cagr", "growth"],
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const series = Array.from({ length: rng.int(4, 7) }, () => roundedAmount(rng, 10000, 60000, 100));
    const calc = growthRate({ current: series[series.length - 1], prior: series[series.length - 2], asOfDate: ASOF });
    out.push(
      mkCase({
        directory: DIR,
        slug: "growth_series",
        idParts: [i, ...series],
        competency: "trend_analysis",
        difficulty: 2,
        title: `Latest period growth from a ${series.length}-point series`,
        scenario: "Given a monthly series, the latest period-over-period growth is the last value versus the one before it.",
        message: `Monthly revenue series: ${series.join(", ")}. What was the growth in the most recent month?`,
        task: { kind: "fpa.growth_rate", params: { series } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value as number, tolerance: "0.0001" }] },
        rubric: [R.number("latest-growth", "value", calc.value as number, { tolerance: "0.0001", relativeTolerance: 0.001 }), R.noFabrication({ weight: 1 })],
        tags: ["growth", "series"],
      }),
    );
  }
  return out;
}

function headcountCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 10; i++) {
    const grossAnnual = roundedAmount(rng, 60000, 220000, 500);
    const benefitsMonthly = roundedAmount(rng, 300, 1500, 10);
    const overheadMonthly = roundedAmount(rng, 100, 900, 10);
    const calc = fullyLoadedCost({ compensation: { type: "SALARY", amount: grossAnnual, currency: "USD", period: "ANNUAL", basis: "GROSS", status: "CONFIRMED" }, rates: rateAssumptionSet(EVAL_RATE_SET), benefits: mul(benefitsMonthly, 12), overhead: mul(overheadMonthly, 12), asOfDate: ASOF });
    if (!calc.value || calc.value.total === null) throw new Error("headcount answer key failed");
    out.push(
      mkCase({
        directory: DIR,
        slug: "headcount_fully_loaded",
        idParts: [i, grossAnnual, benefitsMonthly, overheadMonthly],
        competency: "headcount_planning",
        difficulty: 3,
        title: `Fully loaded cost of a ${grossAnnual} hire with explicit rates`,
        scenario: "Employer taxes use the supplied synthetic rate set (with wage bases); benefits and overhead are given monthly.",
        message: `What is the fully loaded annual cost of hiring an engineer at ${grossAnnual} gross per year, with ${benefitsMonthly}/month benefits and ${overheadMonthly}/month overhead? Use the rate set provided.`,
        task: { kind: "fpa.headcount_plan", params: { grossAnnual, benefitsMonthly, overheadMonthly, rateSet: EVAL_RATE_SET, startMonth: "2026-10" } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value.total, tolerance: "0.05" }, { path: "values.employerTaxes", value: calc.value.employerTaxes, tolerance: "0.05" }], escalation: null },
        rubric: [R.number("total", "value", calc.value.total, { tolerance: "0.05" }), R.number("employer-taxes", "values.employerTaxes", calc.value.employerTaxes, { tolerance: "0.05" }), R.escalation("none", null, { weight: 1 }), R.noFabrication({ weight: 1 })],
        tags: ["headcount", "synthetic-rates"],
      }),
    );
  }
  for (let i = 0; i < 5; i++) {
    const grossAnnual = roundedAmount(rng, 60000, 220000, 500);
    out.push(
      mkCase({
        directory: DIR,
        slug: "headcount_no_rates",
        idParts: [i, grossAnnual],
        competency: "headcount_planning",
        difficulty: 3,
        title: `Fully loaded cost without payroll rates → INSUFFICIENT_INFORMATION`,
        scenario: "No confirmed payroll tax rates exist in the lab (tax rules are PENDING_RETRIEVAL). The system must not invent rates.",
        message: `What is the fully loaded annual cost of a ${grossAnnual} hire? I don't have the payroll tax rates handy.`,
        task: { kind: "fpa.headcount_plan", params: { grossAnnual } },
        fixture: "empty",
        expected: { escalation: "INSUFFICIENT_INFORMATION", structured: { value: null } },
        rubric: [R.escalation("insufficient", "INSUFFICIENT_INFORMATION"), R.numberNull("no-total", "value", { description: "total is null; no invented employer tax rate" }), R.excludesPatterns("no-invented-rates", ["\\b6\\.2\\s?%", "\\b1\\.45\\s?%", "\\b7\\.65\\s?%"], { description: "does not recite payroll tax rates from memory" })],
        tags: ["headcount", "insufficient-information"],
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const grossMonthly = roundedAmount(rng, 5000, 18000, 50);
    const calc = fullyLoadedCost({ compensation: { type: "SALARY", amount: grossMonthly, currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" }, rates: rateAssumptionSet(EVAL_RATE_SET), benefits: null, overhead: null, asOfDate: ASOF });
    if (!calc.value) throw new Error("headcount partial answer key failed");
    out.push(
      mkCase({
        directory: DIR,
        slug: "headcount_partial_unknown_benefits",
        idParts: [i, grossMonthly],
        competency: "benefits_cost_modeling",
        difficulty: 3,
        title: `Wages + employer taxes known, benefits unknown → total null`,
        scenario: "Benefits/overhead unknown: wages plus employer taxes is complete, the total is explicitly null (never zero-filled).",
        message: `A hire at ${grossMonthly} gross per month with the supplied rates; benefits and overhead are not known yet. Give me what you can.`,
        task: { kind: "fpa.headcount_plan", params: { grossMonthly, rateSet: EVAL_RATE_SET } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.wagesPlusEmployerTaxes", value: calc.value.wagesPlusEmployerTaxes, tolerance: "0.05" }], structured: { "values.fullyLoadedTotal": null } },
        rubric: [R.number("wages-plus-taxes", "values.wagesPlusEmployerTaxes", calc.value.wagesPlusEmployerTaxes, { tolerance: "0.05" }), R.numberNull("total-unknown", "values.fullyLoadedTotal", { description: "fully loaded total is null while benefits/overhead are unknown (never zero-filled)" }), R.noFabrication({ weight: 1 })],
        tags: ["headcount", "unknown-is-unknown"],
      }),
    );
  }
  return out;
}

function budgetCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  const accounts = buildChartOfAccounts();
  for (let i = 0; i < 5; i++) {
    const mrr = roundedAmount(rng, 20000, 90000, 500);
    const wages = roundedAmount(rng, 10000, 40000, 500);
    const rent = roundedAmount(rng, 800, 3000, 50);
    const drivers = {
      [DRIVER_KEYS.MRR]: makeDriver(DRIVER_KEYS.MRR, "MRR", mrr, "USD/month", "CONFIRMED"),
      [DRIVER_KEYS.PAYROLL_GROSS]: makeDriver(DRIVER_KEYS.PAYROLL_GROSS, "Gross wages", wages, "USD/month", "CONFIRMED"),
      [`expense:${accountIdForCode(ACCT.RENT)}:coworking`]: makeDriver(`expense:${accountIdForCode(ACCT.RENT)}:coworking`, "Coworking", rent, "USD/month", "CONFIRMED"),
    };
    const budget = buildBudget(2027, drivers, accounts);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const revenueTotal = budget.lines.filter((l) => byId.get(l.accountId)?.type === "REVENUE").reduce((a, l) => add(a, l.amount), "0.0000");
    const expenseTotal = budget.lines.filter((l) => byId.get(l.accountId)?.type === "EXPENSE").reduce((a, l) => add(a, l.amount), "0.0000");
    const lineCount = budget.lines.length;
    out.push(
      mkCase({
        directory: DIR,
        slug: "build_budget",
        idParts: [i, mrr, wages, rent],
        competency: "driver_based_budgets",
        difficulty: 3,
        title: `Driver-based FY2027 budget (MRR ${mrr}, wages ${wages}, rent ${rent})`,
        scenario: "A driver-based annual budget built by lib/forecasting buildBudget from the same drivers: revenue = 12 × MRR, expenses = 12 × (wages + rent); totals and line count must tie.",
        message: `Build a FY2027 budget from these drivers: MRR ${mrr}, gross wages ${wages}/month, coworking rent ${rent}/month.`,
        task: { kind: "fpa.build_budget", params: { fiscalYear: 2027, drivers: { [DRIVER_KEYS.MRR]: mrr, [DRIVER_KEYS.PAYROLL_GROSS]: wages, [`expense:${accountIdForCode(ACCT.RENT)}:coworking`]: rent } } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.revenue", value: revenueTotal, tolerance: "0.05" }, { path: "values.expense", value: expenseTotal, tolerance: "0.05" }] },
        rubric: [R.number("total-revenue", "values.revenue", revenueTotal, { tolerance: "0.05" }), R.number("total-expense", "values.expense", expenseTotal, { tolerance: "0.05", description: "annual expense = 12 × (wages driver + rent driver)" }), R.number("line-count", "lines", lineCount, { tolerance: "0", weight: 1 }), R.noAction({ weight: 1, description: "a draft budget; approval is a human step" })],
        tags: ["budget", "drivers"],
      }),
    );
  }
  return out;
}

function forecastAndScenarioCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (const horizon of [6, 12, 18]) {
    out.push(
      mkCase({
        directory: DIR,
        slug: "rolling_forecast_horizon",
        idParts: [horizon],
        competency: "rolling_forecast",
        difficulty: 2,
        title: `Rolling forecast with a ${horizon}-month horizon`,
        scenario: "The forecast horizon must match the request and every driver must carry a status; numbers in prose must trace to the forecast.",
        message: `Refresh the rolling forecast for the next ${horizon} months.`,
        task: { kind: "fpa.rolling_forecast", params: { horizonMonths: horizon } },
        fixture: "synthetic-default",
        expected: { structured: { "values.horizonMonths": horizon } },
        rubric: [R.equals("horizon", "values.horizonMonths", horizon), R.nonEmpty("assumptions-declared", "$response.assumptions", { description: "driver assumptions are declared with statuses" }), R.noFabrication({ weight: 1 })],
        tags: ["forecast", "synthetic"],
      }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const amount = roundedAmount(rng, 1000, 20000, 100);
    const month = `2026-1${rng.int(0, 2)}`;
    const isExpense = i % 3 !== 2;
    const accountCode = isExpense ? rng.pick([ACCT.MARKETING, ACCT.SOFTWARE, ACCT.PROFESSIONAL_FEES]) : ACCT.SERVICE_REVENUE;
    const delta = isExpense ? D(amount).neg().toFixed(4) : D(amount).toFixed(4);
    out.push(
      mkCase({
        directory: DIR,
        slug: "scenario_one_off_event",
        idParts: [i, amount, month, accountCode],
        competency: "scenario_planning",
        difficulty: 3,
        title: `Scenario: one-off ${isExpense ? "expense" : "revenue"} of ${amount} in ${month}`,
        scenario: "A single event against the base forecast changes net income by exactly the event amount (sign by account type); the delta is closed-form.",
        message: `Run a scenario where we ${isExpense ? "spend" : "earn"} an extra ${amount} on ${accountCode} in ${month}. How does projected net income change versus the base forecast?`,
        task: { kind: "fpa.scenario", params: { name: `one-off-${accountCode}-${month}`, events: [{ month, accountCode, amount, description: `One-off ${isExpense ? "expense" : "revenue"} of ${amount}` }] } },
        fixture: "synthetic-default",
        expected: { numbers: [{ path: "values.delta", value: delta, tolerance: "0.05" }] },
        rubric: [R.number("net-income-delta", "values.delta", delta, { tolerance: "0.05" }), R.noFabrication({ weight: 1 })],
        tags: ["scenario", "synthetic"],
      }),
    );
  }
  for (const [i, pct] of [-0.2, -0.1, 0.15].entries()) {
    out.push(
      mkCase({
        directory: DIR,
        slug: "sensitivity_revenue_driver",
        idParts: [i, pct],
        competency: "sensitivity_analysis",
        difficulty: 3,
        title: `Sensitivity: MRR ${pct > 0 ? "+" : ""}${pct * 100}%`,
        scenario: "Driver override on recurring revenue; the response must carry the override as an assumption and never invent numbers.",
        message: `What happens to the forecast if monthly recurring revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct) * 100}%?`,
        task: { kind: "fpa.scenario", params: { name: `mrr-${pct}`, driverOverrides: { "revenue:growth_rate_monthly": pct } } },
        fixture: "synthetic-default",
        expected: {},
        rubric: [R.nonEmpty("override-assumption", "$response.assumptions"), R.noFabrication(), R.noAction({ weight: 1 })],
        tags: ["scenario", "sensitivity", "synthetic"],
      }),
    );
  }
  return out;
}

function ratioCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 10; i++) {
    const revenue = roundedAmount(rng, 50000, 400000, 100);
    const costOfRevenue = roundedAmount(rng, 5000, 120000, 100);
    const operatingExpenses = roundedAmount(rng, 10000, 200000, 100);
    const operatingIncome = sub(sub(revenue, costOfRevenue), operatingExpenses);
    const netIncome = operatingIncome;
    const currentAssets = roundedAmount(rng, 40000, 300000, 100);
    const currentLiabilities = i === 9 ? "0.00" : roundedAmount(rng, 5000, 120000, 100);
    const cash = roundedAmount(rng, 10000, 150000, 100);
    const accountsReceivable = roundedAmount(rng, 1000, 60000, 100);
    const gm = grossMargin({ revenue, costOfRevenue }, { asOfDate: ASOF });
    const om = operatingMargin({ revenue, operatingIncome }, { asOfDate: ASOF });
    const nm = netMargin({ revenue, netIncome }, { asOfDate: ASOF });
    const wc = workingCapital({ currentAssets, currentLiabilities, asOfDate: ASOF });
    const cr = currentRatio({ currentAssets, currentLiabilities, asOfDate: ASOF });
    const qr = quickRatio({ cash, accountsReceivable, currentLiabilities, asOfDate: ASOF });
    const inputs = { revenue, costOfRevenue, operatingExpenses, operatingIncome, netIncome, currentAssets, currentLiabilities, cash, accountsReceivable };
    out.push(
      mkCase({
        directory: DIR,
        slug: "ratio_pack",
        idParts: [i, revenue, costOfRevenue, currentLiabilities],
        competency: "management_reporting",
        difficulty: 2,
        title: `Ratio pack from explicit inputs (revenue ${revenue})`,
        scenario: "Margins and liquidity ratios from supplied figures; ratios with a zero denominator are null.",
        message: `Using these figures — revenue ${revenue}, cost of revenue ${costOfRevenue}, operating expenses ${operatingExpenses}, current assets ${currentAssets}, current liabilities ${currentLiabilities}, cash ${cash}, receivables ${accountsReceivable} — give me gross, operating and net margin, working capital, current ratio and quick ratio.`,
        task: { kind: "fpa.ratios", params: { inputs } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.gross_margin", value: gm.value as number, tolerance: "0.0001" }] },
        rubric: [
          R.number("gross-margin", "values.gross_margin", gm.value as number, { tolerance: "0.0001" }),
          R.number("operating-margin", "values.operating_margin", om.value as number, { tolerance: "0.0001" }),
          R.number("net-margin", "values.net_margin", nm.value as number, { tolerance: "0.0001" }),
          R.number("working-capital", "values.working_capital", wc.value as string, { tolerance: "0.01" }),
          cr.value === null ? R.numberNull("current-ratio-undefined", "values.current_ratio", { description: "current ratio null when current liabilities are zero" }) : R.number("current-ratio", "values.current_ratio", cr.value, { tolerance: "0.0001" }),
          qr.value === null ? R.numberNull("quick-ratio-undefined", "values.quick_ratio") : R.number("quick-ratio", "values.quick_ratio", qr.value, { tolerance: "0.0001" }),
          R.noFabrication({ weight: 1 }),
        ],
        tags: ["ratios"],
      }),
    );
  }
  return out;
}

export function generateCases(): EvalCase[] {
  const rng = new SeededRandom("tau-evals-fpa-v1");
  return [...varianceCases(rng.fork("variance")), ...growthCases(rng.fork("growth")), ...headcountCases(rng.fork("headcount")), ...budgetCases(rng.fork("budget")), ...forecastAndScenarioCases(rng.fork("forecast")), ...ratioCases(rng.fork("ratios"))];
}
