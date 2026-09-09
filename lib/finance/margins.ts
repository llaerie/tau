/**
 * Margin calculations. Accept either an IncomeStatement (from the ledger) or explicit numbers.
 * Margins are ratios (JS numbers, e.g. 0.42 = 42%); the money inputs are DecimalStrings.
 */
import type { CalcResult, DecimalString, ID, ISODate } from "@/lib/core/types";
import type { IncomeStatement } from "@/lib/core/contracts";
import { D, isZero } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, safeRatio, type NumericInput } from "./calc-result";

export interface MarginNumbers {
  revenue: NumericInput;
  costOfRevenue?: NumericInput;
  operatingIncome?: NumericInput;
  netIncome?: NumericInput;
}

export interface MarginOptions {
  asOfDate?: ISODate;
  sourceIds?: ID[];
}

export type MarginInput = IncomeStatement | MarginNumbers;

function isStatement(x: MarginInput): x is IncomeStatement {
  return (x as IncomeStatement).kind === "INCOME_STATEMENT";
}

function resolve(input: MarginInput, opts?: MarginOptions): { n: MarginNumbers; asOfDate: ISODate; sourceIds: ID[] } {
  if (isStatement(input)) {
    return {
      n: {
        revenue: input.revenue,
        costOfRevenue: input.costOfRevenue,
        operatingIncome: input.operatingIncome,
        netIncome: input.netIncome,
      },
      asOfDate: opts?.asOfDate ?? input.toDate,
      sourceIds: opts?.sourceIds ?? input.calcIds,
    };
  }
  return { n: input, asOfDate: opts?.asOfDate ?? "1970-01-01", sourceIds: opts?.sourceIds ?? [] };
}

function marginCalc(
  name: string,
  formula: string,
  numeratorLabel: string,
  numerator: NumericInput,
  revenue: NumericInput,
  asOfDate: ISODate,
  sourceIds: ID[],
  extraInputs: Record<string, unknown> = {},
): CalcResult<number | null> {
  const inputs = { [numeratorLabel]: isUnknown(numerator) ? null : dec(numerator), revenue: isUnknown(revenue) ? null : dec(revenue), ...extraInputs };
  const missing: string[] = [];
  if (isUnknown(revenue)) missing.push("revenue");
  if (isUnknown(numerator)) missing.push(numeratorLabel);
  if (missing.length) return insufficient({ name, unit: "RATIO", formula, inputs, asOfDate, missing, sourceIds });
  const rev = revenue as DecimalString | number;
  const num = numerator as DecimalString | number;
  if (isZero(rev)) {
    return makeCalc<number | null>({ name, value: null, unit: "RATIO", formula, inputs, asOfDate, sourceIds, notes: ["Revenue is zero; margin is undefined (division by zero)."] });
  }
  const value = round(safeRatio(num, rev) ?? 0);
  return makeCalc<number | null>({ name, value, unit: "RATIO", formula, inputs, asOfDate, sourceIds });
}

/** Gross margin = (revenue - cost of revenue) / revenue. */
export function grossMargin(input: MarginInput, opts?: MarginOptions): CalcResult<number | null> {
  const { n, asOfDate, sourceIds } = resolve(input, opts);
  const grossProfit = isUnknown(n.revenue) || isUnknown(n.costOfRevenue) ? null : D(n.revenue).minus(D(n.costOfRevenue)).toFixed(4);
  return marginCalc(
    "gross_margin",
    "gross_margin = (revenue - cost_of_revenue) / revenue",
    "grossProfit",
    grossProfit,
    n.revenue,
    asOfDate,
    sourceIds,
    { costOfRevenue: isUnknown(n.costOfRevenue) ? null : dec(n.costOfRevenue) },
  );
}

/** Operating margin = operating income / revenue. */
export function operatingMargin(input: MarginInput, opts?: MarginOptions): CalcResult<number | null> {
  const { n, asOfDate, sourceIds } = resolve(input, opts);
  return marginCalc("operating_margin", "operating_margin = operating_income / revenue", "operatingIncome", n.operatingIncome, n.revenue, asOfDate, sourceIds);
}

/** Net margin = net income / revenue. */
export function netMargin(input: MarginInput, opts?: MarginOptions): CalcResult<number | null> {
  const { n, asOfDate, sourceIds } = resolve(input, opts);
  return marginCalc("net_margin", "net_margin = net_income / revenue", "netIncome", n.netIncome, n.revenue, asOfDate, sourceIds);
}
