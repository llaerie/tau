/**
 * Driver assumptions: key conventions, helpers, and the default driver set derived from a dataset.
 *
 * Every driver is a `DriverAssumption` whose `status` says where it came from:
 *   CONFIRMED   — measured from ledger / invoice / payroll history (a fact about the past)
 *   UNCONFIRMED — ASSUMED (a projection choice, e.g. growth rate); note starts with "ASSUMED:"
 * A driver derived from history is still only a fact about the past; projecting it forward is
 * itself an assumption, which the budget/forecast builders record explicitly.
 *
 * Driver key conventions (values are DecimalString | number):
 *   revenue:mrr                       monthly recurring revenue (USD/month)
 *   revenue:growth_rate_monthly       month-over-month growth ratio (0.02 = 2%)
 *   payroll:monthly_gross_wages       employee gross wages (USD/month)
 *   payroll:monthly_contractor_fees   contractor fees (USD/month)
 *   payroll:employer_tax_rate         effective employer payroll tax ratio
 *   payroll:monthly_net_pay           net pay cash out (USD/month)
 *   payroll:monthly_total_taxes       employee withholdings + employer taxes deposited (USD/month)
 *   payroll:runs_per_month            payroll runs per month (2 = semi-monthly)
 *   expense:<accountId>:<slug>        recurring monthly expense line (USD/month)
 *   event:<month>:<accountId>:<slug>  one-off amount in a given month (USD)
 */
import type { Account, Assumption, CompanyDataset, DecimalString, DriverAssumption, FieldStatus, ID, ISODate, Invoice, PayrollRun, Transaction, Worker } from "@/lib/core/types";
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { addDays, addMonths, daysBetween, monthKey } from "@/lib/core/dates";
import { D, add } from "@/lib/core/money";

export const DRIVER_KEYS = {
  MRR: "revenue:mrr",
  REVENUE_GROWTH: "revenue:growth_rate_monthly",
  PAYROLL_GROSS: "payroll:monthly_gross_wages",
  PAYROLL_CONTRACTOR: "payroll:monthly_contractor_fees",
  PAYROLL_EMPLOYER_TAX_RATE: "payroll:employer_tax_rate",
  PAYROLL_NET_PAY: "payroll:monthly_net_pay",
  PAYROLL_TOTAL_TAXES: "payroll:monthly_total_taxes",
  PAYROLL_RUNS_PER_MONTH: "payroll:runs_per_month",
} as const;

export type DriverSet = Record<string, DriverAssumption>;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

export const expenseDriverKey = (accountId: ID, slug: string): string => `expense:${accountId}:${slugify(slug)}`;
export const eventDriverKey = (month: string, accountId: ID, slug: string): string => `event:${month}:${accountId}:${slugify(slug)}`;

export function parseExpenseDriverKey(key: string): { accountId: ID; slug: string } | null {
  const m = /^expense:([^:]+):(.+)$/.exec(key);
  return m ? { accountId: m[1], slug: m[2] } : null;
}
export function parseEventDriverKey(key: string): { month: string; accountId: ID; slug: string } | null {
  const m = /^event:(\d{4}-\d{2}):([^:]+):(.+)$/.exec(key);
  return m ? { month: m[1], accountId: m[2], slug: m[3] } : null;
}

export function makeDriver(key: string, label: string, value: DecimalString | number, unit: string, status: FieldStatus, extra: { sourceId?: ID; note?: string } = {}): DriverAssumption {
  return { key, label, value, unit, status, sourceId: extra.sourceId, note: extra.note };
}

/** ASSUMED driver: status UNCONFIRMED with an explicit "ASSUMED:" note. */
export function assumedDriver(key: string, label: string, value: DecimalString | number, unit: string, why: string, sourceId?: ID): DriverAssumption {
  return makeDriver(key, label, value, unit, "UNCONFIRMED", { sourceId, note: `ASSUMED: ${why}` });
}

export function driverDecimal(drivers: DriverSet, key: string) {
  const d = drivers[key];
  if (!d || d.value === null || d.value === undefined || d.value === "") return null;
  return D(d.value);
}

export function driverToAssumption(d: DriverAssumption): Assumption {
  return { key: d.key, description: `${d.label} (${d.unit})${d.note ? ` — ${d.note}` : ""}`, value: d.value, status: d.status, sourceId: d.sourceId, requiresProfessionalReview: d.status === "PROFESSIONAL_REVIEW_REQUIRED" };
}

