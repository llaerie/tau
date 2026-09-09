/**
 * Cash health calculations: burn rate, runway, reserve coverage, working capital, liquidity ratios.
 * Cash amounts are DecimalStrings; ratios and month counts are numbers.
 */
import type { CalcResult, DecimalString, ID, ISODate } from "@/lib/core/types";
import type { BalanceSheet } from "@/lib/core/contracts";
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { D, add, isZero, sub } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, safeRatio, type NumericInput } from "./calc-result";

export interface MonthlyCashPoint {
  month: string; // YYYY-MM
  /** Closing cash balance for the month */
  balance: DecimalString;
}
export interface MonthlyNetFlow {
  month: string; // YYYY-MM
  /** Signed net cash flow for the month (negative = outflow) */
  netFlow: DecimalString;
}

export interface BurnRateInput {
  /** Either monthly closing balances (needs N+1 points) ... */
  monthlyCashBalances?: MonthlyCashPoint[];
  /** ... or monthly net cash flows (needs N points). */
  monthlyNetCashFlows?: MonthlyNetFlow[];
  /** Number of trailing months to average over (default 3). */
  months?: number;
  asOfDate: ISODate;
  sourceIds?: ID[];
}

/**
 * Average net cash OUTFLOW per month over the trailing N months.
 * Positive value = the company is burning cash; negative = net cash generation.
 */
export function burnRate(input: BurnRateInput): CalcResult<DecimalString | null> {
  const n = input.months ?? 3;
  const name = "burn_rate";
  const formula = "burn_rate = -(sum of monthly net cash flows over trailing N months) / N";
  const sourceIds = input.sourceIds ?? [];
  let flows: MonthlyNetFlow[] = [];
  if (input.monthlyNetCashFlows && input.monthlyNetCashFlows.length) {
    flows = [...input.monthlyNetCashFlows].sort((a, b) => (a.month < b.month ? -1 : 1));
  } else if (input.monthlyCashBalances && input.monthlyCashBalances.length >= 2) {
    const pts = [...input.monthlyCashBalances].sort((a, b) => (a.month < b.month ? -1 : 1));
    for (let i = 1; i < pts.length; i++) flows.push({ month: pts[i].month, netFlow: sub(pts[i].balance, pts[i - 1].balance) });
  }
  if (!flows.length) {
    return insufficient({
      name,
      unit: "USD",
      formula,
      inputs: { months: n, monthlyNetCashFlows: input.monthlyNetCashFlows ?? null, monthlyCashBalances: input.monthlyCashBalances ?? null },
      asOfDate: input.asOfDate,
      missing: ["monthly cash history (at least one monthly net cash flow or two monthly balances)"],
      sourceIds,
    });
  }
  const used = flows.slice(-n);
  const total = used.reduce((acc, f) => acc.plus(D(f.netFlow)), D(0));
  const burn = total.neg().div(used.length).toFixed(4);
  const notes: string[] = [];
  if (used.length < n) notes.push(`Only ${used.length} of the requested ${n} months of history were available; average uses ${used.length} months.`);
  if (D(burn).lte(0)) notes.push("Net cash flow is non-negative over the period (cash-flow positive).");
  return makeCalc<DecimalString | null>({
    name,
    value: burn,
    unit: "USD",
    formula,
    inputs: { monthsRequested: n, monthsUsed: used.length, flows: used, sumNetFlow: total.toFixed(4) },
    asOfDate: input.asOfDate,
    sourceIds,
    notes,
  });
}

export interface RunwayInput {
  cash: NumericInput;
  /** Positive = burning cash per month (see burnRate). */
  burnRate: NumericInput;
  asOfDate: ISODate;
  sourceIds?: ID[];
}

