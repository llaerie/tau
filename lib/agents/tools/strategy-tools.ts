/**
 * Strategy / corporate-finance tools: NPV, IRR, payback, break-even, contribution margin,
 * hiring case, pricing, investment case, scenario comparison and ROI.
 */
import type { CalcResult, DecimalString } from "@/lib/core/types";
import { D, money, mul, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { breakEven, breakEvenRevenue, contributionMargin, irr, npv, paybackPeriod, roi } from "@/lib/finance/corporate-finance";
import { fullyLoadedCost } from "@/lib/finance/headcount";
import { compareScenarios, type CashSeries } from "@/lib/finance/scenario";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { figure, insufficient, moneyFigure, ok, pct, textFigure, toDec } from "./common";
import { buildRateSet, rateAssumptions } from "./payroll-tools";

const flows = (cf: (string | number)[]) => cf.map((c) => money(c));

export const npvTool = defineTool({
  name: "npv",
  description: "Net present value of a cash flow series at a discount rate (t=0 first).",
  riskLevel: "GREEN",
  capabilityKey: "investment_analysis",
  inputSchema: TASKS["strategy.npv"].params,
  async execute(input, ctx) {
    if (!input.cashflows.length) return ok(insufficient(["cash flows"], "Provide the cash flow series (t=0 first)."));
    const c = npv(input.rate, flows(input.cashflows), { asOfDate: ctx.asOfDate });
    return ok({ answer: `NPV at ${pct(input.rate)} of ${input.cashflows.length} cash flows is ${c.value}${c.value && D(c.value).gt(0) ? " (value-creating)" : c.value ? " (value-destroying at this rate)" : ""}.`, numbers: [figure("NPV", c), textFigure("Discount rate", pct(input.rate)), textFigure("Periods", input.cashflows.length - 1)], why: [c.formula], educationKey: "npv", confidence: 0.95, structured: { value: c.value, values: { npv: c.value, rate: input.rate } } }, { calcs: [c] });
  },
});

export const irrTool = defineTool({
  name: "irr",
  description: "Internal rate of return of a cash flow series.",
  riskLevel: "GREEN",
  capabilityKey: "investment_analysis",
  inputSchema: TASKS["strategy.irr"].params,
  async execute(input, ctx) {
    if (input.cashflows.length < 2) return ok(insufficient(["at least two cash flows"], "IRR needs an initial investment and at least one later cash flow."));
    const c = irr(flows(input.cashflows), { asOfDate: ctx.asOfDate });
    return ok({ answer: c.value === null ? `IRR is undefined for this series (${c.notes?.[0] ?? "no sign change or no convergence"}).` : `IRR is ${pct(c.value, 2)} per period.`, numbers: [figure("IRR", c)], why: [c.formula], confidence: 0.9, structured: { value: c.value, values: { irr: c.value } } }, { calcs: [c] });
  },
});

export const paybackTool = defineTool({
  name: "payback_period",
  description: "Simple (and discounted, when a rate is given) payback period.",
  riskLevel: "GREEN",
  capabilityKey: "investment_analysis",
  inputSchema: TASKS["strategy.payback"].params,
  async execute(input, ctx) {
    const c = paybackPeriod(flows(input.cashflows), { asOfDate: ctx.asOfDate }, { rate: input.rate });
    const v = c.value;
    return ok({ answer: v ? `Simple payback ${v.simple === null ? "never" : `${v.simple.toFixed(2)} periods`}${input.rate !== undefined ? `; discounted payback at ${pct(input.rate)} ${v.discounted === null ? "never" : `${v.discounted.toFixed(2)} periods`}` : ""}.` : "Payback could not be computed.", numbers: [textFigure("Simple payback (periods)", v?.simple ?? "never"), textFigure("Discounted payback (periods)", input.rate === undefined ? "n/a (no rate)" : v?.discounted ?? "never")], why: [c.formula, ...(c.notes ?? [])], confidence: 0.9, structured: { value: v?.simple ?? null, values: { simple: v?.simple ?? null, discounted: v?.discounted ?? null } } }, { calcs: [c] });
  },
});

export const breakEvenTool = defineTool({
  name: "break_even",
  description: "Break-even units (price & variable cost) or break-even revenue (contribution margin ratio).",
  riskLevel: "GREEN",
  capabilityKey: "pricing_analysis",
  inputSchema: TASKS["strategy.break_even"].params,
  async execute(input, ctx) {
    const calcs: CalcResult[] = [];
    let answer = "";
    let value: number | DecimalString | null = null;
    const numbers = [moneyFigure("Fixed costs", money(input.fixedCosts))];
    if (input.pricePerUnit !== undefined && input.variableCostPerUnit !== undefined) {
      const u = breakEven({ fixedCosts: money(input.fixedCosts), pricePerUnit: money(input.pricePerUnit), variableCostPerUnit: money(input.variableCostPerUnit) }, { asOfDate: ctx.asOfDate });
      calcs.push(u);
      value = u.value;
      answer = u.value === null ? `Break-even is unreachable: ${u.notes?.[0] ?? "no contribution per unit"}.` : `Break-even is ${u.value.toFixed(2)} units (fixed ${money(input.fixedCosts)} ÷ contribution ${sub(input.pricePerUnit, input.variableCostPerUnit)} per unit).`;
      numbers.push(figure("Break-even units", u), moneyFigure("Contribution per unit", sub(input.pricePerUnit, input.variableCostPerUnit)));
    }
    const cmr = input.contributionMarginRatio ?? (input.pricePerUnit !== undefined && input.variableCostPerUnit !== undefined && !D(input.pricePerUnit).isZero() ? D(sub(input.pricePerUnit, input.variableCostPerUnit)).div(D(input.pricePerUnit)).toNumber() : undefined);
    if (cmr !== undefined) {
      const r = breakEvenRevenue({ fixedCosts: money(input.fixedCosts), contributionMarginRatio: cmr }, { asOfDate: ctx.asOfDate });
      calcs.push(r);
      if (value === null) value = r.value;
      answer += `${answer ? " " : ""}Break-even revenue at a ${pct(cmr)} contribution margin is ${r.value ?? "unreachable"}.`;
      numbers.push(figure("Break-even revenue", r));
    }
    if (!calcs.length) return ok(insufficient(["price and variable cost per unit, or a contribution margin ratio"], "I need either unit economics or a contribution margin ratio."));
    return ok({ answer, numbers, why: calcs.map((c) => c.formula), educationKey: "break_even", confidence: 0.95, structured: { value, values: Object.fromEntries(calcs.map((c) => [c.name, c.value])) } }, { calcs });
  },
});

export const contributionMarginTool = defineTool({
  name: "contribution_margin",
  description: "Contribution margin and ratio from revenue and variable costs.",
  riskLevel: "GREEN",
  capabilityKey: "pricing_analysis",
  inputSchema: TASKS["strategy.contribution_margin"].params,
  async execute(input, ctx) {
    const c = contributionMargin({ revenue: money(input.revenue), variableCosts: money(input.variableCosts) }, { asOfDate: ctx.asOfDate });
    const v = c.value!;
    const perUnit = input.units ? D(v.amount).div(input.units).toFixed(4) : null;
    return ok({ answer: `Contribution margin is ${v.amount} (${pct(v.ratio)} of revenue ${money(input.revenue)})${perUnit ? `, ${perUnit} per unit over ${input.units} units` : ""}.`, numbers: [moneyFigure("Contribution margin", v.amount, c.id), textFigure("Ratio", pct(v.ratio)), ...(perUnit ? [moneyFigure("Per unit", perUnit)] : [])], why: [c.formula], educationKey: "contribution_margin", confidence: 0.95, structured: { value: v.amount, values: { amount: v.amount, ratio: v.ratio, perUnit } } }, { calcs: [c] });
  },
});

export const hiringCaseTool = defineTool({
  name: "hiring_case",
  description: "Economics of a hire: fully loaded cost (rates required) versus expected revenue impact with ramp.",
  riskLevel: "GREEN",
  capabilityKey: "hiring_analysis",
  inputSchema: TASKS["strategy.hiring_case"].params,
  async execute(input, ctx) {
    const gross = money(input.grossAnnual);
    const rs = buildRateSet(ctx, input.rateSet, "UNCONFIRMED");
    const benefits = input.benefitsMonthly === undefined ? null : mul(input.benefitsMonthly, 12);
    const flc = fullyLoadedCost({ compensation: { type: "SALARY", amount: gross, currency: "USD", period: "ANNUAL", basis: "GROSS", status: "UNCONFIRMED" }, rates: rs.rates, benefits, overhead: "0.0000", asOfDate: ctx.asOfDate });
    const revenue = toDec(input.expectedRevenueImpactAnnual);
    const ramp = input.rampMonths ?? 0;
    const firstYearRevenue = revenue ? D(revenue).times(Math.max(0, 12 - ramp)).div(12).toFixed(4) : null;
    const calcs: CalcResult[] = [flc];
    const cost = flc.value?.total ?? flc.value?.wagesPlusEmployerTaxes ?? null;
    let net: DecimalString | null = null;
    if (cost && firstYearRevenue) {
      const n = makeCalc<DecimalString>({ name: "hire_first_year_net", value: sub(firstYearRevenue, cost), unit: "USD", formula: "first_year_net = revenue_impact × (12 - ramp_months)/12 - fully_loaded_cost", inputs: { revenueImpact: revenue, rampMonths: ramp, fullyLoadedCost: cost }, asOfDate: ctx.asOfDate, assumptions: [{ key: "revenue_impact", description: "Expected revenue impact is an assumption supplied by the requester.", value: revenue, status: "UNCONFIRMED" }] });
      calcs.push(n);
      net = n.value;
    }
    const assumptionLines = [`Gross salary ${gross}/year (as stated)`, ...(revenue ? [`Revenue impact ${revenue}/year with ${ramp}-month ramp (ASSUMED)`] : []), ...(rs.source === "NONE" ? ["Employer payroll tax rates unavailable — not assumed"] : rateAssumptions(rs).map((a) => `[${a.status}] ${a.description}`))];
    if (!flc.value) {
      return ok({ ...insufficient(rs.missingEmployerRates.map((k) => `payroll rate ${k}`), `Gross salary ${gross}/year and ${revenue ? `revenue impact ${revenue}` : "no revenue impact"} are known, but employer payroll taxes cannot be computed without authoritative rates or an explicit rateSet, so the fully loaded cost is null.`, { numbers: [moneyFigure("Gross salary", gross), moneyFigure("Revenue impact (assumed)", revenue)], highRisk: { facts: [`Gross salary ${gross}`], calculations: [], assumptions: assumptionLines, professionalJudgment: ["Employer tax rates must be confirmed from an authoritative source."] } }) }, { calcs, assumptions: rateAssumptions(rs) });
    }
    const v = flc.value;
    return ok({
      answer: `A ${gross}/year hire costs about ${cost}/year fully loaded (employer taxes ${v.employerTaxes}${benefits ? `, benefits ${benefits}` : ""}).${revenue ? ` Against an assumed ${revenue}/year revenue impact with a ${ramp}-month ramp (${firstYearRevenue} in year one), the first-year net is ${net}.` : " No revenue impact was given, so this is cost only."}`,
      numbers: [moneyFigure("Fully loaded cost", cost, flc.id), moneyFigure("Employer taxes", v.employerTaxes), moneyFigure("Year-one revenue (assumed, after ramp)", firstYearRevenue), moneyFigure("Year-one net", net, calcs[1]?.id)],
      why: [flc.formula],
      risks: [...(rs.allConfirmed ? [] : ["Payroll rate assumptions are not confirmed; cost is a planning estimate."]), ...(net && D(net).lt(0) ? ["Negative first-year net: the hire is a cash investment that must be funded from reserves."] : [])],
      confidence: rs.allConfirmed ? 0.8 : 0.65,
      highRisk: { facts: [`Gross salary ${gross}`], calculations: calcs.map((c) => `${c.name} = ${c.value && typeof c.value === "object" ? cost : c.value} [${c.id}]`), assumptions: assumptionLines, professionalJudgment: ["Worker classification and benefits obligations are confirmed by the CPA / payroll professional."] },
      structured: { value: net ?? cost, values: { grossAnnual: gross, fullyLoadedCost: cost, employerTaxes: v.employerTaxes, firstYearRevenue, firstYearNet: net, rampMonths: ramp }, rateSource: rs.source },
    }, { calcs });
  },
});

export const pricingTool = defineTool({
  name: "pricing_analysis",
  description: "Revenue and contribution impact of a price change with an explicit unit-volume assumption.",
  riskLevel: "GREEN",
  capabilityKey: "pricing_analysis",
  inputSchema: TASKS["strategy.pricing"].params,
  async execute(input, ctx) {
    const cur = D(input.currentPrice).times(input.currentUnits).toFixed(4);
    const newUnits = input.currentUnits + (input.elasticityUnitsChange ?? 0);
    const next = D(input.newPrice).times(newUnits).toFixed(4);
    const vc = toDec(input.variableCostPerUnit);
    const curCm = vc ? D(sub(input.currentPrice, vc)).times(input.currentUnits).toFixed(4) : null;
    const newCm = vc ? D(sub(input.newPrice, vc)).times(newUnits).toFixed(4) : null;
    const calc = makeCalc({ name: "pricing_change_impact", value: { currentRevenue: cur, newRevenue: next, revenueDelta: sub(next, cur), currentContribution: curCm, newContribution: newCm, contributionDelta: curCm && newCm ? sub(newCm, curCm) : null, newUnits }, unit: "OBJECT", formula: "revenue = price × units; contribution = (price - variable_cost) × units; units after change = current_units + elasticity_units_change", inputs: { currentPrice: money(input.currentPrice), newPrice: money(input.newPrice), currentUnits: input.currentUnits, elasticityUnitsChange: input.elasticityUnitsChange ?? 0, variableCostPerUnit: vc }, asOfDate: ctx.asOfDate, assumptions: [{ key: "volume_response", description: input.elasticityUnitsChange === undefined ? "ASSUMED: no volume change from the price change (none supplied)." : `Volume change of ${input.elasticityUnitsChange} units supplied by the requester.`, value: input.elasticityUnitsChange ?? 0, status: "UNCONFIRMED" }] });
    const v = calc.value;
    return ok({
      answer: `Moving price from ${money(input.currentPrice)} to ${money(input.newPrice)} at ${newUnits} units changes revenue from ${cur} to ${next} (${v.revenueDelta})${newCm ? ` and contribution from ${curCm} to ${newCm} (${v.contributionDelta})` : ""}. ${input.elasticityUnitsChange === undefined ? "Volume is assumed unchanged — supply an elasticity estimate to test that." : ""}`,
      numbers: [moneyFigure("Current revenue", cur), moneyFigure("New revenue", next, calc.id), moneyFigure("Revenue change", v.revenueDelta), ...(newCm ? [moneyFigure("Contribution change", v.contributionDelta)] : []), textFigure("Units after change", newUnits)],
      why: [calc.formula],
      confidence: input.elasticityUnitsChange === undefined ? 0.6 : 0.8,
      structured: { value: v.revenueDelta, values: { currentRevenue: cur, newRevenue: next, revenueDelta: v.revenueDelta, currentContribution: curCm, newContribution: newCm, contributionDelta: v.contributionDelta, newUnits } },
    }, { calcs: [calc] });
  },
});

export const investmentCaseTool = defineTool({
  name: "investment_case",
  description: "Business case for a purchase: NPV, IRR, payback and ROI from cost, annual benefit, years, rate and salvage.",
  riskLevel: "GREEN",
  capabilityKey: "investment_analysis",
  inputSchema: TASKS["strategy.investment_case"].params,
  async execute(input, ctx) {
    if (input.years <= 0) return ok(insufficient(["years (> 0)"], "The horizon must be at least one year."));
    const cf: DecimalString[] = [D(input.cost).neg().toFixed(4)];
    for (let y = 1; y <= input.years; y++) cf.push(y === input.years && input.salvage !== undefined ? D(input.annualBenefit).plus(D(input.salvage)).toFixed(4) : money(input.annualBenefit));
    const meta = { asOfDate: ctx.asOfDate };
    const n = npv(input.rate, cf, meta);
    const i = irr(cf, meta);
    const p = paybackPeriod(cf, meta, { rate: input.rate });
    const gain = cf.slice(1).reduce((a, c) => a.plus(D(c)), D(0)).toFixed(4);
    const r = roi({ gain, cost: money(input.cost) }, meta);
    return ok({
      answer: `Investing ${money(input.cost)} for ${money(input.annualBenefit)}/year over ${input.years} years${input.salvage !== undefined ? ` (salvage ${money(input.salvage)})` : ""} at ${pct(input.rate)}: NPV ${n.value}, IRR ${i.value === null ? "n/a" : pct(i.value, 1)}, payback ${p.value?.simple === null || p.value?.simple === undefined ? "never" : `${p.value.simple.toFixed(2)} years`}, ROI ${pct(r.value)}. ${n.value && D(n.value).gt(0) ? "Positive NPV supports the case" : "Negative NPV argues against it"} on these assumptions.`,
      numbers: [figure("NPV", n), figure("IRR", i), textFigure("Payback (years)", p.value?.simple ?? "never"), figure("ROI", r), moneyFigure("Total benefit", gain)],
      why: [n.formula, "Annual benefit and salvage are assumptions supplied by the requester."],
      educationKey: "npv",
      confidence: 0.85,
      structured: { value: n.value, values: { npv: n.value, irr: i.value, payback: p.value?.simple ?? null, discountedPayback: p.value?.discounted ?? null, roi: r.value, totalBenefit: gain }, cashflows: cf },
    }, { calcs: [n, i, p, r] });
  },
});

export const scenarioCompareTool = defineTool({
  name: "scenario_compare",
  description: "Compare monthly cash-flow scenarios against a base series.",
  riskLevel: "GREEN",
  capabilityKey: "scenario_analysis",
  inputSchema: TASKS["strategy.scenario_compare"].params,
  async execute(input, ctx) {
    if (!input.base.length) return ok(insufficient(["base series"], "Provide the base monthly net cash flow series."));
    const months = input.base.map((_, i) => `P${String(i + 1).padStart(2, "0")}`);
    const series = (id: string, label: string, s: (string | number)[]): CashSeries => ({ id, label, openingCash: "0.0000", months: s.map((v, i) => ({ month: months[i] ?? `P${String(i + 1).padStart(2, "0")}`, netCashFlow: money(v) })) });
    const c = compareScenarios(series("base", "Base", input.base), input.scenarios.map((s, i) => series(`s${i + 1}`, s.name, s.series)), { asOfDate: ctx.asOfDate });
    const v = c.value;
    return ok({
      answer: `Base cumulative ${v.base.cumulativeNet} (min ${v.base.minCash}); ${v.scenarios.map((s) => `${s.label}: cumulative ${s.cumulativeNet} (${s.cumulativeNetDelta} vs base, min ${s.minCash})`).join("; ")}.`,
      numbers: [moneyFigure("Base cumulative", v.base.cumulativeNet, c.id), ...v.scenarios.flatMap((s) => [moneyFigure(`${s.label} cumulative`, s.cumulativeNet), moneyFigure(`${s.label} delta vs base`, s.cumulativeNetDelta)])],
      why: [c.formula],
      confidence: 0.9,
      structured: { value: v.base.cumulativeNet, values: { baseCumulative: v.base.cumulativeNet, ...Object.fromEntries(v.scenarios.map((s) => [`${s.id}_cumulative`, s.cumulativeNet])) }, scenarios: v.scenarios, rows: v.rows },
    }, { calcs: [c] });
  },
});

export const roiTool = defineTool({
  name: "roi",
  description: "Return on investment = (gain − cost) / cost.",
  riskLevel: "GREEN",
  capabilityKey: "investment_analysis",
  inputSchema: TASKS["strategy.roi"].params,
  async execute(input, ctx) {
    const c = roi({ gain: money(input.gain), cost: money(input.cost) }, { asOfDate: ctx.asOfDate });
    return ok({ answer: `ROI on ${money(input.cost)} returning ${money(input.gain)} is ${pct(c.value)}.`, numbers: [figure("ROI", c), moneyFigure("Gain", money(input.gain)), moneyFigure("Cost", money(input.cost))], why: [c.formula], confidence: 0.95, structured: { value: c.value, values: { roi: c.value } } }, { calcs: [c] });
  },
});

export const strategyTools = [npvTool, irrTool, paybackTool, breakEvenTool, contributionMarginTool, hiringCaseTool, pricingTool, investmentCaseTool, scenarioCompareTool, roiTool];
