/**
 * Ratio pack: gross margin, opex ratio, revenue per employee, DSO, DPO, cash conversion cycle.
 * Every ratio is its own CalcResult; the pack returns all of them together with a summary calc.
 */
import type { CalcResult, DecimalString, ID, ISODate } from "@/lib/core/types";
import { D } from "@/lib/core/money";
import { dec, insufficient, isUnknown, makeCalc, round, type NumericInput } from "./calc-result";
import { grossMargin } from "./margins";

export interface RatioPackInput {
  asOfDate: ISODate;
  /** Length of the period the P&L figures cover, in days (e.g. 365 for a year, 90 for a quarter). */
  periodDays: number;
  revenue: NumericInput;
  costOfRevenue: NumericInput;
  operatingExpenses: NumericInput;
  /** Full-time-equivalent headcount (null = unknown). */
  headcount: number | null | undefined;
  accountsReceivable: NumericInput;
  accountsPayable: NumericInput;
  /** Purchases on credit for the period (defaults to cost of revenue + operating expenses when omitted). */
  creditPurchases?: NumericInput;
  /** Inventory days; service businesses have none → 0 with a note. */
  daysInventoryOutstanding?: number | null;
  sourceIds?: ID[];
}

export interface RatioPack {
  asOfDate: ISODate;
  ratios: CalcResult[];
  summary: CalcResult<Record<string, number | DecimalString | null>>;
}

