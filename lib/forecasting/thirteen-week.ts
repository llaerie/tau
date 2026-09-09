/**
 * 13-week cash flow forecast.
 *
 * Weeks start on Monday (week 0 contains asOfDate). Flows dated before asOfDate are still open
 * items (overdue) and are placed in week 0 flagged `overdue`; flows beyond the horizon are
 * reported as excluded. Every amount is a positive magnitude; direction comes from whether the
 * flow is in `receipts` or `disbursements`.
 */
import type { Assumption, CalcResult, CompanyDataset, DecimalString, ID, ISODate } from "@/lib/core/types";
import { addDays, addMonths, daysBetween, monthEnd, weekStart } from "@/lib/core/dates";
import { D, add, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { DRIVER_KEYS, type FlowCategory, detectPayrollCadence, detectRecurringVendors, driverDecimal, projectPayDates } from "./drivers";

export type FlowConfidence = "CONFIRMED" | "EXPECTED" | "ASSUMED";

export interface ScheduledFlow {
  id: ID;
  label: string;
  date: ISODate;
  /** Positive magnitude */
  amount: DecimalString;
  category: FlowCategory;
  confidence: FlowConfidence;
  sourceIds: ID[];
}

export interface ThirteenWeekInput {
  asOfDate: ISODate;
  openingCash: DecimalString;
  weeks?: number;
  receipts: ScheduledFlow[];
  disbursements: ScheduledFlow[];
  minimumCash: DecimalString | null;
  assumptions: Assumption[];
  sourceIds?: ID[];
}

export interface WeekRow {
  weekIndex: number;
  weekStart: ISODate;
  weekEnd: ISODate;
  openingCash: DecimalString;
  receipts: DecimalString;
  receiptsByConfidence: Record<FlowConfidence, DecimalString>;
  disbursements: DecimalString;
  disbursementsByCategory: Partial<Record<FlowCategory, DecimalString>>;
  net: DecimalString;
  closingCash: DecimalString;
  belowMinimum: boolean | null;
  receiptIds: ID[];
  disbursementIds: ID[];
  overdueFlowIds: ID[];
}

export interface ThirteenWeekForecast {
  asOfDate: ISODate;
  weeks: number;
  openingCash: DecimalString;
  minimumCash: DecimalString | null;
  rows: WeekRow[];
  totalReceipts: DecimalString;
  totalDisbursements: DecimalString;
  endingCash: DecimalString;
  lowestCash: DecimalString;
  lowestCashWeek: number;
  lowestCashWeekStart: ISODate;
  weeksBelowMinimum: number | null;
  firstWeekBelowMinimum: number | null;
  excludedFlows: ScheduledFlow[];
  assumptions: Assumption[];
  calc: CalcResult<Omit<ThirteenWeekForecast, "calc" | "rows" | "excludedFlows" | "assumptions"> & { rows: Pick<WeekRow, "weekIndex" | "weekStart" | "receipts" | "disbursements" | "net" | "closingCash">[] }>;
}

/** Build the weekly cash forecast. */
export function buildThirteenWeekForecast(input: ThirteenWeekInput): ThirteenWeekForecast {
  const weeks = input.weeks ?? 13;
  const start = weekStart(input.asOfDate);
  const rows: WeekRow[] = [];
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(start, i * 7);
    rows.push({ weekIndex: i, weekStart: ws, weekEnd: addDays(ws, 6), openingCash: "0.0000", receipts: "0.0000", receiptsByConfidence: { CONFIRMED: "0.0000", EXPECTED: "0.0000", ASSUMED: "0.0000" }, disbursements: "0.0000", disbursementsByCategory: {}, net: "0.0000", closingCash: "0.0000", belowMinimum: input.minimumCash === null ? null : false, receiptIds: [], disbursementIds: [], overdueFlowIds: [] });
  }
  const excluded: ScheduledFlow[] = [];
  const place = (f: ScheduledFlow): WeekRow | null => {
    const idx = Math.floor(daysBetween(start, f.date) / 7);
    if (idx >= weeks) {
      excluded.push(f);
      return null;
    }
    const row = rows[Math.max(0, idx)];
    if (f.date < input.asOfDate) row.overdueFlowIds.push(f.id);
    return row;
  };
  for (const f of sortFlows(input.receipts)) {
    const row = place(f);
    if (!row) continue;
    row.receipts = add(row.receipts, f.amount);
    row.receiptsByConfidence[f.confidence] = add(row.receiptsByConfidence[f.confidence], f.amount);
    row.receiptIds.push(f.id);
  }
  for (const f of sortFlows(input.disbursements)) {
    const row = place(f);
    if (!row) continue;
    row.disbursements = add(row.disbursements, f.amount);
    row.disbursementsByCategory[f.category] = add(row.disbursementsByCategory[f.category] ?? 0, f.amount);
    row.disbursementIds.push(f.id);
  }
  let cash = D(input.openingCash).toFixed(4);
  let lowest = cash;
  let lowestWeek = 0;
  let below = 0;
  let firstBelow: number | null = null;
  const min = input.minimumCash === null ? null : D(input.minimumCash);
  for (const row of rows) {
    row.openingCash = cash;
    row.net = sub(row.receipts, row.disbursements);
    cash = add(cash, row.net);
    row.closingCash = cash;
    if (row.weekIndex === 0 || D(cash).lt(D(lowest))) {
      lowest = cash;
      lowestWeek = row.weekIndex;
    }
    if (min !== null) {
      row.belowMinimum = D(cash).lt(min);
      if (row.belowMinimum) {
        below++;
        if (firstBelow === null) firstBelow = row.weekIndex;
      }
    }
  }
  const totalReceipts = rows.reduce((a, r) => add(a, r.receipts), "0.0000");
  const totalDisbursements = rows.reduce((a, r) => add(a, r.disbursements), "0.0000");
  const assumptions: Assumption[] = [...input.assumptions];
  if (input.minimumCash === null) assumptions.push({ key: "minimum_cash_reserve", description: "Minimum cash reserve policy unknown; weeks-below-minimum cannot be evaluated.", value: null, status: "UNCONFIRMED" });
  const assumedReceipts = rows.reduce((a, r) => add(a, r.receiptsByConfidence.ASSUMED), "0.0000");
  if (D(assumedReceipts).gt(0)) assumptions.push({ key: "assumed_receipts", description: `Receipts totalling ${assumedReceipts} are ASSUMED (not backed by an open invoice).`, value: assumedReceipts, status: "UNCONFIRMED" });
  const overdueIds = rows.flatMap((r) => r.overdueFlowIds);
  const notes: string[] = [];
  if (overdueIds.length) notes.push(`${overdueIds.length} overdue flow(s) dated before ${input.asOfDate} placed in week 0.`);
  if (excluded.length) notes.push(`${excluded.length} flow(s) fall after the ${weeks}-week horizon and are excluded.`);
  if (input.minimumCash === null) notes.push("INSUFFICIENT_INFORMATION: minimum cash reserve policy unknown; weeksBelowMinimum is null.");
  else if (below) notes.push(`${below} week(s) below the minimum cash of ${D(input.minimumCash).toFixed(4)} (first: week ${firstBelow}).`);
  if (D(lowest).lt(0)) notes.push(`Projected cash goes negative in week ${lowestWeek} (${rows[lowestWeek].weekStart}).`);

  const calcValue = {
    asOfDate: input.asOfDate,
    weeks,
    openingCash: D(input.openingCash).toFixed(4),
    minimumCash: input.minimumCash === null ? null : D(input.minimumCash).toFixed(4),
    totalReceipts,
    totalDisbursements,
    endingCash: cash,
    lowestCash: lowest,
    lowestCashWeek: lowestWeek,
    lowestCashWeekStart: rows[lowestWeek].weekStart,
    weeksBelowMinimum: min === null ? null : below,
    firstWeekBelowMinimum: firstBelow,
    rows: rows.map((r) => ({ weekIndex: r.weekIndex, weekStart: r.weekStart, receipts: r.receipts, disbursements: r.disbursements, net: r.net, closingCash: r.closingCash })),
  };
  const calc = makeCalc<typeof calcValue>({
    name: "thirteen_week_cash_forecast",
    value: calcValue,
    unit: "TABLE",
    formula: "closing_w = opening_w + receipts_w - disbursements_w; opening_0 = openingCash; weeks start Monday; lowest cash = min closing_w; below minimum when closing_w < minimumCash",
    inputs: {
      asOfDate: input.asOfDate,
      openingCash: D(input.openingCash).toFixed(4),
      minimumCash: calcValue.minimumCash,
      weeks,
      receipts: input.receipts.map((f) => ({ id: f.id, date: f.date, amount: f.amount, confidence: f.confidence })),
      disbursements: input.disbursements.map((f) => ({ id: f.id, date: f.date, amount: f.amount, category: f.category, confidence: f.confidence })),
    },
    sourceIds: [...(input.sourceIds ?? []), ...input.receipts.flatMap((f) => f.sourceIds), ...input.disbursements.flatMap((f) => f.sourceIds)],
    assumptions,
    asOfDate: input.asOfDate,
    notes,
  });
  return { ...calcValue, rows, excludedFlows: excluded, assumptions, calc };
}

