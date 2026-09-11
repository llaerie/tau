/**
 * FP&A tools: budget/forecast variance, rolling forecast, budget build, scenarios, growth,
 * headcount cost, ratio pack and profitability by customer / month / account.
 */
import type { ToolContext } from "@/lib/core/contracts";
import type { Budget, CalcResult, DecimalString, Forecast, Scenario } from "@/lib/core/types";
import { accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { daysBetween, monthEnd, monthKey } from "@/lib/core/dates";
import { D, money, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { fullyLoadedCost } from "@/lib/finance/headcount";
import { currentRatio, quickRatio, workingCapital } from "@/lib/finance/cash";
import { ratioPack } from "@/lib/finance/ratios";
import { budgetVariance, cagr, forecastVariance, growthRate, type VarianceReport } from "@/lib/finance/variance";
import { actualsByAccountMonth, buildBudget } from "@/lib/forecasting/budget";
import { buildDefaultDrivers, makeDriver, type DriverSet } from "@/lib/forecasting/drivers";
import { applyScenario, rollingForecast } from "@/lib/forecasting/forecast";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { figure, insufficient, moneyFigure, ok, pct, propose, textFigure, toDec } from "./common";
import { buildRateSet, rateAssumptions } from "./payroll-tools";

function simpleVariance(ctx: ToolContext, label: string, plan: DecimalString, actual: DecimalString, accountType: "REVENUE" | "EXPENSE" | undefined, month?: string) {
  const variance = sub(actual, plan);
  const pctv = D(plan).isZero() ? null : D(variance).div(D(plan).abs()).toNumber();
  const favorable = D(variance).isZero() ? null : accountType === "REVENUE" ? D(variance).gt(0) : accountType === "EXPENSE" ? D(variance).lt(0) : null;
  const flagged = pctv !== null ? Math.abs(pctv) > ctx.thresholds.varianceRatio : !D(variance).isZero();
  const calc = makeCalc<DecimalString>({ name: `${label}_variance`, value: variance, unit: "USD", formula: "variance = actual - plan; variance_pct = variance / |plan|; REVENUE favorable when actual > plan, EXPENSE favorable when actual < plan", inputs: { plan, actual, accountType: accountType ?? null, month: month ?? null }, asOfDate: ctx.asOfDate });
  return { calc, variance, pct: pctv, favorable, flagged };
}

function reportPresentation(ctx: ToolContext, calc: CalcResult<VarianceReport>, kind: "budget" | "forecast", accountCode?: string, month?: string) {
  const r = calc.value;
  const rows = r.rows.filter((row) => (!accountCode || row.accountCode === accountCode) && (!month || row.month === month));
  const flagged = rows.filter((row) => row.flagged);
  const totalActual = rows.reduce((a, row) => a.plus(D(row.actual)), D(0)).toFixed(4);
  const totalPlan = rows.reduce((a, row) => a.plus(D(row.budget)), D(0)).toFixed(4);
  const totalVar = sub(totalActual, totalPlan);
  return ok({
    answer: `${kind === "budget" ? "Budget" : "Forecast"} vs actual${month ? ` for ${month}` : ""}${accountCode ? ` on ${accountCode}` : ""}: actual ${totalActual} vs plan ${totalPlan} (variance ${totalVar}); ${flagged.length} line(s) exceed the ${pct(ctx.thresholds.varianceRatio, 0)} materiality threshold.`,
    numbers: [moneyFigure("Actual", totalActual), moneyFigure("Plan", totalPlan), moneyFigure("Variance", totalVar, calc.id), textFigure("Flagged lines", flagged.length)],
    why: flagged.slice(0, 8).map((row) => `${row.accountCode ?? row.accountId} ${row.accountName ?? ""} ${row.month}: actual ${row.actual} vs plan ${row.budget} (${row.variancePct === null ? "n/a" : pct(row.variancePct)}) — ${row.favorable === null ? "n/a" : row.favorable ? "favorable" : "unfavorable"}${row.flagReasons.length ? `; ${row.flagReasons.join(", ")}` : ""}`),
    risks: flagged.filter((row) => row.favorable === false).length ? [`${flagged.filter((row) => row.favorable === false).length} unfavorable material variance(s).`] : [],
    educationKey: "budget_variance",
    confidence: 0.85,
    structured: { value: totalVar, values: { actual: totalActual, plan: totalPlan, variance: totalVar, flagged: flagged.length }, rows, byAccount: r.byAccount, byMonth: r.byMonth },
  }, { calcs: [calc] });
}

export const budgetVarianceTool = defineTool({
  name: "budget_variance",
  description: "Budget vs actual variance for a month/account or the whole company (or explicit budget/actual numbers).",
  riskLevel: "GREEN",
  capabilityKey: "variance_analysis",
  inputSchema: TASKS["fpa.budget_variance"].params,
  async execute(input, ctx) {
    if (input.budget !== undefined && input.actual !== undefined) {
      const v = simpleVariance(ctx, "budget", money(input.budget), money(input.actual), input.accountType, input.month);
      return ok({ answer: `Actual ${money(input.actual)} vs budget ${money(input.budget)}: variance ${v.variance}${v.pct === null ? "" : ` (${pct(v.pct)})`}, ${v.favorable === null ? "favorability undefined without an account type" : v.favorable ? "favorable" : "unfavorable"}${v.flagged ? " — exceeds the materiality threshold" : ""}.`, numbers: [moneyFigure("Actual", money(input.actual)), moneyFigure("Budget", money(input.budget)), figure("Variance", v.calc), textFigure("Variance %", v.pct === null ? "n/a" : pct(v.pct))], educationKey: "budget_variance", confidence: 0.95, structured: { value: v.variance, values: { actual: money(input.actual), budget: money(input.budget), variance: v.variance, variancePct: v.pct, favorable: v.favorable, flagged: v.flagged } } }, { calcs: [v.calc] });
    }
    const budget: Budget | undefined = [...ctx.dataset.budgets].sort((a, b) => (a.status === "APPROVED" ? -1 : 1) - (b.status === "APPROVED" ? -1 : 1) || b.version - a.version)[0];
    if (!budget) return ok(insufficient(["an approved budget (or explicit budget and actual amounts)"], "There is no budget on record to compare against."));
    const months = input.month ? [input.month] : [...new Set(budget.lines.map((l) => l.month))].sort().filter((m) => m <= monthKey(ctx.asOfDate));
    const from = `${months[0] ?? monthKey(ctx.asOfDate)}-01`;
    const to = monthEnd(`${months[months.length - 1] ?? monthKey(ctx.asOfDate)}-01`);
    const actuals = actualsByAccountMonth(ctx.dataset, from, to);
    const calc = budgetVariance(actuals, budget, { accounts: ctx.dataset.accounts, materialityRatio: ctx.thresholds.varianceRatio, materialityAmount: ctx.thresholds.forecastChangeAmount, months, asOfDate: ctx.asOfDate });
    return reportPresentation(ctx, calc, "budget", input.accountCode, input.month);
  },
});

export const forecastVarianceTool = defineTool({
  name: "forecast_variance",
  description: "Forecast vs actual variance for a month (or explicit forecast/actual numbers).",
  riskLevel: "GREEN",
  capabilityKey: "variance_analysis",
  inputSchema: TASKS["fpa.forecast_variance"].params,
  async execute(input, ctx) {
    if (input.forecast !== undefined && input.actual !== undefined) {
      const v = simpleVariance(ctx, "forecast", money(input.forecast), money(input.actual), input.accountType, input.month);
      return ok({ answer: `Actual ${money(input.actual)} vs forecast ${money(input.forecast)} for ${input.month}: variance ${v.variance}${v.pct === null ? "" : ` (${pct(v.pct)})`}, ${v.favorable === null ? "favorability undefined" : v.favorable ? "favorable" : "unfavorable"}.`, numbers: [moneyFigure("Actual", money(input.actual)), moneyFigure("Forecast", money(input.forecast)), figure("Variance", v.calc)], confidence: 0.95, structured: { value: v.variance, values: { actual: money(input.actual), forecast: money(input.forecast), variance: v.variance, variancePct: v.pct, favorable: v.favorable, flagged: v.flagged } } }, { calcs: [v.calc] });
    }
    const forecast: Forecast | undefined = ctx.dataset.forecasts.find((f) => f.status === "ACTIVE") ?? [...ctx.dataset.forecasts].sort((a, b) => b.version - a.version)[0];
    if (!forecast) return ok(insufficient(["an active forecast (or explicit forecast and actual amounts)"], "There is no forecast on record to compare against."));
    const actuals = actualsByAccountMonth(ctx.dataset, `${input.month}-01`, monthEnd(`${input.month}-01`));
    const calc = forecastVariance(actuals, forecast, { accounts: ctx.dataset.accounts, materialityRatio: ctx.thresholds.varianceRatio, materialityAmount: ctx.thresholds.forecastChangeAmount, months: [input.month], asOfDate: ctx.asOfDate });
    return reportPresentation(ctx, calc, "forecast", input.accountCode, input.month);
  },
});

function driverOverrides(base: DriverSet, overrides: Record<string, string | number> | undefined): DriverSet {
  const out: DriverSet = { ...base };
  for (const [k, v] of Object.entries(overrides ?? {})) out[k] = makeDriver(k, base[k]?.label ?? k, v, base[k]?.unit ?? "USD/month", "UNCONFIRMED", { note: "ASSUMED: override supplied with the request" });
  return out;
}

export const rollingForecastTool = defineTool({
  name: "rolling_forecast",
  description: "Build/refresh the driver-based rolling forecast (proposes UPDATE_FORECAST).",
  riskLevel: "GREEN",
  capabilityKey: "rolling_forecast",
  inputSchema: TASKS["fpa.rolling_forecast"].params,
  async execute(input, ctx) {
    const base = buildDefaultDrivers(ctx.dataset, ctx.asOfDate);
    const drivers = driverOverrides(base.drivers, input.driverOverrides);
    if (!Object.keys(drivers).length) return ok(insufficient(["revenue, payroll or recurring expense history"], "No drivers could be derived from history and none were supplied."));
    const horizon = input.horizonMonths ?? 12;
    const { forecast, calcs } = rollingForecast(ctx.dataset, ctx.asOfDate, horizon, drivers);
    const s = calcs[0].value;
    const active = ctx.dataset.forecasts.find((f) => f.status === "ACTIVE");
    const activeNet = active ? active.lines.filter((l) => l.basis === "FORECAST").reduce((acc, l) => acc.plus(ctx.dataset.accounts.find((a) => a.id === l.accountId)?.type === "REVENUE" ? D(l.amount) : D(l.amount).neg()), D(0)) : null;
    const change = activeNet ? D(s.totalForecastNet).minus(activeNet) : null;
    const material = change ? change.abs().gte(D(ctx.thresholds.forecastChangeAmount)) || (activeNet && !activeNet.isZero() ? change.abs().div(activeNet.abs()).toNumber() > ctx.thresholds.forecastChangeRatio : false) : false;
    const action = propose(ctx, { kind: "UPDATE_FORECAST", description: `Activate rolling forecast ${forecast.name} (${horizon} months)`, reason: "Refreshed from current drivers.", payload: { forecast, calcIds: forecast.calcIds }, context: { isMaterialForecastChange: Boolean(material) }, confidence: 0.75 });
    return ok({
      answer: `Rolling ${horizon}-month forecast from ${ctx.asOfDate}: revenue ${s.totalForecastRevenue}, expenses ${s.totalForecastExpense}, net ${s.totalForecastNet} over ${s.forecastMonths.length} forecast month(s)${change ? ` (${change.toFixed(4)} vs the active forecast${material ? ", material" : ""})` : ""}. Drivers: ${Object.values(drivers).slice(0, 5).map((d) => `${d.label} ${d.value} [${d.status}]`).join("; ")}.`,
      numbers: [moneyFigure("Forecast revenue", s.totalForecastRevenue, calcs[0].id), moneyFigure("Forecast expenses", s.totalForecastExpense), moneyFigure("Forecast net", s.totalForecastNet), textFigure("Forecast months", s.forecastMonths.length)],
      why: [...base.notes, ...Object.values(drivers).filter((d) => d.status !== "CONFIRMED").slice(0, 6).map((d) => `[${d.status}] ${d.label}: ${d.value} — ${d.note ?? ""}`)],
      risks: material ? ["Material change versus the active forecast; review before activating."] : [],
      confidence: 0.75,
      structured: { value: s.totalForecastNet, values: { totalForecastRevenue: s.totalForecastRevenue, totalForecastExpense: s.totalForecastExpense, totalForecastNet: s.totalForecastNet, horizonMonths: horizon }, months: s.months, drivers: Object.values(drivers).map((d) => ({ key: d.key, value: d.value, status: d.status })), forecastId: forecast.id },
    }, { calcs, proposedActions: [action], assumptions: base.assumptions });
  },
});

export const buildBudgetTool = defineTool({
  name: "build_budget",
  description: "Build a driver-based annual budget (DRAFT).",
  riskLevel: "GREEN",
  capabilityKey: "budgeting",
  inputSchema: TASKS["fpa.build_budget"].params,
  async execute(input, ctx) {
    const base = buildDefaultDrivers(ctx.dataset, ctx.asOfDate);
    const drivers = driverOverrides(base.drivers, input.drivers);
    if (!Object.keys(drivers).length) return ok(insufficient(["drivers (revenue, payroll, recurring expenses)"], "No drivers are available to build a budget."));
    const budget = buildBudget(input.fiscalYear, drivers, ctx.dataset.accounts, { workers: ctx.dataset.workers });
    const type = new Map(ctx.dataset.accounts.map((a) => [a.id, a.type]));
    let rev = D(0);
    let exp = D(0);
    for (const l of budget.lines) {
      if (type.get(l.accountId) === "REVENUE") rev = rev.plus(D(l.amount));
      else if (type.get(l.accountId) === "EXPENSE") exp = exp.plus(D(l.amount));
    }
    const calc = makeCalc<DecimalString>({ name: "budget_net", value: rev.minus(exp).toFixed(4), unit: "USD", formula: "sum(budget revenue lines) - sum(budget expense lines)", inputs: { fiscalYear: input.fiscalYear, revenue: rev.toFixed(4), expense: exp.toFixed(4), lineCount: budget.lines.length }, asOfDate: ctx.asOfDate, assumptions: budget.assumptions });
    return ok({
      answer: `Draft FY${input.fiscalYear} budget: revenue ${rev.toFixed(4)}, expenses ${exp.toFixed(4)}, net ${calc.value} across ${budget.lines.length} account-month lines, built from ${Object.keys(drivers).length} driver(s).`,
      numbers: [moneyFigure("Budget revenue", rev.toFixed(4)), moneyFigure("Budget expenses", exp.toFixed(4)), moneyFigure("Budget net", calc.value, calc.id)],
      why: budget.assumptions.slice(0, 8).map((a) => `[${a.status}] ${a.description}`),
      confidence: 0.75,
      structured: { value: calc.value, values: { revenue: rev.toFixed(4), expense: exp.toFixed(4), net: calc.value }, budgetId: budget.id, lines: budget.lines.length },
    }, { calcs: [calc], assumptions: budget.assumptions });
  },
});

export const scenarioTool = defineTool({
  name: "forecast_scenario",
  description: "Run a what-if scenario (driver overrides and one-off events) against the base forecast.",
  riskLevel: "GREEN",
  capabilityKey: "scenario_analysis",
  inputSchema: TASKS["fpa.scenario"].params,
  async execute(input, ctx) {
    let base = ctx.dataset.forecasts.find((f) => f.status === "ACTIVE");
    let baseCalcs: CalcResult[] = [];
    if (!base) {
      const d = buildDefaultDrivers(ctx.dataset, ctx.asOfDate);
      if (!Object.keys(d.drivers).length) return ok(insufficient(["a base forecast or history to derive one"], "No base forecast exists and none can be derived."));
      const built = rollingForecast(ctx.dataset, ctx.asOfDate, 12, d.drivers);
      base = built.forecast;
      baseCalcs = built.calcs;
    }
    const scenario: Scenario = { id: `scn_${input.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`, name: input.name, description: input.name, baseForecastId: base.id, driverOverrides: input.driverOverrides ?? {}, events: (input.events ?? []).map((e) => ({ month: e.month, accountId: accountIdForCode(e.accountCode), amount: money(e.amount), description: e.description })), createdAt: `${ctx.asOfDate}T00:00:00.000Z`, createdBy: ctx.actor.id };
    const { forecast, calcs } = applyScenario(base, scenario, ctx.dataset.accounts);
    const s = calcs[0].value;
    const baseSummary = baseCalcs[0]?.value as typeof s | undefined;
    const baseNet = baseSummary?.totalForecastNet ?? base.lines.filter((l) => l.basis === "FORECAST").reduce((acc, l) => acc.plus(ctx.dataset.accounts.find((a) => a.id === l.accountId)?.type === "REVENUE" ? D(l.amount) : D(l.amount).neg()), D(0)).toFixed(4);
    const delta = sub(s.totalForecastNet, baseNet);
    return ok({
      answer: `Scenario "${input.name}": forecast net ${s.totalForecastNet} vs base ${baseNet} (${delta}); revenue ${s.totalForecastRevenue}, expenses ${s.totalForecastExpense} over ${s.forecastMonths.length} month(s).`,
      numbers: [moneyFigure("Scenario net", s.totalForecastNet, calcs[0].id), moneyFigure("Base net", baseNet), moneyFigure("Delta", delta), moneyFigure("Scenario revenue", s.totalForecastRevenue), moneyFigure("Scenario expenses", s.totalForecastExpense)],
      why: [...Object.entries(scenario.driverOverrides).map(([k, v]) => `Driver override ${k} = ${v}`), ...scenario.events.map((e) => `Event ${e.month} ${e.description}: ${e.amount}`)],
      confidence: 0.7,
      structured: { value: s.totalForecastNet, values: { scenarioNet: s.totalForecastNet, baseNet, delta, scenarioRevenue: s.totalForecastRevenue, scenarioExpense: s.totalForecastExpense }, months: s.months, forecastId: forecast.id },
    }, { calcs: [...baseCalcs, ...calcs] });
  },
});

export const growthRateTool = defineTool({
  name: "growth_rate",
  description: "Period-over-period growth and compound growth (CAGR) for a series or start/end values.",
  riskLevel: "GREEN",
  capabilityKey: "variance_analysis",
  inputSchema: TASKS["fpa.growth_rate"].params,
  async execute(input, ctx) {
    const series = (input.series ?? []).map((v) => money(v));
    const start = toDec(input.start) ?? series[0] ?? null;
    const end = toDec(input.end) ?? series[series.length - 1] ?? null;
    if (start === null || end === null) return ok(insufficient(["start and end values (or a series)"], "I need at least two values to compute growth."));
    const periods = input.periods ?? Math.max(1, series.length - 1);
    const g = growthRate({ current: end, prior: start, asOfDate: ctx.asOfDate });
    const c = cagr({ beginning: start, ending: end, periods, asOfDate: ctx.asOfDate });
    const stepwise = series.length > 1 ? series.slice(1).map((v, i) => growthRate({ current: v, prior: series[i], asOfDate: ctx.asOfDate, label: `period ${i + 1}→${i + 2}` })) : [];
    return ok({
      answer: `From ${start} to ${end}: total growth ${g.value === null ? "undefined" : pct(g.value, 2)}${periods > 1 ? `; compound growth per period over ${periods} periods ${c.value === null ? "undefined" : pct(c.value, 2)}` : ""}.`,
      numbers: [figure("Total growth", g), figure(`CAGR (${periods} periods)`, c), ...stepwise.map((s, i) => figure(`Growth period ${i + 1}`, s))],
      confidence: 0.95,
      structured: { value: g.value, values: { growthRate: g.value, cagr: c.value, periods, start, end }, stepwise: stepwise.map((s) => s.value) },
    }, { calcs: [g, c, ...stepwise] });
  },
});

export const headcountPlanTool = defineTool({
  name: "headcount_plan",
  description: "Fully loaded cost of a hire (gross + employer taxes + benefits + overhead) using provided or confirmed rates.",
  riskLevel: "GREEN",
  capabilityKey: "hiring_analysis",
  inputSchema: TASKS["fpa.headcount_plan"].params,
  async execute(input, ctx) {
    const annual = toDec(input.grossAnnual) ?? (input.grossMonthly !== undefined ? D(input.grossMonthly).times(12).toFixed(4) : null);
    if (annual === null) return ok(insufficient(["gross annual or monthly salary"], "Tell me the gross salary for the role."));
    const rs = buildRateSet(ctx, input.rateSet, "UNCONFIRMED");
    const benefits = input.benefitsMonthly === undefined ? null : D(input.benefitsMonthly).times(12).toFixed(4);
    const overhead = input.overheadMonthly === undefined ? null : D(input.overheadMonthly).times(12).toFixed(4);
    const calc = fullyLoadedCost({ compensation: { type: "SALARY", amount: annual, currency: "USD", period: "ANNUAL", basis: "GROSS", status: "UNCONFIRMED" }, rates: rs.rates, benefits, overhead, asOfDate: ctx.asOfDate });
    if (calc.value === null) {
      const missing = calc.assumptions.filter((a) => a.key.startsWith("missing:")).map((a) => a.description);
      return ok({ ...insufficient(missing, `Gross salary ${annual}/year is known, but the fully loaded cost is null: ${missing.join("; ")}. Payroll tax rates must come from an authoritative source or be supplied explicitly.`, { numbers: [moneyFigure("Gross annual", annual)], structured: { values: { grossAnnual: annual }, rateSource: rs.source } }) }, { calcs: [calc], assumptions: rateAssumptions(rs) });
    }
    const v = calc.value;
    const monthly = v.total ? D(v.total).div(12).toFixed(4) : D(v.wagesPlusEmployerTaxes).div(12).toFixed(4);
    return ok({
      answer: `A ${annual}/year hire costs ${v.wagesPlusEmployerTaxes} in wages plus employer taxes (${v.employerTaxes}, effective ${pct(v.employerTaxRate, 2)})${v.total ? `, and ${v.total} fully loaded with benefits ${v.benefits} and overhead ${v.overhead}` : "; benefits/overhead unknown so the fully loaded total is null"} — about ${monthly}/month${input.startMonth ? ` starting ${input.startMonth}` : ""}.`,
      numbers: [moneyFigure("Gross annual", v.annualGrossWages), moneyFigure("Employer taxes", v.employerTaxes), moneyFigure("Wages + employer taxes", v.wagesPlusEmployerTaxes), moneyFigure("Fully loaded total", v.total, calc.id, v.total ? undefined : "benefits/overhead unknown"), moneyFigure("Monthly", monthly)],
      why: [`Employer taxes: SS ${v.socialSecurity}, Medicare ${v.medicare}, FUTA ${v.futa}, SUI ${v.sui}, ETT ${v.ett} (wage-base caps applied where bases are known).`],
      risks: rs.allConfirmed ? [] : ["Payroll rate assumptions are not all confirmed; treat the tax figure as an estimate for planning only."],
      confidence: rs.allConfirmed ? 0.85 : 0.65,
      structured: { value: v.total ?? v.wagesPlusEmployerTaxes, values: { grossAnnual: v.annualGrossWages, employerTaxes: v.employerTaxes, wagesPlusEmployerTaxes: v.wagesPlusEmployerTaxes, fullyLoadedTotal: v.total, monthly, employerTaxRate: v.employerTaxRate }, rateSource: rs.source },
    }, { calcs: [calc] });
  },
});

export const ratiosTool = defineTool({
  name: "financial_ratios",
  description: "Ratio pack: margins, opex ratio, DSO/DPO, cash conversion cycle, working capital, current and quick ratios.",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["fpa.ratios"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? input.to ?? ctx.asOfDate;
    const from = input.from ?? `${asOf.slice(0, 4)}-01-01`;
    const to = input.to ?? asOf;
    const is = ctx.ledger.incomeStatement(from, to);
    const bs = ctx.ledger.balanceSheet(asOf);
    const ar = bs.lines.find((l) => l.code === "1100")?.amount ?? "0.0000";
    const ap = bs.lines.find((l) => l.code === "2000")?.amount ?? "0.0000";
    const inp = input.inputs ?? {};
    const headcount = ctx.dataset.workers.filter((w) => !w.endDate || w.endDate > asOf).length || null;
    const pack = ratioPack({ asOfDate: asOf, periodDays: daysBetween(from, to) + 1, revenue: toDec(inp.revenue) ?? is.revenue, costOfRevenue: toDec(inp.costOfRevenue) ?? is.costOfRevenue, operatingExpenses: toDec(inp.operatingExpenses) ?? is.operatingExpenses, headcount: inp.headcount !== undefined ? Number(inp.headcount) : headcount, accountsReceivable: toDec(inp.accountsReceivable) ?? ar, accountsPayable: toDec(inp.accountsPayable) ?? ap });
    const wc = workingCapital(bs);
    const cr = currentRatio(bs);
    const qr = quickRatio(bs);
    const all = [...pack.ratios, wc, cr, qr];
    return ok({
      answer: `Ratios for ${from}–${to}: ${all.map((c) => `${c.name.replace(/_/g, " ")} ${c.value === null ? "n/a" : typeof c.value === "number" ? (c.unit === "RATIO" ? c.value.toFixed(3) : c.value.toFixed(1)) : c.value}`).join("; ")}.`,
      numbers: all.map((c) => figure(c.name.replace(/_/g, " "), c)),
      why: ["Margins use the income statement for the period; DSO/DPO use period-end AR/AP against period revenue/purchases; liquidity ratios use the balance sheet at the as-of date."],
      confidence: 0.85,
      structured: { value: pack.ratios[0].value, values: Object.fromEntries(all.map((c) => [c.name, c.value])) },
    }, { calcs: [...all, pack.summary] });
  },
});

export const profitabilityTool = defineTool({
  name: "profitability_analysis",
  description: "Profitability by customer (from invoices), by month or by account for a period.",
  riskLevel: "GREEN",
  capabilityKey: "strategic_analysis",
  inputSchema: TASKS["fpa.profitability"].params,
  async execute(input, ctx) {
    const by = input.by ?? "CUSTOMER";
    const is = ctx.ledger.incomeStatement(input.from, input.to);
    if (by === "CUSTOMER") {
      const invoices = ctx.dataset.invoices.filter((i) => i.status !== "VOID" && i.status !== "DRAFT" && i.issueDate >= input.from && i.issueDate <= input.to);
      if (!invoices.length) return ok(insufficient(["invoices in the period"], `No invoices between ${input.from} and ${input.to}; revenue by customer is unknown.`));
      const names = new Map(ctx.dataset.customers.map((c) => [c.id, c]));
      const byCust = new Map<string, DecimalString>();
      for (const i of invoices) byCust.set(i.customerId, D(byCust.get(i.customerId) ?? 0).plus(D(i.total)).toFixed(4));
      const total = [...byCust.values()].reduce((a, v) => a.plus(D(v)), D(0));
      const rows = [...byCust.entries()].map(([id, revenue]) => ({ customerId: id, customer: names.get(id)?.name ?? id, revenue, share: total.isZero() ? null : D(revenue).div(total).toNumber(), relatedParty: names.get(id)?.relatedParty ?? false })).sort((a, b) => D(b.revenue).cmp(D(a.revenue)));
      const calc = makeCalc({ name: "revenue_by_customer", value: rows, unit: "TABLE", formula: "sum(invoice totals) per customer; share = customer revenue / total invoiced", inputs: { from: input.from, to: input.to, invoiceCount: invoices.length }, asOfDate: input.to, sourceIds: invoices.map((i) => i.id) });
      const concentration = rows[0]?.share ?? null;
      return ok({
        answer: `Invoiced revenue ${total.toFixed(4)} across ${rows.length} customer(s) for ${input.from}–${input.to}: ${rows.slice(0, 5).map((r) => `${r.customer} ${r.revenue} (${pct(r.share)})${r.relatedParty ? " [related party]" : ""}`).join("; ")}. Costs are not attributable per customer in this ledger, so this is a revenue-concentration view; company net margin for the period is ${D(is.revenue).isZero() ? "n/a" : pct(D(is.netIncome).div(D(is.revenue)).toNumber())}.`,
        numbers: [moneyFigure("Invoiced revenue", total.toFixed(4), calc.id), textFigure("Customers", rows.length), textFigure("Top-customer share", pct(concentration)), moneyFigure("Period net income", is.netIncome)],
        risks: [...(concentration !== null && concentration > 0.5 ? ["Revenue concentration: the top customer exceeds half of invoiced revenue."] : []), ...(rows.some((r) => r.relatedParty) ? ["Related-party revenue present; terms must be arm's length and disclosed to the CPA."] : [])],
        confidence: 0.85,
        structured: { value: total.toFixed(4), values: { invoicedRevenue: total.toFixed(4), topCustomerShare: concentration, netIncome: is.netIncome }, rows },
      }, { calcs: [calc] });
    }
    if (by === "MONTH") {
      const months: string[] = [];
      for (let m = monthKey(input.from); m <= monthKey(input.to); m = monthKey(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10))) months.push(m);
      const rows = months.map((m) => {
        const s = ctx.ledger.incomeStatement(`${m}-01`, monthEnd(`${m}-01`) < input.to ? monthEnd(`${m}-01`) : input.to);
        return { month: m, revenue: s.revenue, grossProfit: s.grossProfit, operatingExpenses: s.operatingExpenses, netIncome: s.netIncome, netMargin: D(s.revenue).isZero() ? null : D(s.netIncome).div(D(s.revenue)).toNumber() };
      });
      const calc = makeCalc({ name: "profitability_by_month", value: rows, unit: "TABLE", formula: "income statement per month", inputs: { from: input.from, to: input.to }, asOfDate: input.to });
      return ok({ answer: `Monthly profitability ${input.from}–${input.to}: ${rows.map((r) => `${r.month} net ${r.netIncome} (${pct(r.netMargin)})`).join("; ")}.`, numbers: rows.map((r) => moneyFigure(`${r.month} net income`, r.netIncome)), confidence: 0.85, structured: { value: is.netIncome, values: { netIncome: is.netIncome }, rows } }, { calcs: [calc] });
    }
    const rows = is.lines.filter((l) => !l.isTotal && l.code).map((l) => ({ code: l.code, label: l.label, amount: l.amount, shareOfRevenue: D(is.revenue).isZero() ? null : D(l.amount).div(D(is.revenue)).toNumber() }));
    const calc = makeCalc({ name: "profitability_by_account", value: rows, unit: "TABLE", formula: "income statement lines; share = line / revenue", inputs: { from: input.from, to: input.to }, asOfDate: input.to });
    return ok({ answer: `By account for ${input.from}–${input.to}: revenue ${is.revenue}, net income ${is.netIncome}; largest expense lines ${rows.filter((r) => r.code! >= "5000").sort((a, b) => D(b.amount).cmp(D(a.amount))).slice(0, 4).map((r) => `${r.code} ${r.label} ${r.amount} (${pct(r.shareOfRevenue)})`).join("; ")}.`, numbers: [moneyFigure("Revenue", is.revenue), moneyFigure("Net income", is.netIncome)], confidence: 0.85, structured: { value: is.netIncome, values: { revenue: is.revenue, netIncome: is.netIncome }, rows } }, { calcs: [calc] });
  },
});

export const fpaTools = [budgetVarianceTool, forecastVarianceTool, rollingForecastTool, buildBudgetTool, scenarioTool, growthRateTool, headcountPlanTool, ratiosTool, profitabilityTool];
