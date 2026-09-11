/** Strategy agent: corporate-finance decisions (NPV, IRR, payback, break-even, hiring, pricing, investment cases). */
import type { RouteRule } from "../intent";
import { breakEvenTool, contributionMarginTool, hiringCaseTool, investmentCaseTool, irrTool, npvTool, paybackTool, pricingTool, roiTool, scenarioCompareTool } from "../tools/strategy-tools";
import { Specialist, labelledAmount } from "./shared";

const cashflows = (e: { amounts: string[]; numbers: number[] }) => (e.amounts.length >= 2 ? e.amounts : e.numbers.filter((n) => Math.abs(n) >= 1));

const rules: RouteRule[] = [
  { kind: "strategy.npv", weight: 3.4, any: [/\bnpv\b/i, /\bnet present value\b/i, /\bpresent value of\b/i], params: (_m, e, _asOf) => ({ rate: e.percents[0], cashflows: cashflows(e) }) },
  { kind: "strategy.irr", weight: 3.4, any: [/\birr\b/i, /\binternal rate of return\b/i], params: (_m, e, _asOf) => ({ cashflows: cashflows(e) }) },
  { kind: "strategy.payback", weight: 3.4, any: [/\bpayback\b/i, /\bpay(s)? (itself|for itself) back\b/i, /\bhow (long|many years) (until|to) (recover|recoup)\b/i], params: (_m, e, _asOf) => ({ cashflows: cashflows(e), rate: e.percents[0] }) },
  { kind: "strategy.break_even", weight: 3.4, any: [/\bbreak[- ]?even\b/i], params: (m, e, _asOf) => ({ fixedCosts: labelledAmount(m, /fixed/) ?? e.amounts[0], pricePerUnit: labelledAmount(m, /price/) ?? e.amounts[1], variableCostPerUnit: labelledAmount(m, /variable/) ?? e.amounts[2], contributionMarginRatio: e.percents[0] }) },
  { kind: "strategy.contribution_margin", weight: 3.4, any: [/\bcontribution margin\b/i, /\bcontribution per unit\b/i], params: (m, e, _asOf) => ({ revenue: labelledAmount(m, /revenue|sales/) ?? e.amounts[0], variableCosts: labelledAmount(m, /variable/) ?? e.amounts[1], units: e.numbers.find((n) => Number.isInteger(n) && n > 0) }) },
  { kind: "strategy.roi", weight: 3.4, any: [/\broi\b/i, /\breturn on investment\b/i], params: (m, e, _asOf) => ({ gain: labelledAmount(m, /return|gain|earn|bring/) ?? e.amounts[1], cost: labelledAmount(m, /cost|invest|spend/) ?? e.amounts[0] }) },
  { kind: "strategy.scenario_compare", weight: 3.4, any: [/\bcompare (the )?scenarios\b/i, /\bscenario comparison\b/i, /\bbase (case )?(vs|versus)\b/i], params: (_m, e, _asOf) => ({ base: e.amounts, scenarios: [] }) },
  { kind: "strategy.pricing", weight: 3.2, any: [/\bprice (increase|change|raise|cut|decrease)\b/i, /\b(raise|increase|lower|cut|change) (our |the )?prices?\b/i, /\bpricing (change|analysis|decision)\b/i, /\bcharge \$?\d[\d,]* instead of\b/i], params: (m, e, _asOf) => ({ currentPrice: labelledAmount(m, /from|current(ly)?|today/) ?? e.amounts[0], newPrice: labelledAmount(m, /to|new/) ?? e.amounts[1], currentUnits: e.numbers.find((n) => Number.isInteger(n) && n > 0) ?? Number(labelledAmount(m, /units?|customers?|clients?|subscribers?/) ?? NaN), variableCostPerUnit: labelledAmount(m, /variable|cost per/) }) },
  { kind: "strategy.hiring_case", weight: 3.2, any: [/\bshould (we|i) hire\b/i, /\bbusiness case for (a |the )?(new )?hire\b/i, /\bhiring (case|decision)\b/i, /\bworth hiring\b/i, /\bhire\b[^.?!]{0,60}\b(pay for (itself|themselves)|revenue|bring in|generate)\b/i, /\bcan we afford (to hire|a hire|an? \w+)\b/i], params: (m, e, _asOf) => ({ grossAnnual: labelledAmount(m, /salary|pay|at|for/) ?? e.amounts[0], expectedRevenueImpactAnnual: labelledAmount(m, /revenue|bring|generate|add/) ?? e.amounts[1], rampMonths: e.durations.find((d) => d.unit === "MONTH")?.value }) },
  { kind: "strategy.investment_case", weight: 3, any: [/\b(should|can) (we|i) (buy|invest|purchase|spend)\b/i, /\bbusiness case for (buying|purchasing|investing|the)\b/i, /\bworth (buying|investing|it to buy)\b/i, /\binvest(ing|ment)\b[^.?!]{0,40}\b(return|benefit|save|payoff|years?)\b/i, /\bbuy (a|an|the|new)\b[^.?!]{0,60}\b(save|return|benefit|per year|a year|annually)\b/i], params: (m, e, _asOf) => ({ cost: labelledAmount(m, /cost|costs|for|spend|invest/) ?? e.amounts[0], annualBenefit: labelledAmount(m, /save|saves|return|returns|benefit|bring|earn|generate/) ?? e.amounts[1], years: e.durations.find((d) => d.unit === "YEAR")?.value, rate: e.percents[0], salvage: labelledAmount(m, /salvage|resale|resell/) }) },
];

export function createStrategyAgent(): Specialist {
  return new Specialist({
    name: "strategy",
    description: "Strategy: NPV, IRR, payback, break-even, contribution margin, hiring and investment cases, pricing changes, scenario comparison and ROI.",
    keywords: [/\bnpv\b/i, /\birr\b/i, /\bpayback\b/i, /\bbreak[- ]?even\b/i, /\bcontribution\b/i, /\broi\b/i, /\binvest/i, /\bpric(e|ing)\b/i, /\bhire\b/i, /\bshould we\b/i, /\bworth\b/i, /\bbusiness case\b/i, /\bdiscount rate\b/i],
    rules,
    tools: [
      [npvTool, "strategy.npv"],
      [irrTool, "strategy.irr"],
      [paybackTool, "strategy.payback"],
      [breakEvenTool, "strategy.break_even"],
      [contributionMarginTool, "strategy.contribution_margin"],
      [hiringCaseTool, "strategy.hiring_case"],
      [pricingTool, "strategy.pricing"],
      [investmentCaseTool, "strategy.investment_case"],
      [scenarioCompareTool, "strategy.scenario_compare"],
      [roiTool, "strategy.roi"],
    ],
  });
}