/** Calendar months (YYYY-MM) touched by [asOf, horizonEnd]. */
function monthsInHorizon(asOf: ISODate, horizonEnd: ISODate): string[] {
  const out: string[] = [];
  let cursor: ISODate = `${asOf.slice(0, 7)}-01`;
  while (cursor <= horizonEnd) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** Day-of-month within a month, clamped to the month's last day. */
function dayInMonth(month: string, day: number): ISODate {
  const last = Number(monthEnd(`${month}-01`).slice(8, 10));
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function sortFlows(flows: ScheduledFlow[]): ScheduledFlow[] {
  return [...flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

/** Scenario: selected (or all) receipts arrive `delayDays` later. */
export function delayedReceiptScenario(input: ThirteenWeekInput, delayDays: number, receiptIds: ID[] | "ALL" = "ALL"): ThirteenWeekForecast {
  const set = receiptIds === "ALL" ? null : new Set(receiptIds);
  const receipts = input.receipts.map((r) => (set === null || set.has(r.id) ? { ...r, date: addDays(r.date, delayDays) } : r));
  return buildThirteenWeekForecast({
    ...input,
    receipts,
    assumptions: [...input.assumptions, { key: "scenario:delayed_receipts", description: `Scenario: ${receiptIds === "ALL" ? "all" : receiptIds.length} receipt(s) delayed by ${delayDays} days.`, value: delayDays, status: "UNCONFIRMED" }],
  });
}

export interface StressTestOptions {
  /** Fraction of every receipt that does NOT arrive (0.2 = receipts cut by 20%). */
  receiptHaircut?: number;
  /** Additional one-off disbursement. */
  extraDisbursement?: { amount: DecimalString; date?: ISODate; label?: string; category?: FlowCategory };
}

/** Scenario: receipts reduced by a haircut and/or an extra disbursement added. */
export function stressTest(input: ThirteenWeekInput, opts: StressTestOptions): ThirteenWeekForecast {
  const haircut = opts.receiptHaircut ?? 0;
  const receipts = haircut ? input.receipts.map((r) => ({ ...r, amount: D(r.amount).times(D(1).minus(D(haircut))).toFixed(4), confidence: "ASSUMED" as FlowConfidence })) : input.receipts;
  const disbursements = [...input.disbursements];
  const assumptions: Assumption[] = [...input.assumptions];
  if (haircut) assumptions.push({ key: "scenario:receipt_haircut", description: `Stress: receipts reduced by ${haircut * 100}%.`, value: haircut, status: "UNCONFIRMED" });
  if (opts.extraDisbursement) {
    const e = opts.extraDisbursement;
    disbursements.push({ id: `stress_extra_${e.date ?? input.asOfDate}_${e.amount}`, label: e.label ?? "Stress: extra disbursement", date: e.date ?? input.asOfDate, amount: D(e.amount).toFixed(4), category: e.category ?? "OTHER", confidence: "ASSUMED", sourceIds: [] });
    assumptions.push({ key: "scenario:extra_disbursement", description: `Stress: extra disbursement of ${e.amount} on ${e.date ?? input.asOfDate}.`, value: e.amount, status: "UNCONFIRMED" });
  }
  return buildThirteenWeekForecast({ ...input, receipts, disbursements, assumptions });
}

// ---------------------------------------------------------------------------
// Deriving flows from a dataset
// ---------------------------------------------------------------------------

export interface FlowsFromDatasetOptions {
  weeks?: number;
  /** Override / supply recurring revenue: monthly amount received on `dayOfMonth`. */
  recurringRevenue?: { monthlyAmount: DecimalString; dayOfMonth?: number; sourceId?: ID } | null;
  /** Days after pay date when payroll taxes are deposited (ASSUMED; default 0 = same day). */
  payrollTaxDepositLagDays?: number;
}

export interface DerivedFlows {
  receipts: ScheduledFlow[];
  disbursements: ScheduledFlow[];
  assumptions: Assumption[];
  notes: string[];
}

/** Derive receipts and disbursements from open invoices, bills, payroll pattern, recurring vendors and tax obligations. */
export function flowsFromDataset(dataset: CompanyDataset, asOf: ISODate, opts: FlowsFromDatasetOptions = {}): DerivedFlows {
  const weeks = opts.weeks ?? 13;
  const horizonEnd = addDays(weekStart(asOf), weeks * 7 - 1);
  const receipts: ScheduledFlow[] = [];
  const disbursements: ScheduledFlow[] = [];
  const assumptions: Assumption[] = [];
  const notes: string[] = [];
  const customerName = new Map(dataset.customers.map((c) => [c.id, c.name]));
  const vendorName = new Map(dataset.vendors.map((v) => [v.id, v.name]));

  // Open invoices → receipts on due date (EXPECTED)
  for (const inv of dataset.invoices) {
    if (!["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status)) continue;
    const open = sub(inv.total, inv.amountPaid);
    if (D(open).lte(0)) continue;
    receipts.push({ id: `rcpt_inv_${inv.id}`, label: `Invoice ${inv.number} — ${customerName.get(inv.customerId) ?? inv.customerId}`, date: inv.dueDate, amount: open, category: "REVENUE", confidence: "EXPECTED", sourceIds: [inv.id] });
  }

  // Recurring revenue (ASSUMED) from option or the ACTIVE forecast's MRR driver, for months not yet invoiced
  const active = dataset.forecasts.find((f) => f.status === "ACTIVE");
  const rr = opts.recurringRevenue === undefined ? (active ? { monthlyAmount: driverDecimal(active.drivers, DRIVER_KEYS.MRR)?.toFixed(4) ?? null, dayOfMonth: undefined, sourceId: active.id } : null) : opts.recurringRevenue;
  if (rr && rr.monthlyAmount !== null) {
    const invoicedMonths = new Set(dataset.invoices.filter((i) => i.status !== "VOID").map((i) => i.issueDate.slice(0, 7)));
    const day = rr.dayOfMonth ?? 15;
    for (const month of monthsInHorizon(asOf, horizonEnd)) {
      const date = dayInMonth(month, day);
      if (!invoicedMonths.has(month) && date >= asOf && date <= horizonEnd) {
        receipts.push({ id: `rcpt_mrr_${month}`, label: `Recurring revenue (assumed) ${month}`, date, amount: D(rr.monthlyAmount).toFixed(4), category: "REVENUE", confidence: "ASSUMED", sourceIds: rr.sourceId ? [rr.sourceId] : [] });
      }
    }
    assumptions.push({ key: "recurring_revenue", description: `Recurring revenue of ${D(rr.monthlyAmount).toFixed(4)}/month assumed for months without issued invoices, received on day ${day}.`, value: rr.monthlyAmount, status: "UNCONFIRMED", sourceId: rr.sourceId });
  } else notes.push("No recurring revenue assumption available; only open invoices are projected as receipts.");

  // Open bills → AP on due date
  for (const bill of dataset.bills) {
    if (!["RECEIVED", "APPROVED", "SCHEDULED"].includes(bill.status)) continue;
    const open = sub(bill.total, bill.amountPaid);
    if (D(open).lte(0)) continue;
    disbursements.push({ id: `disb_bill_${bill.id}`, label: `Bill ${bill.number} — ${vendorName.get(bill.vendorId) ?? bill.vendorId}`, date: bill.dueDate, amount: open, category: "AP", confidence: bill.status === "SCHEDULED" ? "CONFIRMED" : "EXPECTED", sourceIds: [bill.id] });
  }

  // Payroll pattern → PAYROLL + PAYROLL_TAX
  const pattern = detectPayrollCadence(dataset.payrollRuns);
  const lastRun = [...dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? -1 : 1)).pop();
  if (lastRun && pattern.cadence !== "UNKNOWN") {
    const lag = opts.payrollTaxDepositLagDays ?? 0;
    const taxes = add(lastRun.totals.employeeTaxes, lastRun.totals.employerTaxes);
    for (const d of projectPayDates(pattern, asOf, horizonEnd)) {
      disbursements.push({ id: `disb_payroll_${d}`, label: `Payroll (${pattern.cadence.toLowerCase()}) net pay`, date: d, amount: D(lastRun.totals.netPay).toFixed(4), category: "PAYROLL", confidence: "ASSUMED", sourceIds: [lastRun.id] });
      disbursements.push({ id: `disb_payroll_tax_${d}`, label: "Payroll tax deposit (employee withholding + employer)", date: addDays(d, lag), amount: taxes, category: "PAYROLL_TAX", confidence: "ASSUMED", sourceIds: [lastRun.id] });
    }
    assumptions.push({ key: "payroll_pattern", description: `Payroll projected from last run ${lastRun.id} (${pattern.cadence}); tax deposits assumed ${lag} day(s) after pay date — deposit schedule must be confirmed against the tax rule.`, value: { cadence: pattern.cadence, netPay: lastRun.totals.netPay, taxes }, status: "UNCONFIRMED", sourceId: lastRun.id, requiresProfessionalReview: true });
  } else notes.push("Payroll cadence unknown (fewer than two non-draft payroll runs); no payroll disbursements projected.");
  // Accrued payroll liabilities with a due date
  for (const l of dataset.payrollLiabilities) {
    if (l.status !== "ACCRUED" || l.dueDate === null) continue;
    if (l.dueDate > horizonEnd) continue;
    disbursements.push({ id: `disb_pliab_${l.id}`, label: `Payroll liability ${l.kind}`, date: l.dueDate, amount: D(l.amount).toFixed(4), category: "PAYROLL_TAX", confidence: "EXPECTED", sourceIds: [l.id] });
  }
  const unknownDue = dataset.payrollLiabilities.filter((l) => l.status === "ACCRUED" && l.dueDate === null);
  if (unknownDue.length) assumptions.push({ key: "payroll_liabilities_unknown_due", description: `${unknownDue.length} accrued payroll liabilit(ies) have no due date and are not scheduled.`, value: unknownDue.map((l) => l.id), status: "UNCONFIRMED", requiresProfessionalReview: true });

  // Recurring vendor charges
  for (const rv of detectRecurringVendors(dataset, asOf)) {
    for (const month of monthsInHorizon(asOf, horizonEnd)) {
      const date = dayInMonth(month, rv.dayOfMonth);
      if (date > asOf && date <= horizonEnd && date > rv.lastDate) {
        disbursements.push({ id: `disb_recur_${rv.merchant.replace(/[^a-z0-9]+/g, "_")}_${month}`, label: `Recurring: ${rv.merchant}`, date, amount: rv.monthlyAmount, category: rv.category === "OTHER" || rv.category === "AP" ? "OTHER" : rv.category, confidence: "ASSUMED", sourceIds: rv.transactionIds.slice(-3) });
      }
    }
  }

  // Tax obligations
  for (const t of dataset.taxObligations) {
    if (!["UPCOMING", "DUE"].includes(t.status)) continue;
    if (t.dueDate === null) {
      assumptions.push({ key: `tax_obligation:${t.id}`, description: `${t.title}: due date unknown; not scheduled.`, value: null, status: "UNCONFIRMED", requiresProfessionalReview: true });
      continue;
    }
    if (t.amount === null) {
      assumptions.push({ key: `tax_obligation:${t.id}`, description: `${t.title} due ${t.dueDate}: amount unknown; not included in disbursements (never assumed zero).`, value: null, status: "UNCONFIRMED", requiresProfessionalReview: t.requiresCpaReview });
      continue;
    }
    if (t.dueDate > horizonEnd) continue;
    disbursements.push({ id: `disb_tax_${t.id}`, label: `${t.title} (${t.jurisdiction})`, date: t.dueDate, amount: D(t.amount).toFixed(4), category: "TAX", confidence: "EXPECTED", sourceIds: [t.id, ...(t.ruleSourceId ? [t.ruleSourceId] : [])] });
  }

  return { receipts: sortFlows(receipts), disbursements: sortFlows(disbursements), assumptions, notes };
}