export function driversToAssumptions(drivers: DriverSet): Assumption[] {
  return Object.values(drivers)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(driverToAssumption);
}

// ---------------------------------------------------------------------------
// Payroll cadence
// ---------------------------------------------------------------------------

export type PayrollCadence = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "UNKNOWN";

export interface PayrollPattern {
  cadence: PayrollCadence;
  runsPerMonth: number | null;
  lastPayDate: ISODate | null;
  /** Distinct pay days-of-month observed (semi-monthly / monthly) */
  payDaysOfMonth: number[];
  averageGapDays: number | null;
  runIds: ID[];
}

export function detectPayrollCadence(runs: PayrollRun[]): PayrollPattern {
  const usable = runs.filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? -1 : 1));
  if (!usable.length) return { cadence: "UNKNOWN", runsPerMonth: null, lastPayDate: null, payDaysOfMonth: [], averageGapDays: null, runIds: [] };
  const dates = Array.from(new Set(usable.map((r) => r.payDate)));
  const last = dates[dates.length - 1];
  const daysOfMonth = Array.from(new Set(dates.map((d) => Number(d.slice(8, 10))))).sort((a, b) => a - b);
  if (dates.length < 2) return { cadence: "UNKNOWN", runsPerMonth: null, lastPayDate: last, payDaysOfMonth: daysOfMonth, averageGapDays: null, runIds: usable.map((r) => r.id) };
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  let cadence: PayrollCadence = "UNKNOWN";
  if (avg >= 5 && avg <= 9) cadence = "WEEKLY";
  else if (avg >= 12 && avg <= 18) {
    // Semi-monthly pay dates cluster on ≤ 2 days-of-month (allowing ±1 for weekends / month ends);
    // biweekly pay dates drift across the month.
    const clusters = clusterDays(daysOfMonth);
    cadence = clusters <= 2 ? "SEMI_MONTHLY" : "BIWEEKLY";
  } else if (avg >= 26 && avg <= 35) cadence = "MONTHLY";
  const runsPerMonth = cadence === "WEEKLY" ? 52 / 12 : cadence === "BIWEEKLY" ? 26 / 12 : cadence === "SEMI_MONTHLY" ? 2 : cadence === "MONTHLY" ? 1 : null;
  return { cadence, runsPerMonth, lastPayDate: last, payDaysOfMonth: daysOfMonth, averageGapDays: Math.round(avg * 100) / 100, runIds: usable.map((r) => r.id) };
}

function clusterDays(days: number[]): number {
  // Treat 28..31 and 1..2 as one "month end" cluster; count groups separated by > 3 days.
  const norm = days.map((d) => (d >= 28 ? 31 : d <= 2 ? 31 : d)).sort((a, b) => a - b);
  let clusters = 0;
  let prev = -99;
  for (const d of norm) {
    if (d - prev > 3) clusters++;
    prev = d;
  }
  return clusters;
}

/** Project future pay dates after `after` up to and including `until` following the detected pattern. */
export function projectPayDates(pattern: PayrollPattern, after: ISODate, until: ISODate): ISODate[] {
  if (!pattern.lastPayDate || pattern.cadence === "UNKNOWN") return [];
  const out: ISODate[] = [];
  if (pattern.cadence === "WEEKLY" || pattern.cadence === "BIWEEKLY") {
    const step = pattern.cadence === "WEEKLY" ? 7 : 14;
    let d = pattern.lastPayDate;
    while (d <= until) {
      if (d > after) out.push(d);
      d = addDays(d, step);
    }
    return out;
  }
  // Semi-monthly / monthly: repeat the observed days-of-month each month.
  const days = pattern.cadence === "MONTHLY" ? [Number(pattern.lastPayDate.slice(8, 10))] : semiMonthlyDays(pattern.payDaysOfMonth);
  let cursor = `${monthKey(pattern.lastPayDate)}-01`;
  for (let i = 0; i < 36 && cursor <= until; i++) {
    for (const day of days) {
      const d = clampDay(cursor, day);
      if (d > after && d <= until) out.push(d);
    }
    cursor = addMonths(cursor, 1);
  }
  return out.sort();
}

