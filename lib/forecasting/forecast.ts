/**
 * Rolling forecast: ACTUAL months from the ledger, FORECAST months from drivers.
 * Scenario application and forecast accuracy (MAPE).
 */
import type { Account, Assumption, CalcResult, CompanyDataset, DecimalString, DriverAssumption, Forecast, ForecastLine, ID, ISODate, Scenario } from "@/lib/core/types";
import { addMonths, monthEnd, monthKey, monthsBetween } from "@/lib/core/dates";
import { deterministicId, fingerprint } from "@/lib/core/ids";
import { D, add, sub } from "@/lib/core/money";
import { makeCalc, round } from "@/lib/finance/calc-result";
import type { ActualsByAccountMonth } from "@/lib/finance/variance";
import { actualsByAccountMonth, projectDriverLines, type DriverModelOptions } from "./budget";
import { type DriverSet, eventDriverKey, makeDriver } from "./drivers";

export interface RollingForecastOptions extends Partial<Omit<DriverModelOptions, "accounts">> {
  /** Months of actual history to include, ending at the asOf month (default 12). */
  historyMonths?: number;
  accounts?: Account[];
  name?: string;
  version?: number;
  createdAt?: string;
  createdBy?: string;
}

export interface MonthSummary {
  month: string;
  basis: "ACTUAL" | "FORECAST";
  revenue: DecimalString;
  expense: DecimalString;
  net: DecimalString;
}

export interface ForecastSummary {
  actualMonths: string[];
  forecastMonths: string[];
  months: MonthSummary[];
  totalForecastRevenue: DecimalString;
  totalForecastExpense: DecimalString;
  totalForecastNet: DecimalString;
}

