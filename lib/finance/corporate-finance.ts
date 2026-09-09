/**
 * Corporate finance calculations: NPV, IRR, payback, break-even, contribution margin, ROI,
 * profitability index, annuity payment, WACC.
 *
 * Cash flow arrays: index 0 is t=0 (usually the negative initial investment).
 * Rates are plain ratios (0.10 = 10%). Money outputs are DecimalStrings computed with decimal.js.
 */
import Decimal from "decimal.js";
import type { CalcResult, DecimalString, ID, ISODate } from "@/lib/core/types";
import { D } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, type NumericInput } from "./calc-result";

export interface CalcMeta {
  asOfDate: ISODate;
  sourceIds?: ID[];
}

const flows = (cashflows: NumericInput[]): DecimalString[] => cashflows.map((c) => (isUnknown(c) ? "null" : dec(c)));

function unknownFlows(cashflows: NumericInput[]): string[] {
  return cashflows.map((c, i) => (isUnknown(c) ? `cash flow at t=${i}` : null)).filter((x): x is string => x !== null);
}

function pvOf(cf: Decimal, rate: Decimal, t: number): Decimal {
  return cf.div(rate.plus(1).pow(t));
}

/** Net present value: sum_t cf_t / (1 + rate)^t, index 0 = t0. */
export function npv(rate: NumericInput, cashflows: NumericInput[], meta: CalcMeta): CalcResult<DecimalString | null> {
  const name = "npv";
  const formula = "npv = sum_t cf_t / (1 + rate)^t (t = 0..n)";
  const inputs = { rate: isUnknown(rate) ? null : Number(rate), cashflows: flows(cashflows) };
  const missing = [...(isUnknown(rate) ? ["discount rate"] : []), ...unknownFlows(cashflows)];
  if (!cashflows.length) missing.push("cash flows");
  if (missing.length) return insufficient({ name, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const r = D(rate as number);
  const value = cashflows.reduce<Decimal>((acc, cf, t) => acc.plus(pvOf(D(cf as DecimalString), r, t)), D(0)).toFixed(4);
  return makeCalc<DecimalString | null>({ name, value, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

export interface IrrOptions {
  guess?: number;
  tolerance?: number;
  maxIterations?: number;
}

function npvNumber(rate: number, cfs: number[]): number {
  return cfs.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}
function dNpvNumber(rate: number, cfs: number[]): number {
  return cfs.reduce((acc, cf, t) => acc - (t * cf) / Math.pow(1 + rate, t + 1), 0);
}

/**
 * Internal rate of return via Newton-Raphson with bisection fallback.
 * Returns null (with a note) when cash flows have no sign change (no IRR exists).
 */
export function irr(cashflows: NumericInput[], meta: CalcMeta, opts: IrrOptions = {}): CalcResult<number | null> {
  const name = "irr";
  const formula = "irr = rate r such that sum_t cf_t / (1 + r)^t = 0 (Newton-Raphson, bisection fallback)";
  const inputs = { cashflows: flows(cashflows), guess: opts.guess ?? 0.1 };
  const missing = unknownFlows(cashflows);
  if (cashflows.length < 2) missing.push("at least two cash flows");
  if (missing.length) return insufficient({ name, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const cfs = cashflows.map((c) => D(c as DecimalString).toNumber());
  const hasPos = cfs.some((c) => c > 0);
  const hasNeg = cfs.some((c) => c < 0);
  if (!hasPos || !hasNeg) {
    return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["No sign change in cash flows; IRR does not exist."] });
  }
  const tol = opts.tolerance ?? 1e-10;
  const maxIter = opts.maxIterations ?? 100;
  let rate = opts.guess ?? 0.1;
  let converged = false;
  let method = "newton";
  for (let i = 0; i < maxIter; i++) {
    const f = npvNumber(rate, cfs);
    const df = dNpvNumber(rate, cfs);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < tol) {
      rate = next;
      converged = true;
      break;
    }
    rate = next;
  }
  if (!converged || Math.abs(npvNumber(rate, cfs)) > 1e-6) {
    // Bisection over a wide bracket
    method = "bisection";
    let lo = -0.9999;
    let hi = 10;
    let flo = npvNumber(lo, cfs);
    let fhi = npvNumber(hi, cfs);
    if (flo * fhi > 0) {
      // Try to find a bracket by scanning
      let found = false;
      for (let x = -0.99; x < 10 && !found; x += 0.05) {
        const fx = npvNumber(x, cfs);
        if (flo * fx <= 0) {
          hi = x;
          fhi = fx;
          found = true;
        } else {
          lo = x;
          flo = fx;
        }
      }
      if (!found) {
        return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["IRR did not converge: no root found in [-99.99%, 1000%]."] });
      }
    }
    for (let i = 0; i < 500; i++) {
      const mid = (lo + hi) / 2;
      const fmid = npvNumber(mid, cfs);
      if (Math.abs(fmid) < tol || (hi - lo) / 2 < tol) {
        rate = mid;
        converged = true;
        break;
      }
      if (flo * fmid < 0) {
        hi = mid;
        fhi = fmid;
      } else {
        lo = mid;
        flo = fmid;
      }
      rate = mid;
    }
    void fhi;
  }
  return makeCalc<number | null>({ name, value: round(rate, 8), unit: "PERCENT", formula, inputs: { ...inputs, method }, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

export interface PaybackResult {
  /** Fractional periods until cumulative undiscounted cash flow reaches zero; null if never. */
  simple: number | null;
  /** Fractional periods on discounted flows; null if never or no rate supplied. */
  discounted: number | null;
}

function paybackOf(cfs: Decimal[]): number | null {
  let cum = D(0);
  for (let t = 0; t < cfs.length; t++) {
    const prev = cum;
    cum = cum.plus(cfs[t]);
    if (cum.gte(0) && t > 0 && prev.lt(0)) {
      if (cfs[t].isZero()) return t;
      return round(t - 1 + prev.neg().div(cfs[t]).toNumber(), 6);
    }
    if (cum.gte(0) && t === 0) return 0;
  }
  return null;
}

/** Simple and (optionally) discounted payback period in fractional periods. */
export function paybackPeriod(cashflows: NumericInput[], meta: CalcMeta, opts: { rate?: number } = {}): CalcResult<PaybackResult | null> {
  const name = "payback_period";
  const formula = "payback = (last period with negative cumulative) + |cumulative| / next period cash flow; discounted uses cf_t / (1+rate)^t";
  const inputs = { cashflows: flows(cashflows), rate: opts.rate ?? null };
  const missing = unknownFlows(cashflows);
  if (!cashflows.length) missing.push("cash flows");
  if (missing.length) return insufficient({ name, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const cfs = cashflows.map((c) => D(c as DecimalString));
  const simple = paybackOf(cfs);
  const notes: string[] = [];
  let discounted: number | null = null;
  if (opts.rate === undefined) notes.push("Discounted payback not computed: no discount rate supplied.");
  else discounted = paybackOf(cfs.map((cf, t) => pvOf(cf, D(opts.rate as number), t)));
  if (simple === null) notes.push("Cumulative cash flow never turns positive; simple payback is undefined.");
  return makeCalc<PaybackResult | null>({ name, value: { simple, discounted }, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes });
}

export interface BreakEvenUnitsInput {
  fixedCosts: NumericInput;
  pricePerUnit: NumericInput;
  variableCostPerUnit: NumericInput;
}

/** Break-even units = fixed costs / (price - variable cost per unit). */
export function breakEven(input: BreakEvenUnitsInput, meta: CalcMeta): CalcResult<number | null> {
  const name = "break_even_units";
  const formula = "break_even_units = fixed_costs / (price_per_unit - variable_cost_per_unit)";
  const inputs = { fixedCosts: isUnknown(input.fixedCosts) ? null : dec(input.fixedCosts), pricePerUnit: isUnknown(input.pricePerUnit) ? null : dec(input.pricePerUnit), variableCostPerUnit: isUnknown(input.variableCostPerUnit) ? null : dec(input.variableCostPerUnit) };
  const missing: string[] = [];
  if (isUnknown(input.fixedCosts)) missing.push("fixed costs");
  if (isUnknown(input.pricePerUnit)) missing.push("price per unit");
  if (isUnknown(input.variableCostPerUnit)) missing.push("variable cost per unit");
  if (missing.length) return insufficient({ name, unit: "COUNT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const cmUnit = D(input.pricePerUnit as DecimalString).minus(D(input.variableCostPerUnit as DecimalString));
  if (cmUnit.lte(0)) {
    return makeCalc<number | null>({ name, value: null, unit: "COUNT", formula, inputs: { ...inputs, contributionMarginPerUnit: cmUnit.toFixed(4) }, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Contribution margin per unit is zero or negative; break-even is unreachable."] });
  }
  const value = round(D(input.fixedCosts as DecimalString).div(cmUnit).toNumber(), 6);
  return makeCalc<number | null>({ name, value, unit: "COUNT", formula, inputs: { ...inputs, contributionMarginPerUnit: cmUnit.toFixed(4) }, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

/** Break-even revenue = fixed costs / contribution margin ratio. */
export function breakEvenRevenue(input: { fixedCosts: NumericInput; contributionMarginRatio: number | null | undefined }, meta: CalcMeta): CalcResult<DecimalString | null> {
  const name = "break_even_revenue";
  const formula = "break_even_revenue = fixed_costs / contribution_margin_ratio";
  const inputs = { fixedCosts: isUnknown(input.fixedCosts) ? null : dec(input.fixedCosts), contributionMarginRatio: input.contributionMarginRatio ?? null };
  const missing: string[] = [];
  if (isUnknown(input.fixedCosts)) missing.push("fixed costs");
  if (input.contributionMarginRatio === null || input.contributionMarginRatio === undefined) missing.push("contribution margin ratio");
  if (missing.length) return insufficient({ name, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const cmr = D(input.contributionMarginRatio as number);
  if (cmr.lte(0)) {
    return makeCalc<DecimalString | null>({ name, value: null, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Contribution margin ratio is zero or negative; break-even is unreachable."] });
  }
  return makeCalc<DecimalString | null>({ name, value: D(input.fixedCosts as DecimalString).div(cmr).toFixed(4), unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

export interface ContributionMargin {
  amount: DecimalString;
  /** amount / revenue; null when revenue is zero */
  ratio: number | null;
}

/** Contribution margin = revenue - variable costs (and its ratio to revenue). */
export function contributionMargin(input: { revenue: NumericInput; variableCosts: NumericInput }, meta: CalcMeta): CalcResult<ContributionMargin | null> {
  const name = "contribution_margin";
  const formula = "contribution_margin = revenue - variable_costs; ratio = contribution_margin / revenue";
  const inputs = { revenue: isUnknown(input.revenue) ? null : dec(input.revenue), variableCosts: isUnknown(input.variableCosts) ? null : dec(input.variableCosts) };
  const missing: string[] = [];
  if (isUnknown(input.revenue)) missing.push("revenue");
  if (isUnknown(input.variableCosts)) missing.push("variable costs");
  if (missing.length) return insufficient({ name, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const rev = D(input.revenue as DecimalString);
  const amount = rev.minus(D(input.variableCosts as DecimalString));
  const ratio = rev.isZero() ? null : round(amount.div(rev).toNumber());
  return makeCalc<ContributionMargin | null>({ name, value: { amount: amount.toFixed(4), ratio }, unit: "OBJECT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: rev.isZero() ? ["Revenue is zero; ratio undefined."] : [] });
}

/** ROI = (gain - cost) / cost. */
export function roi(input: { gain: NumericInput; cost: NumericInput }, meta: CalcMeta): CalcResult<number | null> {
  const name = "roi";
  const formula = "roi = (gain - cost) / cost";
  const inputs = { gain: isUnknown(input.gain) ? null : dec(input.gain), cost: isUnknown(input.cost) ? null : dec(input.cost) };
  const missing: string[] = [];
  if (isUnknown(input.gain)) missing.push("gain (total return)");
  if (isUnknown(input.cost)) missing.push("cost (investment)");
  if (missing.length) return insufficient({ name, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const cost = D(input.cost as DecimalString);
  if (cost.isZero()) return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Cost is zero; ROI undefined."] });
  return makeCalc<number | null>({ name, value: round(D(input.gain as DecimalString).minus(cost).div(cost.abs()).toNumber()), unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

/** Profitability index = PV of future cash flows (t>=1) / |initial investment| (t=0). */
export function profitabilityIndex(rate: NumericInput, cashflows: NumericInput[], meta: CalcMeta): CalcResult<number | null> {
  const name = "profitability_index";
  const formula = "profitability_index = sum_{t>=1} cf_t / (1 + rate)^t / |cf_0|";
  const inputs = { rate: isUnknown(rate) ? null : Number(rate), cashflows: flows(cashflows) };
  const missing = [...(isUnknown(rate) ? ["discount rate"] : []), ...unknownFlows(cashflows)];
  if (cashflows.length < 2) missing.push("initial investment and at least one future cash flow");
  if (missing.length) return insufficient({ name, unit: "RATIO", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const r = D(rate as number);
  const initial = D(cashflows[0] as DecimalString).abs();
  if (initial.isZero()) return makeCalc<number | null>({ name, value: null, unit: "RATIO", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Initial investment is zero; profitability index undefined."] });
  const pv = cashflows.slice(1).reduce<Decimal>((acc, cf, i) => acc.plus(pvOf(D(cf as DecimalString), r, i + 1)), D(0));
  return makeCalc<number | null>({ name, value: round(pv.div(initial).toNumber()), unit: "RATIO", formula, inputs: { ...inputs, pvFutureFlows: pv.toFixed(4) }, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

/** Level annuity payment: P * r / (1 - (1 + r)^-n); r = 0 → P / n. */
export function annuityPayment(input: { principal: NumericInput; ratePerPeriod: number | null | undefined; periods: number | null | undefined }, meta: CalcMeta): CalcResult<DecimalString | null> {
  const name = "annuity_payment";
  const formula = "payment = principal * r / (1 - (1 + r)^-n); r = 0 → principal / n";
  const inputs = { principal: isUnknown(input.principal) ? null : dec(input.principal), ratePerPeriod: input.ratePerPeriod ?? null, periods: input.periods ?? null };
  const missing: string[] = [];
  if (isUnknown(input.principal)) missing.push("principal");
  if (input.ratePerPeriod === null || input.ratePerPeriod === undefined) missing.push("rate per period");
  if (input.periods === null || input.periods === undefined) missing.push("number of periods");
  if (missing.length) return insufficient({ name, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const n = input.periods as number;
  if (n <= 0) return makeCalc<DecimalString | null>({ name, value: null, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Number of periods must be positive."] });
  const p = D(input.principal as DecimalString);
  const r = D(input.ratePerPeriod as number);
  const value = r.isZero() ? p.div(n) : p.times(r).div(D(1).minus(r.plus(1).pow(-n)));
  return makeCalc<DecimalString | null>({ name, value: value.toFixed(4), unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

export interface WaccInput {
  equityValue: NumericInput;
  debtValue: NumericInput;
  costOfEquity: number | null | undefined;
  costOfDebt: number | null | undefined;
  taxRate: number | null | undefined;
}

/** WACC = E/(D+E) * Re + D/(D+E) * Rd * (1 - t). Conceptual; any unknown input → null. */
export function wacc(input: WaccInput, meta: CalcMeta): CalcResult<number | null> {
  const name = "wacc";
  const formula = "wacc = E/(D+E) * cost_of_equity + D/(D+E) * cost_of_debt * (1 - tax_rate)";
  const inputs = { equityValue: isUnknown(input.equityValue) ? null : dec(input.equityValue), debtValue: isUnknown(input.debtValue) ? null : dec(input.debtValue), costOfEquity: input.costOfEquity ?? null, costOfDebt: input.costOfDebt ?? null, taxRate: input.taxRate ?? null };
  const missing: string[] = [];
  if (isUnknown(input.equityValue)) missing.push("equity value");
  if (isUnknown(input.debtValue)) missing.push("debt value");
  if (input.costOfEquity === null || input.costOfEquity === undefined) missing.push("cost of equity");
  if (input.costOfDebt === null || input.costOfDebt === undefined) missing.push("cost of debt");
  if (input.taxRate === null || input.taxRate === undefined) missing.push("tax rate");
  const assumptions = [{ key: "wacc_conceptual", description: "WACC for a private S-corporation is a conceptual estimate; cost of equity and tax treatment require professional judgment.", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED" as const, requiresProfessionalReview: true }];
  if (missing.length) return insufficient({ name, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds, assumptions });
  const e = D(input.equityValue as DecimalString);
  const d = D(input.debtValue as DecimalString);
  const total = e.plus(d);
  if (total.isZero()) return makeCalc<number | null>({ name, value: null, unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, assumptions, notes: ["Total capital is zero; WACC undefined."] });
  const value = e.div(total).times(input.costOfEquity as number).plus(d.div(total).times(input.costOfDebt as number).times(D(1).minus(input.taxRate as number)));
  return makeCalc<number | null>({ name, value: round(value.toNumber()), unit: "PERCENT", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, assumptions });
}