function semiMonthlyDays(observed: number[]): number[] {
  const mid = observed.filter((d) => d >= 12 && d <= 18);
  const end = observed.filter((d) => d >= 28 || d <= 2);
  const a = mid.length ? Math.round(mid.reduce((x, y) => x + y, 0) / mid.length) : 15;
  const b = end.length ? 31 : observed.find((d) => d !== a) ?? 31;
  return [a, b];
}

function clampDay(monthStartDate: ISODate, day: number): ISODate {
  const last = Number(addDays(addMonths(monthStartDate, 1), -1).slice(8, 10));
  return `${monthStartDate.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Recurring vendor detection
// ---------------------------------------------------------------------------

export type FlowCategory = "REVENUE" | "PAYROLL" | "PAYROLL_TAX" | "AP" | "RENT" | "SOFTWARE" | "TAX" | "DISTRIBUTION" | "OTHER" | "TRANSFER";

export interface RecurringVendor {
  merchant: string;
  vendorId: ID | null;
  accountId: ID | null;
  category: FlowCategory;
  monthsSeen: number;
  /** Median of monthly totals (positive amount) */
  monthlyAmount: DecimalString;
  lastDate: ISODate;
  dayOfMonth: number;
  transactionIds: ID[];
}

export function flowCategoryForAccount(account: Account | undefined): FlowCategory {
  if (!account) return "OTHER";
  if (account.code === ACCT.RENT) return "RENT";
  if (account.code === ACCT.SOFTWARE || account.code === ACCT.HOSTING || account.code === ACCT.COGS_CLOUD || account.code === ACCT.COGS_AI_API) return "SOFTWARE";
  if (account.subtype === "PAYROLL_EXPENSE") return "PAYROLL";
  if (account.subtype === "PAYROLL_TAX_EXPENSE" || account.subtype === "PAYROLL_LIABILITY") return "PAYROLL_TAX";
  if (account.subtype === "TAX_EXPENSE" || account.subtype === "TAX_LIABILITY") return "TAX";
  if (account.subtype === "SHAREHOLDER_DISTRIBUTIONS") return "DISTRIBUTION";
  if (account.subtype === "ACCOUNTS_PAYABLE") return "AP";
  return "OTHER";
}

function median(vals: DecimalString[]): DecimalString {
  const sorted = vals.map(D).sort((a, b) => a.cmp(b));
  const n = sorted.length;
  if (!n) return "0.0000";
  return n % 2 ? sorted[(n - 1) / 2].toFixed(4) : sorted[n / 2 - 1].plus(sorted[n / 2]).div(2).toFixed(4);
}

export interface RecurringVendorOptions {
  minMonths?: number;
  lookbackMonths?: number;
  /** Merchant must have been seen within this many days of asOf to be considered active. */
  activeWithinDays?: number;
}

/** Vendors charged in >= minMonths distinct months (default 3) within the lookback, still active. */
export function detectRecurringVendors(dataset: CompanyDataset, asOf: ISODate, opts: RecurringVendorOptions = {}): RecurringVendor[] {
  const minMonths = opts.minMonths ?? 3;
  const lookback = opts.lookbackMonths ?? 12;
  const activeWithin = opts.activeWithinDays ?? 45;
  const from = addMonths(asOf, -lookback);
  const acctById = new Map(dataset.accounts.map((a) => [a.id, a]));
  const vendorsWithOpenBills = new Set(dataset.bills.filter((b) => ["RECEIVED", "APPROVED", "SCHEDULED"].includes(b.status) && D(b.total).minus(D(b.amountPaid)).gt(0)).map((b) => b.vendorId));
  const vendorByNorm = new Map<string, ID>();
  for (const v of dataset.vendors) for (const n of v.normalizedNames) vendorByNorm.set(n.toLowerCase(), v.id);

  const groups = new Map<string, Transaction[]>();
  for (const t of dataset.transactions) {
    if (t.date < from || t.date > asOf) continue;
    if (!D(t.amount).lt(0)) continue;
    if (t.flags.includes("TRANSFER") || t.transferPairId || t.duplicateOfId) continue;
    const acct = t.category.accountId ? acctById.get(t.category.accountId) : undefined;
    if (acct && (acct.type !== "EXPENSE" || acct.subtype === "PAYROLL_EXPENSE" || acct.subtype === "PAYROLL_TAX_EXPENSE" || acct.subtype === "SUSPENSE")) continue;
    if (t.counterpartyRef?.type === "VENDOR" && vendorsWithOpenBills.has(t.counterpartyRef.id)) continue;
    const merchant = (t.merchantNormalized ?? t.descriptionRaw).trim().toLowerCase();
    if (!merchant) continue;
    const arr = groups.get(merchant) ?? [];
    arr.push(t);
    groups.set(merchant, arr);
  }

  const out: RecurringVendor[] = [];
  for (const [merchant, txs] of groups) {
    const byMonth = new Map<string, DecimalString>();
    for (const t of txs) byMonth.set(monthKey(t.date), add(byMonth.get(monthKey(t.date)) ?? 0, D(t.amount).abs()));
    if (byMonth.size < minMonths) continue;
    const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = sorted[sorted.length - 1];
    if (daysBetween(last.date, asOf) > activeWithin) continue;
    const acctId = last.category.accountId ?? sorted.find((t) => t.category.accountId)?.category.accountId ?? null;
    const vendorId = last.counterpartyRef?.type === "VENDOR" ? last.counterpartyRef.id : vendorByNorm.get(merchant) ?? null;
    out.push({
      merchant,
      vendorId,
      accountId: acctId,
      category: flowCategoryForAccount(acctId ? acctById.get(acctId) : undefined),
      monthsSeen: byMonth.size,
      monthlyAmount: median(Array.from(byMonth.values())),
      lastDate: last.date,
      dayOfMonth: Number(last.date.slice(8, 10)),
      transactionIds: sorted.map((t) => t.id),
    });
  }
  return out.sort((a, b) => (a.merchant < b.merchant ? -1 : 1));
}

// ---------------------------------------------------------------------------
// MRR detection from invoices
// ---------------------------------------------------------------------------

export interface MrrDetection {
  mrr: DecimalString | null;
  monthsUsed: string[];
  byMonth: Record<string, DecimalString>;
  invoiceIds: ID[];
  lastInvoiceMonth: string | null;
}

/** MRR = median of invoiced totals over the last N complete months before asOf (default 3). */
export function detectMrr(invoices: Invoice[], asOf: ISODate, months = 3): MrrDetection {
  const usable = invoices.filter((i) => i.status !== "VOID" && i.status !== "DRAFT" && i.issueDate <= asOf);
  const byMonth: Record<string, DecimalString> = {};
  for (const i of usable) byMonth[monthKey(i.issueDate)] = add(byMonth[monthKey(i.issueDate)] ?? 0, i.total);
  const current = monthKey(asOf);
  const complete = Object.keys(byMonth)
    .filter((m) => m < current)
    .sort();
  const used = complete.slice(-months);
  const lastInvoiceMonth = Object.keys(byMonth).sort().pop() ?? null;
  if (!used.length) return { mrr: null, monthsUsed: [], byMonth, invoiceIds: [], lastInvoiceMonth };
  return {
    mrr: median(used.map((m) => byMonth[m])),
    monthsUsed: used,
    byMonth,
    invoiceIds: usable.filter((i) => used.includes(monthKey(i.issueDate))).map((i) => i.id),
    lastInvoiceMonth,
  };
}

// ---------------------------------------------------------------------------
// Payroll drivers from workers
// ---------------------------------------------------------------------------

export interface WorkerPayrollDrivers {
  monthlyGrossWages: DecimalString;
  monthlyContractorFees: DecimalString;
  includedWorkerIds: ID[];
  excludedWorkerIds: ID[];
  assumptions: Assumption[];
}

function isCompensationUsable(w: Worker): { usable: boolean; reason?: string } {
  const c = w.compensation as Worker["compensation"] | null | undefined;
  if (!c || c.amount === null || c.amount === undefined || String(c.amount).trim() === "") return { usable: false, reason: "compensation is unknown (null)" };
  if (c.status !== "CONFIRMED" && c.status !== "UNCONFIRMED") return { usable: false, reason: `compensation status is ${c.status}` };
  if (c.basis === "UNKNOWN" || c.basis === "NET") return { usable: false, reason: `compensation basis is ${c.basis}` };
  if (c.period === "HOURLY") return { usable: false, reason: "hourly compensation needs an hours assumption" };
  return { usable: true };
}

/** Monthly gross wages / contractor fees from workers' compensation (CONFIRMED or UNCONFIRMED values only). */
export function payrollDriversFromWorkers(workers: Worker[], asOf: ISODate): WorkerPayrollDrivers {
  let gross = "0.0000";
  let contractor = "0.0000";
  const included: ID[] = [];
  const excluded: ID[] = [];
  const assumptions: Assumption[] = [];
  for (const w of workers) {
    if (w.endDate && w.endDate < asOf) continue;
    if (w.startDate > asOf) continue;
    const { usable, reason } = isCompensationUsable(w);
    if (!usable) {
      excluded.push(w.id);
      assumptions.push({ key: `worker:${w.id}:compensation`, description: `${w.displayName}: ${reason}; contributes nothing to the payroll driver until confirmed.`, value: null, status: "UNCONFIRMED", requiresProfessionalReview: w.classificationStatus !== "CONFIRMED" });
      continue;
    }
    const c = w.compensation;
    const monthly = c.period === "ANNUAL" ? D(c.amount).div(12) : D(c.amount);
    const isContractor = w.workerType === "CONTRACTOR" || c.type === "CONTRACT" || c.basis === "CONTRACT_FEE";
    if (isContractor) contractor = add(contractor, monthly);
    else gross = add(gross, monthly);
    included.push(w.id);
    if (c.status === "UNCONFIRMED") assumptions.push({ key: `worker:${w.id}:compensation`, description: `${w.displayName}: compensation ${c.amount} ${c.period} is UNCONFIRMED.`, value: c.amount, status: "UNCONFIRMED" });
    if (w.workerType === "UNRESOLVED") assumptions.push({ key: `worker:${w.id}:classification`, description: `${w.displayName}: worker classification unresolved; treated as ${isContractor ? "contractor" : "employee"} for budgeting only.`, value: w.workerType, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true });
  }
  return { monthlyGrossWages: gross, monthlyContractorFees: contractor, includedWorkerIds: included, excludedWorkerIds: excluded, assumptions };
}

// ---------------------------------------------------------------------------
// Default driver set
// ---------------------------------------------------------------------------

export interface DefaultDriverOptions {
  /** ASSUMED monthly growth rate (default 0). */
  growthRate?: number;
  recurring?: RecurringVendorOptions;
  /** Effective employer tax rate to use when there is no payroll history (ratio). */
  fallbackEmployerTaxRate?: { value: number; sourceId?: ID; status: FieldStatus } | null;
}

export interface DefaultDriverResult {
  drivers: DriverSet;
  assumptions: Assumption[];
  notes: string[];
  recurringVendors: RecurringVendor[];
  payrollPattern: PayrollPattern;
  mrr: MrrDetection;
}

/** Build the default driver set from a dataset, marking each driver CONFIRMED (history) or ASSUMED. */
export function buildDefaultDrivers(dataset: CompanyDataset, asOf: ISODate, opts: DefaultDriverOptions = {}): DefaultDriverResult {
  const drivers: DriverSet = {};
  const assumptions: Assumption[] = [];
  const notes: string[] = [];

  // Revenue
  const mrr = detectMrr(dataset.invoices, asOf);
  if (mrr.mrr !== null) {
    drivers[DRIVER_KEYS.MRR] = makeDriver(DRIVER_KEYS.MRR, "Monthly recurring revenue (invoiced, median of last complete months)", mrr.mrr, "USD/month", "CONFIRMED", { note: `From invoice history ${mrr.monthsUsed.join(", ")}; projecting it forward is an assumption.` });
  } else {
    notes.push("No complete month of invoice history: revenue driver not set (INSUFFICIENT_INFORMATION).");
    assumptions.push({ key: DRIVER_KEYS.MRR, description: "Monthly recurring revenue unknown: no invoice history.", value: null, status: "UNCONFIRMED" });
  }
  drivers[DRIVER_KEYS.REVENUE_GROWTH] = assumedDriver(DRIVER_KEYS.REVENUE_GROWTH, "Monthly revenue growth rate", opts.growthRate ?? 0, "ratio", "no confirmed growth plan; flat revenue unless overridden");

  // Payroll
  const pattern = detectPayrollCadence(dataset.payrollRuns);
  const lastRun = [...dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? -1 : 1)).pop();
  if (lastRun && pattern.runsPerMonth) {
    const k = pattern.runsPerMonth;
    const note = `From last payroll run ${lastRun.id} (${pattern.cadence}, ${k} runs/month); projecting it forward is an assumption.`;
    drivers[DRIVER_KEYS.PAYROLL_RUNS_PER_MONTH] = makeDriver(DRIVER_KEYS.PAYROLL_RUNS_PER_MONTH, "Payroll runs per month", k, "count", "CONFIRMED", { sourceId: lastRun.id, note: `Detected ${pattern.cadence} cadence from ${pattern.runIds.length} runs.` });
    drivers[DRIVER_KEYS.PAYROLL_GROSS] = makeDriver(DRIVER_KEYS.PAYROLL_GROSS, "Monthly gross wages", D(lastRun.totals.gross).times(k).toFixed(4), "USD/month", "CONFIRMED", { sourceId: lastRun.id, note });
    drivers[DRIVER_KEYS.PAYROLL_NET_PAY] = makeDriver(DRIVER_KEYS.PAYROLL_NET_PAY, "Monthly net pay", D(lastRun.totals.netPay).times(k).toFixed(4), "USD/month", "CONFIRMED", { sourceId: lastRun.id, note });
    drivers[DRIVER_KEYS.PAYROLL_TOTAL_TAXES] = makeDriver(DRIVER_KEYS.PAYROLL_TOTAL_TAXES, "Monthly payroll tax deposits (employee + employer)", D(lastRun.totals.employeeTaxes).plus(D(lastRun.totals.employerTaxes)).times(k).toFixed(4), "USD/month", "CONFIRMED", { sourceId: lastRun.id, note });
    const rate = D(lastRun.totals.gross).isZero() ? null : D(lastRun.totals.employerTaxes).div(D(lastRun.totals.gross)).toDecimalPlaces(10).toString();
    if (rate !== null) drivers[DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE] = makeDriver(DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE, "Effective employer payroll tax rate", rate, "ratio", "CONFIRMED", { sourceId: lastRun.id, note: "Historical effective rate from the last run; wage-base caps may change it later in the year (professional review)." });
  } else {
    const fromWorkers = payrollDriversFromWorkers(dataset.workers, asOf);
    assumptions.push(...fromWorkers.assumptions);
    if (fromWorkers.includedWorkerIds.length) {
      drivers[DRIVER_KEYS.PAYROLL_GROSS] = assumedDriver(DRIVER_KEYS.PAYROLL_GROSS, "Monthly gross wages (from worker compensation)", fromWorkers.monthlyGrossWages, "USD/month", "no payroll history; derived from worker compensation records");
      drivers[DRIVER_KEYS.PAYROLL_CONTRACTOR] = assumedDriver(DRIVER_KEYS.PAYROLL_CONTRACTOR, "Monthly contractor fees (from worker compensation)", fromWorkers.monthlyContractorFees, "USD/month", "no payroll history; derived from worker compensation records");
    } else notes.push("No payroll history and no usable worker compensation: payroll drivers not set.");
    if (opts.fallbackEmployerTaxRate) drivers[DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE] = makeDriver(DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE, "Effective employer payroll tax rate", opts.fallbackEmployerTaxRate.value, "ratio", opts.fallbackEmployerTaxRate.status, { sourceId: opts.fallbackEmployerTaxRate.sourceId, note: "Supplied rate assumption." });
    else if (fromWorkers.includedWorkerIds.length) {
      notes.push("Employer payroll tax rate unknown: no payroll history and no rate assumption supplied; employer taxes are not projected.");
      assumptions.push({ key: DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE, description: "Employer payroll tax rate unknown; employer taxes omitted from projection.", value: null, status: "UNCONFIRMED", requiresProfessionalReview: true });
    }
  }

  // Recurring expenses
  const recurring = detectRecurringVendors(dataset, asOf, opts.recurring);
  const defaultExpenseAccount = accountIdForCode(ACCT.OTHER_OPEX);
  for (const rv of recurring) {
    const key = expenseDriverKey(rv.accountId ?? defaultExpenseAccount, rv.merchant);
    drivers[key] = makeDriver(key, `Recurring: ${rv.merchant}`, rv.monthlyAmount, "USD/month", "CONFIRMED", { sourceId: rv.transactionIds[rv.transactionIds.length - 1], note: `Seen in ${rv.monthsSeen} months (median monthly amount); projecting it forward is an assumption.${rv.accountId ? "" : " Uncategorized; mapped to Other Operating Expense pending review."}` });
  }

  return { drivers, assumptions, notes, recurringVendors: recurring, payrollPattern: pattern, mrr };
}
