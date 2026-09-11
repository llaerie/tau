/**
 * Strategy / corporate finance / valuation eval cases (Domains 6, 7, 12). Every expected value is
 * computed by lib/finance corporate-finance functions (npv, irr, paybackPeriod, breakEven,
 * breakEvenRevenue, contributionMargin, roi, fullyLoadedCost, compareScenarios) on the same inputs.
 */
import { SeededRandom } from "@/lib/core/random";
import { D, add, mul, sub } from "@/lib/core/money";
import { npv, irr, paybackPeriod, breakEven, breakEvenRevenue, contributionMargin, roi, compareScenarios, fullyLoadedCost } from "@/lib/finance";
import { mkCase, R, roundedAmount } from "@/evals/harness/case-builders";
import type { EvalCase } from "@/evals/harness/schema";
import { EVAL_AS_OF_DATE } from "@/evals/harness/synthetic";
import { EVAL_RATE_SET, rateAssumptionSet } from "@/evals/fpa/generators";

const DIR = "strategy" as const;
const META = { asOfDate: EVAL_AS_OF_DATE };

function projectFlows(rng: SeededRandom, years: number): string[] {
  const invest = roundedAmount(rng, 10000, 150000, 500);
  const flows = [D(invest).neg().toFixed(2)];
  for (let t = 1; t <= years; t++) flows.push(roundedAmount(rng, 2000, 60000, 100));
  return flows;
}

function npvIrrCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 8; i++) {
    const rate = rng.pick([0.06, 0.08, 0.1, 0.12, 0.15]);
    const cashflows = projectFlows(rng, rng.int(3, 6));
    const calc = npv(rate, cashflows, META);
    out.push(
      mkCase({
        directory: DIR,
        slug: "npv",
        idParts: [i, rate, ...cashflows],
        competency: "npv",
        difficulty: 2,
        title: `NPV at ${rate * 100}% of ${cashflows.length - 1} annual flows`,
        scenario: "NPV = Σ cf_t / (1+r)^t with t=0 the investment.",
        message: `Cash flows ${cashflows.join(", ")} (t=0 first) at a ${rate * 100}% discount rate. What is the NPV and should we proceed on NPV alone?`,
        task: { kind: "strategy.npv", params: { rate, cashflows } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value as string, tolerance: "0.05" }] },
        rubric: [R.number("npv", "value", calc.value as string, { tolerance: "0.05" }), R.noFabrication({ weight: 1 })],
        tags: ["npv"],
      }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const cashflows = projectFlows(rng, rng.int(3, 6));
    const calc = irr(cashflows, META);
    if (calc.value === null) throw new Error("irr key: unexpected null");
    out.push(
      mkCase({
        directory: DIR,
        slug: "irr",
        idParts: [i, ...cashflows],
        competency: "irr",
        difficulty: 3,
        title: `IRR of ${cashflows.length - 1} annual flows`,
        scenario: "IRR is the rate where NPV = 0 (Newton-Raphson with bisection fallback).",
        message: `What is the IRR of these cash flows: ${cashflows.join(", ")}?`,
        task: { kind: "strategy.irr", params: { cashflows } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value, tolerance: "0.0002" }] },
        rubric: [R.number("irr", "value", calc.value, { tolerance: "0.0002", relativeTolerance: 0.002 }), R.noFabrication({ weight: 1 })],
        tags: ["irr"],
      }),
    );
  }
  for (let i = 0; i < 2; i++) {
    const cashflows = [roundedAmount(rng, 1000, 5000, 100), roundedAmount(rng, 1000, 5000, 100), roundedAmount(rng, 1000, 5000, 100)];
    const calc = irr(cashflows, META);
    if (calc.value !== null) throw new Error("irr no-sign-change key should be null");
    out.push(
      mkCase({
        directory: DIR,
        slug: "irr_no_sign_change",
        idParts: [i, ...cashflows],
        competency: "irr",
        difficulty: 3,
        title: "IRR with no sign change → null",
        scenario: "All-positive cash flows have no IRR; the correct answer is null with an explanation, not a made-up rate.",
        message: `IRR of ${cashflows.join(", ")}?`,
        task: { kind: "strategy.irr", params: { cashflows } },
        fixture: "empty",
        expected: { structured: { value: null } },
        rubric: [R.numberNull("irr-undefined", "value", { description: "IRR is null when cash flows never change sign" }), R.includes("explains", ["sign", "no irr", "does not exist", "undefined"], { any: true, weight: 1 })],
        tags: ["irr", "undefined"],
      }),
    );
  }
  return out;
}

function paybackCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 6; i++) {
    const cashflows = projectFlows(rng, rng.int(3, 6));
    const rate = i % 2 === 0 ? rng.pick([0.08, 0.1, 0.12]) : undefined;
    const calc = paybackPeriod(cashflows, META, rate === undefined ? {} : { rate });
    const v = calc.value!;
    out.push(
      mkCase({
        directory: DIR,
        slug: "payback",
        idParts: [i, rate ?? "none", ...cashflows],
        competency: "payback",
        difficulty: 2,
        title: `Payback period${rate !== undefined ? ` (simple and discounted at ${rate * 100}%)` : ""}`,
        scenario: "Fractional periods until cumulative cash flow turns non-negative; null when it never does.",
        message: `Cash flows ${cashflows.join(", ")}. What is the payback period${rate !== undefined ? ` and the discounted payback at ${rate * 100}%` : ""}?`,
        task: { kind: "strategy.payback", params: { cashflows, ...(rate !== undefined ? { rate } : {}) } },
        fixture: "empty",
        expected: v.simple === null ? { structured: { "values.simple": null } } : { numbers: [{ path: "values.simple", value: v.simple, tolerance: "0.001" }] },
        rubric: [
          v.simple === null ? R.numberNull("simple-never", "values.simple") : R.number("simple", "values.simple", v.simple, { tolerance: "0.001" }),
          ...(rate !== undefined ? [v.discounted === null ? R.numberNull("discounted-never", "values.discounted") : R.number("discounted", "values.discounted", v.discounted, { tolerance: "0.001" })] : [R.numberNull("discounted-not-computed", "values.discounted", { weight: 1, description: "no rate → discounted payback null" })]),
          R.noFabrication({ weight: 1 }),
        ],
        tags: ["payback"],
      }),
    );
  }
  return out;
}

function breakEvenCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 4; i++) {
    const fixedCosts = roundedAmount(rng, 5000, 80000, 100);
    const pricePerUnit = roundedAmount(rng, 50, 500, 5);
    const variableCostPerUnit = i === 3 ? D(pricePerUnit).plus(10).toFixed(2) : roundedAmount(rng, 10, 45, 1);
    const calc = breakEven({ fixedCosts, pricePerUnit, variableCostPerUnit }, META);
    out.push(
      mkCase({
        directory: DIR,
        slug: "break_even_units",
        idParts: [i, fixedCosts, pricePerUnit, variableCostPerUnit],
        competency: "pricing_decisions",
        difficulty: 2,
        title: calc.value === null ? "Break-even unreachable (negative unit contribution) → null" : `Break-even units: fixed ${fixedCosts}, price ${pricePerUnit}, variable ${variableCostPerUnit}`,
        scenario: "break-even units = fixed costs / (price − variable cost); null when contribution per unit ≤ 0.",
        message: `Fixed costs ${fixedCosts}/month, price ${pricePerUnit} per unit, variable cost ${variableCostPerUnit} per unit. How many units to break even?`,
        task: { kind: "strategy.break_even", params: { fixedCosts, pricePerUnit, variableCostPerUnit } },
        fixture: "empty",
        expected: calc.value === null ? { structured: { value: null } } : { numbers: [{ path: "value", value: calc.value, tolerance: "0.01" }] },
        rubric: [calc.value === null ? R.numberNull("unreachable", "value", { description: "break-even is null when unit contribution is not positive" }) : R.number("units", "value", calc.value, { tolerance: "0.01" }), R.noFabrication({ weight: 1 })],
        tags: ["break-even"],
      }),
    );
  }
  for (let i = 0; i < 2; i++) {
    const fixedCosts = roundedAmount(rng, 5000, 80000, 100);
    const cmr = rng.pick([0.35, 0.5, 0.62]);
    const calc = breakEvenRevenue({ fixedCosts, contributionMarginRatio: cmr }, META);
    out.push(
      mkCase({
        directory: DIR,
        slug: "break_even_revenue",
        idParts: [i, fixedCosts, cmr],
        competency: "pricing_decisions",
        difficulty: 2,
        title: `Break-even revenue: fixed ${fixedCosts}, contribution margin ${cmr * 100}%`,
        scenario: "break-even revenue = fixed costs / contribution margin ratio.",
        message: `Fixed costs are ${fixedCosts} a month and our contribution margin is ${cmr * 100}%. What revenue do we need to break even?`,
        task: { kind: "strategy.break_even", params: { fixedCosts, contributionMarginRatio: cmr } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value as string, tolerance: "0.05" }] },
        rubric: [R.number("revenue", "value", calc.value as string, { tolerance: "0.05" }), R.noFabrication({ weight: 1 })],
        tags: ["break-even", "revenue"],
      }),
    );
  }
  return out;
}

function marginRoiCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 5; i++) {
    const revenue = roundedAmount(rng, 20000, 300000, 100);
    const variableCosts = roundedAmount(rng, 5000, 150000, 100);
    const calc = contributionMargin({ revenue, variableCosts }, META).value!;
    out.push(
      mkCase({
        directory: DIR,
        slug: "contribution_margin",
        idParts: [i, revenue, variableCosts],
        competency: "profitability_strategy",
        difficulty: 1,
        title: `Contribution margin on revenue ${revenue}`,
        scenario: "contribution = revenue − variable costs; ratio = contribution / revenue.",
        message: `Revenue ${revenue}, variable costs ${variableCosts}. Contribution margin and ratio?`,
        task: { kind: "strategy.contribution_margin", params: { revenue, variableCosts } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.amount", value: calc.amount }] },
        rubric: [R.number("amount", "values.amount", calc.amount), R.number("ratio", "values.ratio", calc.ratio as number, { tolerance: "0.0001" }), R.noFabrication({ weight: 1 })],
        tags: ["contribution-margin"],
      }),
    );
  }
  for (let i = 0; i < 5; i++) {
    const cost = roundedAmount(rng, 2000, 80000, 100);
    const gain = roundedAmount(rng, 1000, 160000, 100);
    const calc = roi({ gain, cost }, META);
    out.push(
      mkCase({
        directory: DIR,
        slug: "roi",
        idParts: [i, gain, cost],
        competency: "roic",
        difficulty: 1,
        title: `ROI of ${gain} on ${cost}`,
        scenario: "roi = (gain − cost) / cost.",
        message: `We spent ${cost} and got ${gain} back. What's the ROI?`,
        task: { kind: "strategy.roi", params: { gain, cost } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: calc.value as number, tolerance: "0.0001" }] },
        rubric: [R.number("roi", "value", calc.value as number, { tolerance: "0.0001" }), R.noFabrication({ weight: 1 })],
        tags: ["roi"],
      }),
    );
  }
  return out;
}

function investmentCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 6; i++) {
    const cost = roundedAmount(rng, 5000, 90000, 500);
    const annualBenefit = roundedAmount(rng, 1500, 40000, 100);
    const years = rng.int(3, 6);
    const rate = rng.pick([0.08, 0.1, 0.12]);
    const salvage = i % 2 === 0 ? roundedAmount(rng, 0, 5000, 100) : "0.00";
    const flows = [D(cost).neg().toFixed(2), ...Array.from({ length: years }, (_, t) => (t === years - 1 ? add(annualBenefit, salvage) : D(annualBenefit).toFixed(4)))];
    const n = npv(rate, flows, META).value as string;
    const r = irr(flows, META).value;
    const pb = paybackPeriod(flows, META, { rate }).value!;
    out.push(
      mkCase({
        directory: DIR,
        slug: "investment_case",
        idParts: [i, cost, annualBenefit, years, rate, salvage],
        competency: "business_case_preparation",
        difficulty: 3,
        title: `Investment case: ${cost} for ${annualBenefit}/yr over ${years} years at ${rate * 100}%${D(salvage).gt(0) ? `, salvage ${salvage}` : ""}`,
        scenario: "Flows: −cost at t0, annual benefit each year, salvage added in the final year; NPV / IRR / payback from the finance engine.",
        message: `Should we buy the ${cost} system if it saves ${annualBenefit} a year for ${years} years${D(salvage).gt(0) ? ` with ${salvage} resale value at the end` : ""}? Use a ${rate * 100}% hurdle rate.`,
        task: { kind: "strategy.investment_case", params: { cost, annualBenefit, years, rate, salvage } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.npv", value: n, tolerance: "0.05" }] },
        rubric: [R.number("npv", "values.npv", n, { tolerance: "0.05" }), ...(r === null ? [R.numberNull("irr-undefined", "values.irr")] : [R.number("irr", "values.irr", r, { tolerance: "0.0002", relativeTolerance: 0.002 })]), ...(pb.simple === null ? [R.numberNull("payback-never", "values.payback")] : [R.number("payback", "values.payback", pb.simple, { tolerance: "0.001" })]), R.noFabrication({ weight: 1 })],
        tags: ["investment-case", "npv", "irr"],
      }),
    );
  }
  return out;
}

function pricingCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 6; i++) {
    const currentPrice = roundedAmount(rng, 50, 400, 5);
    const newPrice = D(currentPrice).times(rng.pick([0.9, 1.1, 1.2, 1.25])).toDecimalPlaces(2).toFixed(2);
    const currentUnits = rng.int(50, 900);
    const elasticityUnitsChange = i % 3 === 2 ? 0 : -Math.round(currentUnits * rng.float(0.03, 0.25)) * (D(newPrice).gt(currentPrice) ? 1 : -1);
    const variableCostPerUnit = roundedAmount(rng, 5, 40, 1);
    const newUnits = currentUnits + elasticityUnitsChange;
    const currentRevenue = mul(currentPrice, currentUnits);
    const newRevenue = mul(newPrice, newUnits);
    const currentContribution = mul(sub(currentPrice, variableCostPerUnit), currentUnits);
    const newContribution = mul(sub(newPrice, variableCostPerUnit), newUnits);
    out.push(
      mkCase({
        directory: DIR,
        slug: "pricing_change",
        idParts: [i, currentPrice, newPrice, currentUnits, elasticityUnitsChange],
        competency: "pricing_decisions",
        difficulty: 3,
        title: `Price ${currentPrice} → ${newPrice} with ${elasticityUnitsChange} unit change`,
        scenario: "Revenue and contribution before/after; the delta is closed-form from the supplied elasticity.",
        message: `We sell ${currentUnits} units a month at ${currentPrice}. If we move to ${newPrice} and lose/gain ${elasticityUnitsChange} units (variable cost ${variableCostPerUnit}/unit), what happens to revenue and contribution?`,
        task: { kind: "strategy.pricing", params: { currentPrice, newPrice, currentUnits, elasticityUnitsChange, variableCostPerUnit } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.revenueDelta", value: sub(newRevenue, currentRevenue) }] },
        rubric: [R.number("current-revenue", "values.currentRevenue", currentRevenue), R.number("new-revenue", "values.newRevenue", newRevenue), R.number("revenue-delta", "values.revenueDelta", sub(newRevenue, currentRevenue)), R.number("contribution-delta", "values.contributionDelta", sub(newContribution, currentContribution)), R.noFabrication({ weight: 1 })],
        tags: ["pricing"],
      }),
    );
  }
  return out;
}

function scenarioCompareCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  const months = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
  for (let i = 0; i < 4; i++) {
    const base = months.map(() => (rng.int(-15000, 20000)).toFixed(2));
    const names = ["downside", "upside"];
    const scenarios = names.map((name) => ({ name, series: base.map((v) => D(v).plus(name === "downside" ? -rng.int(1000, 8000) : rng.int(500, 6000)).toFixed(2)) }));
    const opening = "0.0000";
    const cmp = compareScenarios(
      { id: "base", label: "Base", openingCash: opening, months: months.map((m, k) => ({ month: m, netCashFlow: D(base[k]).toFixed(4) })) },
      scenarios.map((s) => ({ id: s.name, label: s.name, openingCash: opening, months: months.map((m, k) => ({ month: m, netCashFlow: D(s.series[k]).toFixed(4) })) })),
      META,
    ).value;
    out.push(
      mkCase({
        directory: DIR,
        slug: "scenario_compare",
        idParts: [i, ...base],
        competency: "downside_scenarios",
        difficulty: 3,
        title: `Compare downside/upside monthly net cash series against base (${months.length} months)`,
        scenario: "Cumulative net cash per series; deltas versus base are closed-form sums.",
        message: `Base monthly net cash: ${base.join(", ")}. Downside: ${scenarios[0].series.join(", ")}. Upside: ${scenarios[1].series.join(", ")}. Compare cumulative cash and the delta of each scenario versus base.`,
        task: { kind: "strategy.scenario_compare", params: { base, scenarios } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.baseCumulative", value: cmp.base.cumulativeNet }] },
        rubric: [R.number("base-cumulative", "values.baseCumulative", cmp.base.cumulativeNet), ...cmp.scenarios.map((s, k) => R.number(`delta-${s.id}`, `scenarios.${k}.cumulativeNetDelta`, s.cumulativeNetDelta as string, { description: `${s.id} cumulative net delta vs base` })), ...cmp.scenarios.map((s, k) => R.equals(`label-${s.id}`, `scenarios.${k}.label`, s.label, { weight: 1 })), R.noFabrication({ weight: 1 })],
        tags: ["scenario-compare"],
      }),
    );
  }
  return out;
}

function hiringCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 4; i++) {
    const grossAnnual = roundedAmount(rng, 70000, 200000, 1000);
    const revenue = roundedAmount(rng, 50000, 400000, 1000);
    out.push(
      mkCase({
        directory: DIR,
        slug: "hiring_case_no_rates",
        idParts: [i, grossAnnual, revenue],
        competency: "hiring_decisions",
        difficulty: 3,
        title: `Hiring case at ${grossAnnual} without payroll rates → employer-tax assumption flagged`,
        scenario: "No confirmed payroll rates exist; the case may compare revenue impact to gross wages but must flag employer taxes/benefits as unknown assumptions and never fill them in.",
        message: `Should we hire a ${grossAnnual} engineer who could add ${revenue} of annual revenue?`,
        task: { kind: "strategy.hiring_case", params: { grossAnnual, expectedRevenueImpactAnnual: revenue } },
        fixture: "empty",
        expected: {},
        rubric: [R.nonEmpty("assumption-flagged", "$response.assumptions", { weight: 3, description: "the unknown employer-tax/benefit cost is an explicit assumption" }), R.numberNull("no-invented-total", "value", { weight: 2, description: "no fully loaded cost is asserted without rates (primary value null)" }), R.escalation("insufficient", "INSUFFICIENT_INFORMATION", { weight: 2 }), R.excludesPatterns("no-memorized-rates", ["\\b6\\.2\\s?%", "\\b7\\.65\\s?%", "\\b1\\.45\\s?%"], { weight: 2 }), R.noFabrication({ weight: 1 })],
        tags: ["hiring", "assumption"],
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const grossAnnual = roundedAmount(rng, 70000, 200000, 1000);
    const benefitsMonthly = roundedAmount(rng, 300, 1200, 10);
    const revenue = roundedAmount(rng, 100000, 500000, 1000);
    const calc = fullyLoadedCost({ compensation: { type: "SALARY", amount: grossAnnual, currency: "USD", period: "ANNUAL", basis: "GROSS", status: "CONFIRMED" }, rates: rateAssumptionSet(EVAL_RATE_SET), benefits: mul(benefitsMonthly, 12), overhead: "0", asOfDate: EVAL_AS_OF_DATE }).value!;
    out.push(
      mkCase({
        directory: DIR,
        slug: "hiring_case_with_rates",
        idParts: [i, grossAnnual, benefitsMonthly, revenue],
        competency: "hiring_decisions",
        difficulty: 3,
        title: `Hiring case at ${grossAnnual} with explicit rates and ${benefitsMonthly}/mo benefits`,
        scenario: "Fully loaded annual cost from the finance engine; net annual impact = revenue impact − fully loaded cost.",
        message: `Hire at ${grossAnnual} with ${benefitsMonthly}/month benefits; expected revenue impact ${revenue}/year. Use the rate set provided. What is the fully loaded cost and net impact?`,
        task: { kind: "strategy.hiring_case", params: { grossAnnual, expectedRevenueImpactAnnual: revenue, benefitsMonthly, rateSet: EVAL_RATE_SET } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.fullyLoadedCost", value: calc.total as string, tolerance: "0.05" }] },
        rubric: [R.number("fully-loaded", "values.fullyLoadedCost", calc.total as string, { tolerance: "0.05" }), R.number("net-impact", "values.firstYearNet", sub(revenue, calc.total as string), { tolerance: "0.05" }), R.noFabrication({ weight: 1 })],
        tags: ["hiring", "synthetic-rates"],
      }),
    );
  }
  return out;
}

export function generateCases(): EvalCase[] {
  const rng = new SeededRandom("tau-evals-strategy-v1");
  return [...npvIrrCases(rng.fork("npv")), ...paybackCases(rng.fork("payback")), ...breakEvenCases(rng.fork("breakeven")), ...marginRoiCases(rng.fork("margin")), ...investmentCases(rng.fork("invest")), ...pricingCases(rng.fork("pricing")), ...scenarioCompareCases(rng.fork("scenario")), ...hiringCases(rng.fork("hiring"))];
}
