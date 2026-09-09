/**
 * Scenario comparison over monthly cash series.
 * A CashSeries is an opening cash balance plus signed monthly net cash flows.
 */
import type { CalcResult, DecimalString, ID, ISODate } from "@/lib/core/types";
import { D, add, sub } from "@/lib/core/money";
import { makeCalc } from "./calc-result";

export interface CashSeries {
  id: ID;
  label: string;
  openingCash: DecimalString;
  months: { month: string; netCashFlow: DecimalString }[];
  sourceIds?: ID[];
}

export interface SeriesSummary {
  id: ID;
  label: string;
  openingCash: DecimalString;
  endingCash: DecimalString;
  cumulativeNet: DecimalString;
  minCash: DecimalString;
  minCashMonth: string | null;
  /** vs base (null for the base row) */
  endingCashDelta: DecimalString | null;
  cumulativeNetDelta: DecimalString | null;
  minCashDelta: DecimalString | null;
}

export interface ScenarioRow {
  month: string;
  base: { net: DecimalString; cash: DecimalString };
  scenarios: Record<ID, { net: DecimalString; cash: DecimalString; netDelta: DecimalString; cashDelta: DecimalString }>;
}

export interface ScenarioComparison {
  months: string[];
  rows: ScenarioRow[];
  base: SeriesSummary;
  scenarios: SeriesSummary[];
}

function runningCash(series: CashSeries, months: string[]): { net: Record<string, DecimalString>; cash: Record<string, DecimalString> } {
  const flowByMonth = new Map(series.months.map((m) => [m.month, m.netCashFlow]));
  const net: Record<string, DecimalString> = {};
  const cash: Record<string, DecimalString> = {};
  let bal = D(series.openingCash).toFixed(4);
  for (const m of months) {
    const f = D(flowByMonth.get(m) ?? 0).toFixed(4);
    bal = add(bal, f);
    net[m] = f;
    cash[m] = bal;
  }
  return { net, cash };
}

function summarize(series: CashSeries, months: string[], cash: Record<string, DecimalString>, base?: SeriesSummary): SeriesSummary {
  const ending = months.length ? cash[months[months.length - 1]] : D(series.openingCash).toFixed(4);
  let minCash = D(series.openingCash).toFixed(4);
  let minMonth: string | null = null;
  for (const m of months) {
    if (D(cash[m]).lt(D(minCash))) {
      minCash = cash[m];
      minMonth = m;
    }
  }
  const cumulative = sub(ending, series.openingCash);
  return {
    id: series.id,
    label: series.label,
    openingCash: D(series.openingCash).toFixed(4),
    endingCash: ending,
    cumulativeNet: cumulative,
    minCash,
    minCashMonth: minMonth,
    endingCashDelta: base ? sub(ending, base.endingCash) : null,
    cumulativeNetDelta: base ? sub(cumulative, base.cumulativeNet) : null,
    minCashDelta: base ? sub(minCash, base.minCash) : null,
  };
}

/** Compare scenario cash series against a base: per-month differences plus ending / cumulative / minimum cash summaries. */
export function compareScenarios(base: CashSeries, scenarios: CashSeries[], meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<ScenarioComparison> {
  const monthSet = new Set<string>(base.months.map((m) => m.month));
  for (const s of scenarios) for (const m of s.months) monthSet.add(m.month);
  const months = Array.from(monthSet).sort();
  const baseRun = runningCash(base, months);
  const baseSummary = summarize(base, months, baseRun.cash);
  const scenarioRuns = scenarios.map((s) => ({ series: s, run: runningCash(s, months) }));
  const rows: ScenarioRow[] = months.map((m) => {
    const row: ScenarioRow = { month: m, base: { net: baseRun.net[m], cash: baseRun.cash[m] }, scenarios: {} };
    for (const { series, run } of scenarioRuns) {
      row.scenarios[series.id] = { net: run.net[m], cash: run.cash[m], netDelta: sub(run.net[m], baseRun.net[m]), cashDelta: sub(run.cash[m], baseRun.cash[m]) };
    }
    return row;
  });
  const value: ScenarioComparison = {
    months,
    rows,
    base: baseSummary,
    scenarios: scenarioRuns.map(({ series, run }) => summarize(series, months, run.cash, baseSummary)),
  };
  const notes = value.scenarios.filter((s) => D(s.minCash).lt(0)).map((s) => `Scenario "${s.label}" goes cash-negative (min ${s.minCash} in ${s.minCashMonth}).`);
  if (D(baseSummary.minCash).lt(0)) notes.unshift(`Base case goes cash-negative (min ${baseSummary.minCash} in ${baseSummary.minCashMonth}).`);
  return makeCalc<ScenarioComparison>({
    name: "scenario_comparison",
    value,
    unit: "TABLE",
    formula: "cash_m = opening + cumulative sum of net cash flows through month m; delta = scenario - base; min cash = lowest running balance",
    inputs: {
      base: { id: base.id, openingCash: base.openingCash, months: base.months },
      scenarios: scenarios.map((s) => ({ id: s.id, openingCash: s.openingCash, months: s.months })),
    },
    sourceIds: [...(meta.sourceIds ?? []), ...(base.sourceIds ?? []), ...scenarios.flatMap((s) => s.sourceIds ?? [])],
    asOfDate: meta.asOfDate,
    notes,
  });
}
