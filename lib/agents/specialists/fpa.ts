/** FP&A agent: variance, forecast, budget, scenarios, growth, headcount, ratios, profitability. */
import type { RouteRule } from "../intent";
import { budgetVarianceTool, buildBudgetTool, forecastVarianceTool, growthRateTool, headcountPlanTool, profitabilityTool, ratiosTool, rollingForecastTool, scenarioTool } from "../tools/fpa-tools";
import { Specialist, previousMonth } from "./shared";

const rules: RouteRule[] = [
  { kind: "fpa.headcount_plan", weight: 3, any: [/\bfully[- ]loaded\b/i, /\bheadcount\b/i, /\b(cost|price) (of|to) (an? |the )?(new )?(hire|employee|engineer|developer|salesperson|worker)\b/i, /\b(hire|employee) .* cost\b/i, /\bloaded cost\b/i], none: [/\bshould (we|i) hire\b/i, /\bbusiness case\b/i, /\bworth (it|hiring)\b/i], params: (m, e, _asOf) => { const monthly = /\b(per|a|\/)\s?month\b/i.test(m); return { grossAnnual: monthly ? undefined : e.amounts[0], grossMonthly: monthly ? e.amounts[0] : undefined, benefitsMonthly: undefined }; } },
  { kind: "fpa.budget_variance", weight: 2.8, all: [/\bbudget\b/i], any: [/\bvariance\b/i, /\bvs\.?\b/i, /\bversus\b/i, /\bactual/i, /\bcompare\b/i, /\bover (budget|spent)\b/i, /\bunder budget\b/i, /\bon track\b/i], params: (m, e, _asOf) => ({ month: e.months[0], accountCode: e.accountCodes[0], budget: e.amounts.length >= 2 ? e.amounts[0] : undefined, actual: e.amounts.length >= 2 ? e.amounts[1] : undefined, accountType: /\brevenue|sales|income\b/i.test(m) ? "REVENUE" : e.amounts.length >= 2 ? "EXPENSE" : undefined }) },
  { kind: "fpa.forecast_variance", weight: 2.8, all: [/\bforecast\b/i], any: [/\bvariance\b/i, /\bvs\.?\b/i, /\bversus\b/i, /\bactual/i, /\baccura/i, /\bmissed\b/i], params: (m, e, asOf) => ({ month: e.months[0] ?? previousMonth(asOf), forecast: e.amounts.length >= 2 ? e.amounts[0] : undefined, actual: e.amounts.length >= 2 ? e.amounts[1] : undefined, accountCode: e.accountCodes[0], accountType: /\brevenue|sales\b/i.test(m) ? "REVENUE" : e.amounts.length >= 2 ? "EXPENSE" : undefined }) },
  { kind: "fpa.build_budget", weight: 2.8, all: [/\bbudget\b/i], any: [/\bbuild\b/i, /\bcreate\b/i, /\bprepare\b/i, /\bdraft\b/i, /\bput together\b/i, /\bannual budget\b/i, /\bnext year/i], params: (_m, e, asOf) => ({ fiscalYear: e.years[0] ?? Number(asOf.slice(0, 4)) + 1 }) },
  { kind: "fpa.rolling_forecast", weight: 2.6, any: [/\brolling forecast\b/i, /\b(update|refresh|rebuild|build|run) (the |a |our )?forecast\b/i, /\bforecast (the )?next \d+ months\b/i, /\b\d+[- ]month forecast\b/i, /\bwhat('s| is) (the|our) forecast\b/i, /\bproject(ion|ed)? (revenue|expenses|net)\b/i], none: [/\bcash (flow )?forecast\b/i, /\b13|thirteen\b/i], params: (_m, e, _asOf) => ({ horizonMonths: e.durations.find((d) => d.unit === "MONTH")?.value }) },
  { kind: "fpa.growth_rate", weight: 2.6, any: [/\bgrowth rate\b/i, /\bcagr\b/i, /\bhow fast (are we|is revenue) growing\b/i, /\bgrew\b/i, /\bgrowth (from|between)\b/i, /\bcompound/i], params: (_m, e, _asOf) => ({ series: e.amounts.length >= 2 ? e.amounts : e.numbers.length >= 2 ? e.numbers : undefined, start: e.amounts.length === 2 ? e.amounts[0] : undefined, end: e.amounts.length === 2 ? e.amounts[1] : undefined, periods: e.durations.find((d) => d.unit === "YEAR" || d.unit === "MONTH")?.value }) },
  { kind: "fpa.profitability", weight: 2.6, any: [/\bprofitab/i, /\bby customer\b/i, /\brevenue (by|per) customer\b/i, /\bmost profitable\b/i, /\bcustomer concentration\b/i, /\bmargin by\b/i], params: (m, e, asOf) => ({ from: e.dates[0] ?? `${e.years[0] ?? Number(asOf.slice(0, 4))}-01-01`, to: e.dates[1] ?? asOf, by: /\bmonth/i.test(m) ? "MONTH" : /\baccount/i.test(m) ? "ACCOUNT" : "CUSTOMER" }) },
  { kind: "fpa.scenario", weight: 2.4, any: [/\bscenario\b/i, /\bwhat if\b/i, /\bif we (add|cut|raise|grow|lose|hire|drop)\b/i], none: [/\bcash\b/i, /\bstress\b/i, /\bnpv\b/i, /\bcompare scenarios\b/i], params: (m, e, _asOf) => ({ name: m.slice(0, 60), driverOverrides: e.percents[0] !== undefined ? { "revenue:growth_rate_monthly": e.percents[0] } : undefined }) },
  { kind: "fpa.ratios", weight: 2.2, any: [/\bratios?\b/i, /\bgross margin\b/i, /\boperating margin\b/i, /\bnet margin\b/i, /\bmargins\b/i, /\bdso\b/i, /\bdpo\b/i, /\bcash conversion\b/i, /\brevenue per employee\b/i], none: [/\bbreak[- ]?even\b/i, /\bcontribution margin\b/i, /\bcurrent ratio\b/i, /\bquick ratio\b/i], params: (_m, e, _asOf) => ({ from: e.dates[0], to: e.dates[1], asOf: undefined }) },
];

export function createFpaAgent(): Specialist {
  return new Specialist({
    name: "fpa",
    description: "FP&A: budget and forecast variance, rolling forecast, budgets, scenarios, growth rates, headcount cost, ratios and profitability.",
    keywords: [/\bbudget\b/i, /\bforecast\b/i, /\bvariance\b/i, /\bscenario\b/i, /\bgrowth\b/i, /\bheadcount\b/i, /\bratio/i, /\bmargin/i, /\bprofitab/i, /\bplan\b/i, /\bprojection/i],
    rules,
    tools: [
      [budgetVarianceTool, "fpa.budget_variance"],
      [forecastVarianceTool, "fpa.forecast_variance"],
      [rollingForecastTool, "fpa.rolling_forecast"],
      [buildBudgetTool, "fpa.build_budget"],
      [scenarioTool, "fpa.scenario"],
      [growthRateTool, "fpa.growth_rate"],
      [headcountPlanTool, "fpa.headcount_plan"],
      [ratiosTool, "fpa.ratios"],
      [profitabilityTool, "fpa.profitability"],
    ],
  });
}
