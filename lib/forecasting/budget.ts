/**
 * Driver-based budget builder and actuals extraction.
 *
 * Sign convention for budget / actual amounts: positive revenue, positive expense
 * (the account's normal balance). Net = revenue - expense.
 */
import type { Account, Assumption, Budget, BudgetLine, CompanyDataset, DecimalString, ID, ISODate, Worker } from "@/lib/core/types";
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { monthKey, monthsBetween } from "@/lib/core/dates";
import { deterministicId, fingerprint } from "@/lib/core/ids";
import { D, add, sub } from "@/lib/core/money";
import type { ActualsByAccountMonth } from "@/lib/finance/variance";
import type { PayrollRateAssumptionSet } from "@/lib/finance/headcount";
import { DRIVER_KEYS, type DriverSet, assumedDriver, driverDecimal, driversToAssumptions, makeDriver, parseEventDriverKey, parseExpenseDriverKey, payrollDriversFromWorkers } from "./drivers";

export interface DriverModelOptions {
  accounts: Account[];
  revenueAccountId?: ID;
  payrollAccountId?: ID;
  contractorAccountId?: ID;
  employerTaxAccountId?: ID;
}

export interface ProjectedLine {
  accountId: ID;
  month: string;
  amount: DecimalString;
  driverKeys: string[];
}

export interface Projection {
  lines: ProjectedLine[];
  assumptions: Assumption[];
  notes: string[];
}

/**
 * Project P&L lines for the given months from a driver set.
 * Month index n counts from 0 at the first projected month: revenue_n = MRR * (1 + g)^n.
 */
export function projectDriverLines(drivers: DriverSet, months: string[], opts: DriverModelOptions): Projection {
  const accountIds = new Set(opts.accounts.map((a) => a.id));
  const revenueAcct = opts.revenueAccountId ?? accountIdForCode(ACCT.SERVICE_REVENUE);
  const payrollAcct = opts.payrollAccountId ?? accountIdForCode(ACCT.SALARIES);
  const contractorAcct = opts.contractorAccountId ?? accountIdForCode(ACCT.CONTRACTORS_DOMESTIC);
  const taxAcct = opts.employerTaxAccountId ?? accountIdForCode(ACCT.EMPLOYER_PAYROLL_TAX);
  const notes: string[] = [];
  const assumptions: Assumption[] = driversToAssumptions(drivers);
  const acc = new Map<string, ProjectedLine>();
  const put = (accountId: ID, month: string, amount: DecimalString, driverKey: string) => {
    if (!accountIds.has(accountId)) notes.push(`Driver ${driverKey} references unknown account ${accountId}.`);
    const k = `${accountId}|${month}`;
    const cur = acc.get(k);
    if (cur) {
      cur.amount = add(cur.amount, amount);
      if (!cur.driverKeys.includes(driverKey)) cur.driverKeys.push(driverKey);
    } else acc.set(k, { accountId, month, amount: D(amount).toFixed(4), driverKeys: [driverKey] });
  };

  const mrr = driverDecimal(drivers, DRIVER_KEYS.MRR);
  const growth = driverDecimal(drivers, DRIVER_KEYS.REVENUE_GROWTH) ?? D(0);
  const gross = driverDecimal(drivers, DRIVER_KEYS.PAYROLL_GROSS);
  const contractor = driverDecimal(drivers, DRIVER_KEYS.PAYROLL_CONTRACTOR);
  const taxRate = driverDecimal(drivers, DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE);
  if (mrr === null) notes.push(`INSUFFICIENT_INFORMATION: ${DRIVER_KEYS.MRR} not set; no revenue projected.`);
  if (gross !== null && taxRate === null) notes.push(`INSUFFICIENT_INFORMATION: ${DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE} not set; employer payroll taxes not projected.`);
  if (!drivers[DRIVER_KEYS.REVENUE_GROWTH]) assumptions.push({ key: DRIVER_KEYS.REVENUE_GROWTH, description: "ASSUMED: no growth driver supplied; revenue held flat.", value: 0, status: "UNCONFIRMED" });

  const expenseDrivers = Object.values(drivers).filter((d) => parseExpenseDriverKey(d.key));
  const eventDrivers = Object.values(drivers).filter((d) => parseEventDriverKey(d.key));

  months.forEach((month, n) => {
    if (mrr !== null) put(revenueAcct, month, mrr.times(growth.plus(1).pow(n)).toFixed(4), DRIVER_KEYS.MRR);
    if (gross !== null) {
      put(payrollAcct, month, gross.toFixed(4), DRIVER_KEYS.PAYROLL_GROSS);
      if (taxRate !== null) put(taxAcct, month, gross.times(taxRate).toFixed(4), DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE);
    }
    if (contractor !== null && !contractor.isZero()) put(contractorAcct, month, contractor.toFixed(4), DRIVER_KEYS.PAYROLL_CONTRACTOR);
    for (const d of expenseDrivers) {
      const p = parseExpenseDriverKey(d.key)!;
      const v = driverDecimal(drivers, d.key);
      if (v !== null) put(p.accountId, month, v.toFixed(4), d.key);
    }
    for (const d of eventDrivers) {
      const p = parseEventDriverKey(d.key)!;
      const v = driverDecimal(drivers, d.key);
      if (v !== null && p.month === month) put(p.accountId, month, v.toFixed(4), d.key);
    }
  });

  const lines = Array.from(acc.values()).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.accountId < b.accountId ? -1 : 1));
  return { lines, assumptions, notes };
}