function simpleRatio(name: string, formula: string, unit: "RATIO" | "DAYS", num: NumericInput, den: NumericInput, labels: [string, string], meta: { asOfDate: ISODate; sourceIds?: ID[] }, scale?: number, extraInputs: Record<string, unknown> = {}): CalcResult<number | null> {
  const inputs = { [labels[0]]: isUnknown(num) ? null : dec(num), [labels[1]]: isUnknown(den) ? null : dec(den), ...(scale !== undefined ? { periodDays: scale } : {}), ...extraInputs };
  const missing: string[] = [];
  if (isUnknown(num)) missing.push(labels[0]);
  if (isUnknown(den)) missing.push(labels[1]);
  if (missing.length) return insufficient({ name, unit, formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  if (D(den as string).isZero()) return makeCalc<number | null>({ name, value: null, unit, formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: [`${labels[1]} is zero; ratio undefined.`] });
  const raw = D(num as string).div(D(den as string)).times(scale ?? 1);
  return makeCalc<number | null>({ name, value: round(raw.toNumber(), 4), unit, formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

/** Operating expense ratio = opex / revenue. */
export function opexRatio(revenue: NumericInput, operatingExpenses: NumericInput, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<number | null> {
  return simpleRatio("opex_ratio", "opex_ratio = operating_expenses / revenue", "RATIO", operatingExpenses, revenue, ["operatingExpenses", "revenue"], meta);
}

/** Revenue per employee = revenue / headcount (money → DecimalString). */
export function revenuePerEmployee(revenue: NumericInput, headcount: number | null | undefined, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<DecimalString | null> {
  const name = "revenue_per_employee";
  const formula = "revenue_per_employee = revenue / headcount";
  const inputs = { revenue: isUnknown(revenue) ? null : dec(revenue), headcount: headcount ?? null };
  const missing: string[] = [];
  if (isUnknown(revenue)) missing.push("revenue");
  if (headcount === null || headcount === undefined) missing.push("headcount");
  if (missing.length) return insufficient({ name, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  if ((headcount as number) <= 0) return makeCalc<DecimalString | null>({ name, value: null, unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes: ["Headcount is zero; ratio undefined."] });
  return makeCalc<DecimalString | null>({ name, value: D(revenue as DecimalString).div(headcount as number).toFixed(4), unit: "USD", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds });
}

/** DSO = accounts receivable / revenue × period days. */
export function daysSalesOutstanding(accountsReceivable: NumericInput, revenue: NumericInput, periodDays: number, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<number | null> {
  return simpleRatio("days_sales_outstanding", "dso = accounts_receivable / revenue * period_days", "DAYS", accountsReceivable, revenue, ["accountsReceivable", "revenue"], meta, periodDays);
}

/** DPO = accounts payable / credit purchases × period days. */
export function daysPayableOutstanding(accountsPayable: NumericInput, creditPurchases: NumericInput, periodDays: number, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<number | null> {
  return simpleRatio("days_payable_outstanding", "dpo = accounts_payable / credit_purchases * period_days", "DAYS", accountsPayable, creditPurchases, ["accountsPayable", "creditPurchases"], meta, periodDays);
}

/** Cash conversion cycle = DSO + DIO - DPO (DIO = 0 for a service business). */
export function cashConversionCycle(dso: number | null, dpo: number | null, dio: number | null | undefined, meta: { asOfDate: ISODate; sourceIds?: ID[] }): CalcResult<number | null> {
  const name = "cash_conversion_cycle";
  const formula = "ccc = dso + dio - dpo";
  const inputs = { dso, dpo, dio: dio ?? 0 };
  const missing: string[] = [];
  if (dso === null) missing.push("days sales outstanding");
  if (dpo === null) missing.push("days payable outstanding");
  if (missing.length) return insufficient({ name, unit: "DAYS", formula, inputs, asOfDate: meta.asOfDate, missing, sourceIds: meta.sourceIds });
  const notes = dio === undefined || dio === null ? ["Days inventory outstanding not supplied; treated as 0 (service business, no inventory)."] : [];
  return makeCalc<number | null>({ name, value: round((dso as number) + (dio ?? 0) - (dpo as number), 4), unit: "DAYS", formula, inputs, asOfDate: meta.asOfDate, sourceIds: meta.sourceIds, notes });
}

/** Compute the full ratio pack from explicit inputs (statement numbers are passed in by the caller). */
export function ratioPack(input: RatioPackInput): RatioPack {
  const meta = { asOfDate: input.asOfDate, sourceIds: input.sourceIds };
  const gm = grossMargin({ revenue: input.revenue, costOfRevenue: input.costOfRevenue }, meta);
  const opex = opexRatio(input.revenue, input.operatingExpenses, meta);
  const rpe = revenuePerEmployee(input.revenue, input.headcount, meta);
  const dso = daysSalesOutstanding(input.accountsReceivable, input.revenue, input.periodDays, meta);
  const purchases = input.creditPurchases !== undefined ? input.creditPurchases : isUnknown(input.costOfRevenue) || isUnknown(input.operatingExpenses) ? null : D(input.costOfRevenue).plus(D(input.operatingExpenses)).toFixed(4);
  const dpo = daysPayableOutstanding(input.accountsPayable, purchases, input.periodDays, meta);
  const ccc = cashConversionCycle(dso.value, dpo.value, input.daysInventoryOutstanding, meta);
  const ratios: CalcResult[] = [gm, opex, rpe, dso, dpo, ccc];
  const summaryValue: Record<string, number | DecimalString | null> = Object.fromEntries(ratios.map((r) => [r.name, r.value as number | DecimalString | null]));
  const summary = makeCalc<Record<string, number | DecimalString | null>>({
    name: "ratio_pack",
    value: summaryValue,
    unit: "OBJECT",
    formula: ratios.map((r) => r.formula).join("; "),
    inputs: { periodDays: input.periodDays, revenue: isUnknown(input.revenue) ? null : dec(input.revenue), costOfRevenue: isUnknown(input.costOfRevenue) ? null : dec(input.costOfRevenue), operatingExpenses: isUnknown(input.operatingExpenses) ? null : dec(input.operatingExpenses), headcount: input.headcount ?? null, accountsReceivable: isUnknown(input.accountsReceivable) ? null : dec(input.accountsReceivable), accountsPayable: isUnknown(input.accountsPayable) ? null : dec(input.accountsPayable), creditPurchases: isUnknown(purchases) ? null : dec(purchases) },
    sourceIds: [...(input.sourceIds ?? []), ...ratios.map((r) => r.id)],
    asOfDate: input.asOfDate,
    assumptions: ratios.flatMap((r) => r.assumptions),
    notes: ratios.flatMap((r) => (r.notes ?? []).map((n) => `${r.name}: ${n}`)),
  });
  return { asOfDate: input.asOfDate, ratios, summary };
}