function summarize(lines: ForecastLine[], accounts: Account[]): MonthSummary[] {
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const byMonth = new Map<string, MonthSummary>();
  for (const l of lines) {
    const cur = byMonth.get(l.month) ?? { month: l.month, basis: l.basis, revenue: "0.0000", expense: "0.0000", net: "0.0000" };
    const t = type.get(l.accountId);
    if (t === "REVENUE") cur.revenue = add(cur.revenue, l.amount);
    else if (t === "EXPENSE") cur.expense = add(cur.expense, l.amount);
    cur.net = sub(cur.revenue, cur.expense);
    byMonth.set(l.month, cur);
  }
  return Array.from(byMonth.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function forecastSummaryCalc(forecast: Forecast, accounts: Account[]): CalcResult<ForecastSummary> {
  const months = summarize(forecast.lines, accounts);
  const fc = months.filter((m) => m.basis === "FORECAST");
  const value: ForecastSummary = {
    actualMonths: months.filter((m) => m.basis === "ACTUAL").map((m) => m.month),
    forecastMonths: fc.map((m) => m.month),
    months,
    totalForecastRevenue: fc.reduce((acc, m) => add(acc, m.revenue), "0.0000"),
    totalForecastExpense: fc.reduce((acc, m) => add(acc, m.expense), "0.0000"),
    totalForecastNet: fc.reduce((acc, m) => add(acc, m.net), "0.0000"),
  };
  return makeCalc<ForecastSummary>({
    name: "rolling_forecast_summary",
    value,
    unit: "TABLE",
    formula: "ACTUAL months: sum of POSTED P&L entries; FORECAST months: revenue_n = mrr * (1 + growth)^n, payroll = monthly gross (+ gross * employer tax rate), recurring expenses flat, events in their month; net = revenue - expense",
    inputs: { forecastId: forecast.id, asOfDate: forecast.asOfDate, horizonMonths: forecast.horizonMonths, drivers: Object.fromEntries(Object.entries(forecast.drivers).map(([k, d]) => [k, d.value])), lines: forecast.lines.map((l) => ({ accountId: l.accountId, month: l.month, amount: l.amount, basis: l.basis })) },
    sourceIds: [forecast.id],
    assumptions: Object.values(forecast.drivers).map((d) => ({ key: d.key, description: `${d.label}${d.note ? ` — ${d.note}` : ""}`, value: d.value, status: d.status, sourceId: d.sourceId })),
    asOfDate: forecast.asOfDate,
  });
}

/** Build a rolling forecast: trailing actual months + driver-based forecast months. */
export function rollingForecast(dataset: CompanyDataset, asOf: ISODate, horizonMonths: number, drivers: DriverSet, opts: RollingForecastOptions = {}): { forecast: Forecast; calcs: CalcResult<ForecastSummary>[] } {
  const accounts = opts.accounts ?? dataset.accounts;
  const history = opts.historyMonths ?? 12;
  const asOfMonth = monthKey(asOf);
  const historyStart = monthKey(addMonths(`${asOfMonth}-01`, -(history - 1)));
  const actualMonths = monthsBetween(historyStart, asOfMonth);
  const forecastMonths = monthsBetween(monthKey(addMonths(`${asOfMonth}-01`, 1)), monthKey(addMonths(`${asOfMonth}-01`, horizonMonths)));

  const actuals = actualsByAccountMonth(dataset, `${historyStart}-01`, monthEnd(asOf));
  const actualLines: ForecastLine[] = [];
  for (const [accountId, byMonth] of Object.entries(actuals)) {
    for (const [month, amount] of Object.entries(byMonth)) {
      if (!actualMonths.includes(month)) continue;
      actualLines.push({ accountId, month, amount, basis: "ACTUAL" });
    }
  }
  const projection = projectDriverLines(drivers, forecastMonths, { accounts, revenueAccountId: opts.revenueAccountId, payrollAccountId: opts.payrollAccountId, contractorAccountId: opts.contractorAccountId, employerTaxAccountId: opts.employerTaxAccountId });
  const forecastLines: ForecastLine[] = projection.lines.map((l) => ({ accountId: l.accountId, month: l.month, amount: l.amount, basis: "FORECAST", driverKeys: l.driverKeys }));
  const lines = [...actualLines, ...forecastLines].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.accountId < b.accountId ? -1 : 1));

  const name = opts.name ?? `Rolling forecast as of ${asOf}`;
  const version = opts.version ?? 1;
  const forecast: Forecast = {
    id: deterministicId("forecast", name, asOf, horizonMonths, version, fingerprint(drivers)),
    name,
    asOfDate: asOf,
    horizonMonths,
    drivers: { ...drivers },
    lines,
    status: "DRAFT",
    version,
    createdAt: opts.createdAt ?? `${asOf}T00:00:00.000Z`,
    createdBy: opts.createdBy ?? "system:forecasting",
    calcIds: [],
  };
  const summary = forecastSummaryCalc(forecast, accounts);
  if (projection.notes.length) summary.notes = [...(summary.notes ?? []), ...projection.notes];
  if (asOf !== monthEnd(asOf)) summary.notes = [...(summary.notes ?? []), `Actual month ${asOfMonth} is partial (as of ${asOf}).`];
  forecast.calcIds = [summary.id];
  return { forecast, calcs: [summary] };
}

/** Apply driver overrides and one-off events to a forecast, recomputing FORECAST months only. */
export function applyScenario(forecast: Forecast, scenario: Scenario, accounts: Account[], opts: Partial<Omit<DriverModelOptions, "accounts">> = {}): { forecast: Forecast; calcs: CalcResult<ForecastSummary>[] } {
  const drivers: DriverSet = { ...forecast.drivers };
  for (const [key, value] of Object.entries(scenario.driverOverrides)) {
    const base = drivers[key];
    drivers[key] = base
      ? { ...base, value, status: "UNCONFIRMED", note: `ASSUMED: scenario "${scenario.name}" override (base ${String(base.value)})` }
      : makeDriver(key, key, value, "unknown", "UNCONFIRMED", { note: `ASSUMED: scenario "${scenario.name}" override` });
  }
  scenario.events.forEach((ev, i) => {
    const key = eventDriverKey(ev.month, ev.accountId, `${scenario.id}_${i}_${ev.description}`);
    drivers[key] = makeDriver(key, `Event: ${ev.description}`, ev.amount, "USD", "UNCONFIRMED", { note: `ASSUMED: scenario "${scenario.name}" one-off event in ${ev.month}` });
  });
  const forecastMonths = Array.from(new Set(forecast.lines.filter((l) => l.basis === "FORECAST").map((l) => l.month))).sort();
  const projection = projectDriverLines(drivers, forecastMonths, { accounts, ...opts });
  const actualLines = forecast.lines.filter((l) => l.basis === "ACTUAL");
  const forecastLines: ForecastLine[] = projection.lines.map((l) => ({ accountId: l.accountId, month: l.month, amount: l.amount, basis: "FORECAST", driverKeys: l.driverKeys }));
  const name = `${forecast.name} — scenario: ${scenario.name}`;
  const next: Forecast = {
    ...forecast,
    id: deterministicId("forecast", forecast.id, scenario.id, fingerprint(drivers)),
    name,
    drivers,
    lines: [...actualLines, ...forecastLines].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.accountId < b.accountId ? -1 : 1)),
    status: "DRAFT",
    calcIds: [],
  };
  const summary = forecastSummaryCalc(next, accounts);
  summary.sourceIds = [...summary.sourceIds, scenario.id, forecast.id];
  next.calcIds = [summary.id];
  return { forecast: next, calcs: [summary] };
}