/** Runway in months = cash / burn rate. Cash-flow positive → null with note. */
export function cashRunway(input: RunwayInput): CalcResult<number | null> {
  const name = "cash_runway";
  const formula = "runway_months = cash / monthly_burn_rate";
  const inputs = { cash: isUnknown(input.cash) ? null : dec(input.cash), burnRate: isUnknown(input.burnRate) ? null : dec(input.burnRate) };
  const missing: string[] = [];
  if (isUnknown(input.cash)) missing.push("cash balance");
  if (isUnknown(input.burnRate)) missing.push("burn rate");
  if (missing.length) return insufficient({ name, unit: "MONTHS", formula, inputs, asOfDate: input.asOfDate, missing, sourceIds: input.sourceIds });
  if (D(input.burnRate).lte(0)) {
    return makeCalc<number | null>({
      name,
      value: null,
      unit: "MONTHS",
      formula,
      inputs,
      asOfDate: input.asOfDate,
      sourceIds: input.sourceIds,
      notes: ["cash-flow positive: burn rate is zero or negative, runway is unbounded."],
    });
  }
  const months = round(D(input.cash).div(D(input.burnRate)).toNumber(), 4);
  return makeCalc<number | null>({ name, value: months, unit: "MONTHS", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds });
}

export interface ReserveCoverageInput {
  cash: NumericInput;
  /** Minimum cash reserve policy amount; null when the policy is unknown/unconfirmed. */
  minimumReserve: DecimalString | number | null;
  asOfDate: ISODate;
  sourceIds?: ID[];
  policyStatus?: "CONFIRMED" | "UNCONFIRMED";
}

export interface ReserveCoverage {
  cash: DecimalString;
  minimumReserve: DecimalString;
  /** cash - minimumReserve (negative = shortfall) */
  surplus: DecimalString;
  /** cash / minimumReserve (null when the reserve is zero) */
  coverageRatio: number | null;
  meetsPolicy: boolean;
}

/** Cash versus the minimum reserve policy. Unknown policy → INSUFFICIENT_INFORMATION. */
export function cashReserveCoverage(input: ReserveCoverageInput): CalcResult<ReserveCoverage | null> {
  const name = "cash_reserve_coverage";
  const formula = "surplus = cash - minimum_reserve; coverage_ratio = cash / minimum_reserve";
  const inputs = { cash: isUnknown(input.cash) ? null : dec(input.cash), minimumReserve: input.minimumReserve === null ? null : dec(input.minimumReserve) };
  const missing: string[] = [];
  if (isUnknown(input.cash)) missing.push("cash balance");
  if (input.minimumReserve === null) missing.push("minimum cash reserve policy (MaterialityThresholds.minimumCashReserve)");
  if (missing.length) return insufficient({ name, unit: "OBJECT", formula, inputs, asOfDate: input.asOfDate, missing, sourceIds: input.sourceIds });
  const cash = dec(input.cash as DecimalString | number);
  const reserve = dec(input.minimumReserve as DecimalString | number);
  const surplus = sub(cash, reserve);
  const value: ReserveCoverage = {
    cash,
    minimumReserve: reserve,
    surplus,
    coverageRatio: isZero(reserve) ? null : round(safeRatio(cash, reserve) ?? 0),
    meetsPolicy: D(surplus).gte(0),
  };
  const assumptions =
    input.policyStatus === "UNCONFIRMED"
      ? [{ key: "minimum_cash_reserve", description: "Minimum cash reserve policy is not yet confirmed by the owner.", value: reserve, status: "UNCONFIRMED" as const }]
      : [];
  return makeCalc<ReserveCoverage | null>({ name, value, unit: "OBJECT", formula, inputs, asOfDate: input.asOfDate, sourceIds: input.sourceIds, assumptions });
}

export interface LiquidityNumbers {
  currentAssets?: NumericInput;
  currentLiabilities?: NumericInput;
  cash?: NumericInput;
  accountsReceivable?: NumericInput;
  asOfDate?: ISODate;
  sourceIds?: ID[];
}
export type LiquidityInput = BalanceSheet | LiquidityNumbers;

function isBalanceSheet(x: LiquidityInput): x is BalanceSheet {
  return (x as BalanceSheet).kind === "BALANCE_SHEET";
}

function resolveLiquidity(input: LiquidityInput): Required<Pick<LiquidityNumbers, "asOfDate" | "sourceIds">> & LiquidityNumbers {
  if (isBalanceSheet(input)) {
    const arLine = input.lines.find((l) => l.code === ACCT.AR || l.accountId === accountIdForCode(ACCT.AR) || /receivable/i.test(l.label));
    return {
      currentAssets: input.currentAssets,
      currentLiabilities: input.currentLiabilities,
      cash: input.cash,
      accountsReceivable: arLine ? arLine.amount : null,
      asOfDate: input.asOfDate,
      sourceIds: [],
    };
  }
  return { ...input, asOfDate: input.asOfDate ?? "1970-01-01", sourceIds: input.sourceIds ?? [] };
}