export interface BuildBudgetOptions extends Partial<Omit<DriverModelOptions, "accounts">> {
  /** Derive payroll drivers from workers' compensation (overrides payroll drivers in `drivers`). */
  workers?: Worker[];
  /** Employer payroll tax rate assumptions used to derive an effective employer tax rate. */
  rates?: PayrollRateAssumptionSet | null;
  /** Explicit recurring expense list (added as expense drivers). */
  recurringExpenses?: { accountId: ID; label: string; monthlyAmount: DecimalString | number; sourceId?: ID; status?: "CONFIRMED" | "UNCONFIRMED" }[];
  name?: string;
  version?: number;
  /** First month of the fiscal year (1 = January). */
  fiscalYearStartMonth?: number;
  createdAt?: string;
}

/** Effective employer tax rate from rate assumptions (sum of employer rates; wage-base caps ignored → conservative). */
export function effectiveEmployerTaxRate(rates: PayrollRateAssumptionSet): { rate: number | null; assumptions: Assumption[]; missing: string[] } {
  const keys = ["socialSecurityRate", "medicareRate", "futaRate", "suiRate", "ettRate"] as const;
  const missing = keys.filter((k) => rates[k].value === null);
  const assumptions: Assumption[] = keys.map((k) => ({ key: `payroll_rate:${k}`, description: `${k} used for budgeted employer taxes (wage-base caps ignored — conservative).`, value: rates[k].value, status: rates[k].status, sourceId: rates[k].sourceId, requiresProfessionalReview: rates[k].status !== "CONFIRMED" }));
  if (missing.length) return { rate: null, assumptions, missing: [...missing] };
  const rate = keys.reduce((acc, k) => acc.plus(D(rates[k].value as DecimalString)), D(0)).toNumber();
  return { rate, assumptions, missing: [] };
}