export interface AccountAccuracy {
  accountId: ID;
  months: number;
  /** mean(|actual - forecast| / |actual|) */
  mape: number | null;
  meanAbsoluteError: DecimalString;
  totalForecast: DecimalString;
  totalActual: DecimalString;
}

export interface ForecastAccuracy {
  perAccount: AccountAccuracy[];
  overallMape: number | null;
  comparedLines: number;
  skippedZeroActuals: number;
}

/** MAPE per account comparing a prior forecast's FORECAST lines to realized actuals. */
export function forecastAccuracy(priorForecast: Forecast, actuals: ActualsByAccountMonth, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<ForecastAccuracy | null> {
  const name = "forecast_accuracy";
  const formula = "mape = mean(|actual - forecast| / |actual|) over months with non-zero actuals; overall = mean of all compared lines";
  const per = new Map<ID, { errors: number[]; absErr: DecimalString; fc: DecimalString; act: DecimalString }>();
  let compared = 0;
  let skipped = 0;
  const allErrors: number[] = [];
  for (const l of priorForecast.lines) {
    if (l.basis !== "FORECAST") continue;
    const actual = actuals[l.accountId]?.[l.month];
    if (actual === undefined) continue;
    const a = D(actual);
    const f = D(l.amount);
    const cur = per.get(l.accountId) ?? { errors: [], absErr: "0.0000", fc: "0.0000", act: "0.0000" };
    cur.fc = add(cur.fc, l.amount);
    cur.act = add(cur.act, actual);
    cur.absErr = add(cur.absErr, a.minus(f).abs());
    if (a.isZero()) skipped++;
    else {
      const e = a.minus(f).abs().div(a.abs()).toNumber();
      cur.errors.push(e);
      allErrors.push(e);
      compared++;
    }
    per.set(l.accountId, cur);
  }
  const inputs = { forecastId: priorForecast.id, comparedLines: compared, accounts: Array.from(per.keys()).sort() };
  if (!per.size) {
    return makeCalc<ForecastAccuracy | null>({ name, value: null, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: [priorForecast.id, ...(meta.sourceIds ?? [])], assumptions: [{ key: "missing:actuals", description: "No actuals overlap the forecast months.", value: null, status: "UNCONFIRMED" }], notes: ["INSUFFICIENT_INFORMATION: no actuals overlap the forecast's months."] });
  }
  const mean = (xs: number[]) => (xs.length ? round(xs.reduce((x, y) => x + y, 0) / xs.length) : null);
  const perAccount: AccountAccuracy[] = Array.from(per.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([accountId, s]) => ({ accountId, months: s.errors.length, mape: mean(s.errors), meanAbsoluteError: s.errors.length ? D(s.absErr).div(s.errors.length).toFixed(4) : s.absErr, totalForecast: s.fc, totalActual: s.act }));
  return makeCalc<ForecastAccuracy | null>({ name, value: { perAccount, overallMape: mean(allErrors), comparedLines: compared, skippedZeroActuals: skipped }, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: [priorForecast.id, ...(meta.sourceIds ?? [])], notes: skipped ? [`${skipped} line(s) skipped where actual was zero (percentage error undefined).`] : [] });
}

export type { DriverAssumption, Assumption };