/** Working capital = current assets - current liabilities. */
export function workingCapital(input: LiquidityInput): CalcResult<DecimalString | null> {
  const n = resolveLiquidity(input);
  const name = "working_capital";
  const formula = "working_capital = current_assets - current_liabilities";
  const inputs = { currentAssets: isUnknown(n.currentAssets) ? null : dec(n.currentAssets), currentLiabilities: isUnknown(n.currentLiabilities) ? null : dec(n.currentLiabilities) };
  const missing: string[] = [];
  if (isUnknown(n.currentAssets)) missing.push("current assets");
  if (isUnknown(n.currentLiabilities)) missing.push("current liabilities");
  if (missing.length) return insufficient({ name, unit: "USD", formula, inputs, asOfDate: n.asOfDate, missing, sourceIds: n.sourceIds });
  return makeCalc<DecimalString | null>({ name, value: sub(n.currentAssets as DecimalString, n.currentLiabilities as DecimalString), unit: "USD", formula, inputs, asOfDate: n.asOfDate, sourceIds: n.sourceIds });
}

/** Current ratio = current assets / current liabilities. */
export function currentRatio(input: LiquidityInput): CalcResult<number | null> {
  const n = resolveLiquidity(input);
  const name = "current_ratio";
  const formula = "current_ratio = current_assets / current_liabilities";
  const inputs = { currentAssets: isUnknown(n.currentAssets) ? null : dec(n.currentAssets), currentLiabilities: isUnknown(n.currentLiabilities) ? null : dec(n.currentLiabilities) };
  const missing: string[] = [];
  if (isUnknown(n.currentAssets)) missing.push("current assets");
  if (isUnknown(n.currentLiabilities)) missing.push("current liabilities");
  if (missing.length) return insufficient({ name, unit: "RATIO", formula, inputs, asOfDate: n.asOfDate, missing, sourceIds: n.sourceIds });
  if (isZero(n.currentLiabilities as DecimalString)) {
    return makeCalc<number | null>({ name, value: null, unit: "RATIO", formula, inputs, asOfDate: n.asOfDate, sourceIds: n.sourceIds, notes: ["Current liabilities are zero; ratio is undefined."] });
  }
  return makeCalc<number | null>({ name, value: round(safeRatio(n.currentAssets as DecimalString, n.currentLiabilities as DecimalString) ?? 0), unit: "RATIO", formula, inputs, asOfDate: n.asOfDate, sourceIds: n.sourceIds });
}

/** Quick ratio = (cash + accounts receivable) / current liabilities. */
export function quickRatio(input: LiquidityInput): CalcResult<number | null> {
  const n = resolveLiquidity(input);
  const name = "quick_ratio";
  const formula = "quick_ratio = (cash + accounts_receivable) / current_liabilities";
  const inputs = {
    cash: isUnknown(n.cash) ? null : dec(n.cash),
    accountsReceivable: isUnknown(n.accountsReceivable) ? null : dec(n.accountsReceivable),
    currentLiabilities: isUnknown(n.currentLiabilities) ? null : dec(n.currentLiabilities),
  };
  const missing: string[] = [];
  if (isUnknown(n.cash)) missing.push("cash");
  if (isUnknown(n.accountsReceivable)) missing.push("accounts receivable");
  if (isUnknown(n.currentLiabilities)) missing.push("current liabilities");
  if (missing.length) return insufficient({ name, unit: "RATIO", formula, inputs, asOfDate: n.asOfDate, missing, sourceIds: n.sourceIds });
  if (isZero(n.currentLiabilities as DecimalString)) {
    return makeCalc<number | null>({ name, value: null, unit: "RATIO", formula, inputs, asOfDate: n.asOfDate, sourceIds: n.sourceIds, notes: ["Current liabilities are zero; ratio is undefined."] });
  }
  const quick = add(n.cash as DecimalString, n.accountsReceivable as DecimalString);
  return makeCalc<number | null>({ name, value: round(safeRatio(quick, n.currentLiabilities as DecimalString) ?? 0), unit: "RATIO", formula, inputs: { ...inputs, quickAssets: quick }, asOfDate: n.asOfDate, sourceIds: n.sourceIds });
}