/** Build a driver-based fiscal-year budget. */
export function buildBudget(fiscalYear: number, drivers: DriverSet, accounts: Account[], opts: BuildBudgetOptions = {}): Budget {
  const startMonth = opts.fiscalYearStartMonth ?? 1;
  const first = `${fiscalYear}-${String(startMonth).padStart(2, "0")}`;
  const months = monthsBetween(first, monthKey(addMonthsToMonth(first, 11)));
  const effective: DriverSet = { ...drivers };
  const extraAssumptions: Assumption[] = [];
  const notes: string[] = [];

  if (opts.workers) {
    const w = payrollDriversFromWorkers(opts.workers, `${first}-01`);
    effective[DRIVER_KEYS.PAYROLL_GROSS] = makeDriver(DRIVER_KEYS.PAYROLL_GROSS, "Monthly gross wages (from worker compensation)", w.monthlyGrossWages, "USD/month", w.assumptions.some((a) => a.status !== "CONFIRMED") ? "UNCONFIRMED" : "CONFIRMED", { note: `From ${w.includedWorkerIds.length} worker(s); ${w.excludedWorkerIds.length} excluded for unknown compensation.` });
    effective[DRIVER_KEYS.PAYROLL_CONTRACTOR] = makeDriver(DRIVER_KEYS.PAYROLL_CONTRACTOR, "Monthly contractor fees (from worker compensation)", w.monthlyContractorFees, "USD/month", "CONFIRMED", { note: "From worker compensation records." });
    extraAssumptions.push(...w.assumptions);
  }
  if (opts.rates) {
    const r = effectiveEmployerTaxRate(opts.rates);
    extraAssumptions.push(...r.assumptions);
    if (r.rate !== null) effective[DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE] = makeDriver(DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE, "Effective employer payroll tax rate (sum of rate assumptions)", r.rate, "ratio", r.assumptions.every((a) => a.status === "CONFIRMED") ? "CONFIRMED" : "UNCONFIRMED", { sourceId: opts.rates.id });
    else notes.push(`INSUFFICIENT_INFORMATION: payroll rate assumptions missing (${r.missing.join(", ")}); employer taxes not budgeted.`);
  } else if (opts.rates === null) {
    notes.push("INSUFFICIENT_INFORMATION: no payroll rate assumption set; employer taxes not budgeted.");
    extraAssumptions.push({ key: DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE, description: "Employer payroll tax rates unknown.", value: null, status: "UNCONFIRMED", requiresProfessionalReview: true });
    delete effective[DRIVER_KEYS.PAYROLL_EMPLOYER_TAX_RATE];
  }
  for (const e of opts.recurringExpenses ?? []) {
    const key = `expense:${e.accountId}:${slugOf(e.label)}`;
    effective[key] = e.status === "UNCONFIRMED" ? assumedDriver(key, `Recurring: ${e.label}`, D(e.monthlyAmount).toFixed(4), "USD/month", "recurring expense list", e.sourceId) : makeDriver(key, `Recurring: ${e.label}`, D(e.monthlyAmount).toFixed(4), "USD/month", "CONFIRMED", { sourceId: e.sourceId });
  }

  const projection = projectDriverLines(effective, months, { accounts, revenueAccountId: opts.revenueAccountId, payrollAccountId: opts.payrollAccountId, contractorAccountId: opts.contractorAccountId, employerTaxAccountId: opts.employerTaxAccountId });
  const lines: BudgetLine[] = projection.lines.map((l) => ({ accountId: l.accountId, month: l.month, amount: l.amount, driverKey: l.driverKeys.join(","), note: undefined }));
  const allNotes = [...notes, ...projection.notes];
  const assumptions: Assumption[] = [...projection.assumptions, ...extraAssumptions, ...allNotes.map((n, i) => ({ key: `budget_note:${i}`, description: n, value: null, status: "UNCONFIRMED" as const }))];
  const name = opts.name ?? `FY${fiscalYear} driver-based budget`;
  const version = opts.version ?? 1;
  return {
    id: deterministicId("budget", name, fiscalYear, version, fingerprint(effective)),
    name,
    fiscalYear,
    version,
    status: "DRAFT",
    lines,
    assumptions,
    createdAt: opts.createdAt ?? `${first}-01T00:00:00.000Z`,
  };
}

function slugOf(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

function addMonthsToMonth(month: string, n: number): ISODate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = (m % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

/**
 * Actuals by P&L account and month from POSTED journal entries in [from, to].
 * REVENUE accounts: credit - debit (positive revenue). EXPENSE accounts: debit - credit (positive expense).
 */
export function actualsByAccountMonth(dataset: CompanyDataset, from: ISODate, to: ISODate): ActualsByAccountMonth {
  const acctById = new Map(dataset.accounts.map((a) => [a.id, a]));
  const out: ActualsByAccountMonth = {};
  for (const je of dataset.journalEntries) {
    if (je.status !== "POSTED") continue;
    if (je.date < from || je.date > to) continue;
    const month = monthKey(je.date);
    for (const line of je.lines) {
      const acct = acctById.get(line.accountId);
      if (!acct || (acct.type !== "REVENUE" && acct.type !== "EXPENSE")) continue;
      const signed = acct.type === "REVENUE" ? sub(line.credit, line.debit) : sub(line.debit, line.credit);
      out[line.accountId] ??= {};
      out[line.accountId][month] = add(out[line.accountId][month] ?? 0, signed);
    }
  }
  return out;
}
