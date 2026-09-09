/**
 * Budget / forecast variance analysis and growth rates.
 *
 * Sign conventions: actuals and budgets are stored as positive revenue and positive expense
 * (see forecasting/budget.ts actualsByAccountMonth). variance = actual - budget.
 *   EXPENSE accounts: actual < budget → favorable.
 *   REVENUE accounts: actual > budget → favorable.
 *   Other account types: favorability is not defined (null).
 */
import type { Account, Budget, CalcResult, DecimalString, Forecast, ID, ISODate } from "@/lib/core/types";
import { D, abs, add, sub } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, type NumericInput } from "./calc-result";

/** accountId → month (YYYY-MM) → amount */
export type ActualsByAccountMonth = Record<ID, Record<string, DecimalString>>;

export interface VarianceOptions {
  accounts: Account[];
  /** |variance| / |budget| above which a line is flagged (e.g. 0.10). */
  materialityRatio?: number;
  /** |variance| above which a line is flagged regardless of ratio. */
  materialityAmount?: DecimalString | number;
  /** Restrict to these months (default: union of months in actuals and plan). */
  months?: string[];
  asOfDate?: ISODate;
  sourceIds?: ID[];
}

export interface VarianceRow {
  accountId: ID;
  accountCode?: string;
  accountName?: string;
  accountType?: Account["type"];
  month: string;
  actual: DecimalString;
  budget: DecimalString;
  variance: DecimalString;
  /** variance / |budget|; null when budget is zero */
  variancePct: number | null;
  /** true favorable, false unfavorable, null when undefined or variance is zero */
  favorable: boolean | null;
  flagged: boolean;
  flagReasons: string[];
}

export interface VarianceTotal {
  key: string;
  actual: DecimalString;
  budget: DecimalString;
  variance: DecimalString;
  variancePct: number | null;
  favorable: boolean | null;
}

export interface VarianceReport {
  kind: "BUDGET" | "FORECAST";
  rows: VarianceRow[];
  byAccount: VarianceTotal[];
  byMonth: VarianceTotal[];
  flagged: VarianceRow[];
  summary: { actualRevenue: DecimalString; budgetRevenue: DecimalString; actualExpense: DecimalString; budgetExpense: DecimalString; netVariance: DecimalString; flaggedCount: number };
}

type PlanMap = Record<ID, Record<string, DecimalString>>;

function favorability(type: Account["type"] | undefined, variance: DecimalString): boolean | null {
  const v = D(variance);
  if (v.isZero()) return null;
  if (type === "EXPENSE") return v.lt(0);
  if (type === "REVENUE") return v.gt(0);
  return null;
}

function computeVariance(kind: "BUDGET" | "FORECAST", actuals: ActualsByAccountMonth, plan: PlanMap, opts: VarianceOptions): VarianceReport {
  const acctById = new Map(opts.accounts.map((a) => [a.id, a]));
  const accountIds = Array.from(new Set([...Object.keys(actuals), ...Object.keys(plan)])).sort();
  const monthSet = new Set<string>();
  for (const id of accountIds) {
    for (const m of Object.keys(actuals[id] ?? {})) monthSet.add(m);
    for (const m of Object.keys(plan[id] ?? {})) monthSet.add(m);
  }
  const months = (opts.months ?? Array.from(monthSet)).slice().sort();
  const ratioLimit = opts.materialityRatio;
  const amountLimit = opts.materialityAmount === undefined ? null : D(opts.materialityAmount);

  const rows: VarianceRow[] = [];
  for (const id of accountIds) {
    const acct = acctById.get(id);
    for (const m of months) {
      const actual = dec(actuals[id]?.[m] ?? 0);
      const budget = dec(plan[id]?.[m] ?? 0);
      if (D(actual).isZero() && D(budget).isZero()) continue;
      const variance = sub(actual, budget);
      const variancePct = D(budget).isZero() ? null : round(D(variance).div(D(budget).abs()).toNumber());
      const flagReasons: string[] = [];
      if (ratioLimit !== undefined && variancePct !== null && Math.abs(variancePct) > ratioLimit) flagReasons.push(`|variance %| ${round(Math.abs(variancePct), 4)} exceeds materiality ratio ${ratioLimit}`);
      if (ratioLimit !== undefined && variancePct === null && !D(variance).isZero()) flagReasons.push("actual with no budgeted amount");
      if (amountLimit && D(abs(variance)).gt(amountLimit)) flagReasons.push(`|variance| ${abs(variance)} exceeds materiality amount ${amountLimit.toFixed(4)}`);
      rows.push({
        accountId: id,
        accountCode: acct?.code,
        accountName: acct?.name,
        accountType: acct?.type,
        month: m,
        actual,
        budget,
        variance,
        variancePct,
        favorable: favorability(acct?.type, variance),
        flagged: flagReasons.length > 0,
        flagReasons,
      });
    }
  }

  const totals = (keyFn: (r: VarianceRow) => string, typeFn: (key: string) => Account["type"] | undefined): VarianceTotal[] => {
    const map = new Map<string, { actual: DecimalString; budget: DecimalString }>();
    for (const r of rows) {
      const k = keyFn(r);
      const cur = map.get(k) ?? { actual: "0.0000", budget: "0.0000" };
      map.set(k, { actual: add(cur.actual, r.actual), budget: add(cur.budget, r.budget) });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, t]) => {
        const variance = sub(t.actual, t.budget);
        return { key, ...t, variance, variancePct: D(t.budget).isZero() ? null : round(D(variance).div(D(t.budget).abs()).toNumber()), favorable: favorability(typeFn(key), variance) };
      });
  };
  const byAccount = totals((r) => r.accountId, (k) => acctById.get(k)?.type);
  const byMonth = totals((r) => r.month, () => undefined);

  const sumWhere = (pred: (r: VarianceRow) => boolean, pick: (r: VarianceRow) => DecimalString) => rows.filter(pred).reduce((acc, r) => add(acc, pick(r)), "0.0000");
  const actualRevenue = sumWhere((r) => r.accountType === "REVENUE", (r) => r.actual);
  const budgetRevenue = sumWhere((r) => r.accountType === "REVENUE", (r) => r.budget);
  const actualExpense = sumWhere((r) => r.accountType === "EXPENSE", (r) => r.actual);
  const budgetExpense = sumWhere((r) => r.accountType === "EXPENSE", (r) => r.budget);
  // Net variance in profit terms: (actual net) - (budget net)
  const netVariance = sub(sub(actualRevenue, actualExpense), sub(budgetRevenue, budgetExpense));
  const flagged = rows.filter((r) => r.flagged);
  return { kind, rows, byAccount, byMonth, flagged, summary: { actualRevenue, budgetRevenue, actualExpense, budgetExpense, netVariance, flaggedCount: flagged.length } };
}

function planFromBudget(budget: Budget): PlanMap {
  const plan: PlanMap = {};
  for (const l of budget.lines) {
    plan[l.accountId] ??= {};
    plan[l.accountId][l.month] = add(plan[l.accountId][l.month] ?? 0, l.amount);
  }
  return plan;
}

function planFromForecast(forecast: Forecast): PlanMap {
  const plan: PlanMap = {};
  for (const l of forecast.lines) {
    if (l.basis !== "FORECAST") continue;
    plan[l.accountId] ??= {};
    plan[l.accountId][l.month] = add(plan[l.accountId][l.month] ?? 0, l.amount);
  }
  return plan;
}

function varianceCalc(name: string, report: VarianceReport, opts: VarianceOptions, planId: ID, extra: Record<string, unknown>): CalcResult<VarianceReport> {
  const lastMonth = report.rows.map((r) => r.month).sort().pop();
  return makeCalc<VarianceReport>({
    name,
    value: report,
    unit: "TABLE",
    formula: "variance = actual - plan; variance_pct = variance / |plan|; EXPENSE favorable when actual < plan, REVENUE favorable when actual > plan; flagged when |variance_pct| > materialityRatio or |variance| > materialityAmount",
    inputs: {
      planId,
      materialityRatio: opts.materialityRatio ?? null,
      materialityAmount: opts.materialityAmount === undefined ? null : dec(opts.materialityAmount),
      months: opts.months ?? null,
      rows: report.rows.map((r) => ({ accountId: r.accountId, month: r.month, actual: r.actual, plan: r.budget })),
      ...extra,
    },
    sourceIds: [planId, ...(opts.sourceIds ?? [])],
    asOfDate: opts.asOfDate ?? (lastMonth ? `${lastMonth}-01` : "1970-01-01"),
    notes: report.flagged.length ? [`${report.flagged.length} line(s) flagged as material`] : [],
  });
}

/** Actual vs budget by account and month. */
export function budgetVariance(actuals: ActualsByAccountMonth, budget: Budget, opts: VarianceOptions): CalcResult<VarianceReport> {
  const report = computeVariance("BUDGET", actuals, planFromBudget(budget), opts);
  return varianceCalc("budget_variance", report, opts, budget.id, { budgetVersion: budget.version });
}

/** Actual vs forecast (FORECAST-basis lines only) by account and month. */
export function forecastVariance(actuals: ActualsByAccountMonth, forecast: Forecast, opts: VarianceOptions): CalcResult<VarianceReport> {
  const report = computeVariance("FORECAST", actuals, planFromForecast(forecast), opts);
  return varianceCalc("forecast_variance", report, opts, forecast.id, { forecastVersion: forecast.version });
}

export interface GrowthRateInput {
  current: NumericInput;
  prior: NumericInput;
  asOfDate: ISODate;
  sourceIds?: ID[];
  label?: string;
}

/** Period-over-period growth = (current - prior) / |prior|. Returns a ratio (0.10 = +10%). */
export function growthRate(input: GrowthRateInput): CalcResult<number | null> {
  const name = "growth_rate";
  const formula = "growth_rate = (current - prior) / |prior|";
  const inputs = { current: isUnknown(input.current) ? null : dec(input.current), prior: isUnknown(input.prior) ? null : dec(input.prior), label: input.label ?? null };
  const missing: string[] = [];
  if (isUnknown(input.current)) missing.push("current period value");
  if (isUnknown(input.prior)) missing.push("prior period value");
  if (missing.length) return insufficient({ name, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, missing, sourceIds: input.sourceIds });
  const prior = D(input.prior as DecimalString | number);
  if (prior.isZero()) {
    return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds, notes: ["Prior period value is zero; growth rate is undefined."] });
  }
  const value = round(D(input.current as DecimalString | number).minus(prior).div(prior.abs()).toNumber());
  return makeCalc<number | null>({ name, value, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds });
}

export interface CagrInput {
  beginning: NumericInput;
  ending: NumericInput;
  /** Number of periods (years, months...) between beginning and ending. */
  periods: number;
  asOfDate: ISODate;
  sourceIds?: ID[];
}

/** Compound growth rate per period = (ending / beginning)^(1/periods) - 1. */
export function cagr(input: CagrInput): CalcResult<number | null> {
  const name = "cagr";
  const formula = "cagr = (ending / beginning)^(1 / periods) - 1";
  const inputs = { beginning: isUnknown(input.beginning) ? null : dec(input.beginning), ending: isUnknown(input.ending) ? null : dec(input.ending), periods: input.periods };
  const missing: string[] = [];
  if (isUnknown(input.beginning)) missing.push("beginning value");
  if (isUnknown(input.ending)) missing.push("ending value");
  if (missing.length) return insufficient({ name, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, missing, sourceIds: input.sourceIds });
  const b = D(input.beginning as DecimalString | number);
  const e = D(input.ending as DecimalString | number);
  if (b.lte(0) || e.lte(0) || input.periods <= 0) {
    return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds, notes: ["CAGR is undefined for non-positive values or a non-positive number of periods."] });
  }
  const value = round(Math.pow(e.div(b).toNumber(), 1 / input.periods) - 1);
  return makeCalc<number | null>({ name, value, unit: "PERCENT", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds });
}
