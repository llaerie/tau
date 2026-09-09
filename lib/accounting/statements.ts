/**
 * Pure statement builders. They operate on an account list and journal entries and never
 * mutate anything. Only entries with "posted effect" (POSTED, or REVERSED originals whose
 * reversal is itself posted) contribute to balances.
 */
import Decimal from "decimal.js";
import { addDays } from "@/lib/core/dates";
import { D, money, within } from "@/lib/core/money";
import type {
  Account,
  AccountSubtype,
  CashFlowSection,
  ID,
  ISODate,
  JournalEntry,
  JournalSource,
} from "@/lib/core/types";
import type {
  BalanceSheet,
  CashFlowStatement,
  IncomeStatement,
  StatementLine,
  TrialBalance,
  TrialBalanceRow,
} from "@/lib/core/contracts";
import { fiscalYearStart } from "./periods";

export interface Movement {
  debit: Decimal;
  credit: Decimal;
}
export type MovementMap = Map<ID, Movement>;

export interface MovementOptions {
  from?: ISODate;
  to: ISODate;
  excludeSources?: readonly JournalSource[];
}

/** Entries that affect balances: posted, or reversed originals (their reversal offsets them). */
export function hasPostedEffect(entry: JournalEntry): boolean {
  return entry.status === "POSTED" || entry.status === "REVERSED";
}

export function isPnlAccount(a: Account): boolean {
  return a.type === "REVENUE" || a.type === "EXPENSE";
}

export function isBalanceSheetAccount(a: Account): boolean {
  return !isPnlAccount(a);
}

const ZERO: Movement = { debit: new Decimal(0), credit: new Decimal(0) };

/** Aggregate debit/credit movement per account over a date range (inclusive). */
export function movements(entries: readonly JournalEntry[], opts: MovementOptions): MovementMap {
  const out: MovementMap = new Map();
  const excluded = new Set(opts.excludeSources ?? []);
  for (const e of entries) {
    if (!hasPostedEffect(e)) continue;
    if (e.date > opts.to) continue;
    if (opts.from && e.date < opts.from) continue;
    if (excluded.has(e.source)) continue;
    for (const line of e.lines) {
      const cur = out.get(line.accountId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
      out.set(line.accountId, { debit: cur.debit.plus(D(line.debit)), credit: cur.credit.plus(D(line.credit)) });
    }
  }
  return out;
}

export function movementOf(map: MovementMap, accountId: ID): Movement {
  return map.get(accountId) ?? ZERO;
}

/** Balance in normal-balance convention (positive = normal side). */
export function signedBalance(account: Account, mv: Movement): Decimal {
  const net = mv.debit.minus(mv.credit);
  return account.normalBalance === "DEBIT" ? net : net.neg();
}

/** Credit-minus-debit movement — the cash-effect convention used by the indirect cash flow. */
export function creditNet(mv: Movement): Decimal {
  return mv.credit.minus(mv.debit);
}

export function sumSigned(accounts: readonly Account[], map: MovementMap): Decimal {
  return accounts.reduce((acc, a) => acc.plus(signedBalance(a, movementOf(map, a.id))), new Decimal(0));
}

const byCode = (a: Account, b: Account) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export function buildTrialBalance(accounts: readonly Account[], entries: readonly JournalEntry[], asOf: ISODate, from?: ISODate): TrialBalance {
  const map = movements(entries, { from, to: asOf });
  const rows: TrialBalanceRow[] = [];
  let totalDebits = new Decimal(0);
  let totalCredits = new Decimal(0);
  for (const a of [...accounts].sort(byCode)) {
    const mv = movementOf(map, a.id);
    if (mv.debit.isZero() && mv.credit.isZero()) continue;
    const net = mv.debit.minus(mv.credit);
    const debit = net.gt(0) ? net : new Decimal(0);
    const credit = net.lt(0) ? net.neg() : new Decimal(0);
    totalDebits = totalDebits.plus(debit);
    totalCredits = totalCredits.plus(credit);
    rows.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      debit: money(debit),
      credit: money(credit),
      balance: money(signedBalance(a, mv)),
    });
  }
  return {
    asOfDate: asOf,
    fromDate: from,
    rows,
    totalDebits: money(totalDebits),
    totalCredits: money(totalCredits),
    balanced: within(totalDebits, totalCredits, "0.005"),
  };
}

// ---------------------------------------------------------------------------
// Income statement
// ---------------------------------------------------------------------------

const OPEX_SUBTYPES: ReadonlySet<AccountSubtype> = new Set<AccountSubtype>([
  "PAYROLL_EXPENSE",
  "PAYROLL_TAX_EXPENSE",
  "OPERATING_EXPENSE",
  "DEPRECIATION_EXPENSE",
  "TAX_EXPENSE",
  "SUSPENSE",
]);
const OTHER_EXPENSE_SUBTYPES: ReadonlySet<AccountSubtype> = new Set<AccountSubtype>(["INTEREST_EXPENSE", "OTHER_EXPENSE"]);

function accountLines(accounts: Account[], map: MovementMap, level: number, sign: 1 | -1 = 1): { lines: StatementLine[]; total: Decimal } {
  const lines: StatementLine[] = [];
  let total = new Decimal(0);
  for (const a of accounts.sort(byCode)) {
    const mv = movementOf(map, a.id);
    if (mv.debit.isZero() && mv.credit.isZero()) continue;
    const bal = signedBalance(a, mv).times(sign);
    total = total.plus(bal);
    lines.push({ accountId: a.id, code: a.code, label: a.name, amount: money(bal), level });
  }
  return { lines, total };
}

const header = (label: string, amount: Decimal, level: number): StatementLine => ({ label, amount: money(amount), level });
const total = (label: string, amount: Decimal, level: number, sourceAccountIds?: ID[]): StatementLine => ({
  label,
  amount: money(amount),
  level,
  isTotal: true,
  sourceAccountIds,
});

export function buildIncomeStatement(accounts: readonly Account[], entries: readonly JournalEntry[], from: ISODate, to: ISODate): IncomeStatement {
  // Closing entries are equity reclassifications; they must never appear as P&L activity.
  const map = movements(entries, { from, to, excludeSources: ["CLOSING"] });
  const revenueAccts = accounts.filter((a) => a.type === "REVENUE" && a.subtype === "OPERATING_REVENUE");
  const cogsAccts = accounts.filter((a) => a.type === "EXPENSE" && a.subtype === "COST_OF_REVENUE");
  const opexAccts = accounts.filter((a) => a.type === "EXPENSE" && OPEX_SUBTYPES.has(a.subtype));
  const otherIncomeAccts = accounts.filter((a) => a.type === "REVENUE" && a.subtype !== "OPERATING_REVENUE");
  const otherExpenseAccts = accounts.filter((a) => a.type === "EXPENSE" && OTHER_EXPENSE_SUBTYPES.has(a.subtype));
  // Any expense subtype not classified above still counts as opex so nothing is dropped.
  const unclassified = accounts.filter(
    (a) => a.type === "EXPENSE" && !OPEX_SUBTYPES.has(a.subtype) && !OTHER_EXPENSE_SUBTYPES.has(a.subtype) && a.subtype !== "COST_OF_REVENUE",
  );

  const rev = accountLines(revenueAccts, map, 1);
  const cogs = accountLines(cogsAccts, map, 1);
  const opex = accountLines([...opexAccts, ...unclassified], map, 1);
  const otherInc = accountLines(otherIncomeAccts, map, 1, 1);
  const otherExp = accountLines(otherExpenseAccts, map, 1, -1);

  const grossProfit = rev.total.minus(cogs.total);
  const operatingIncome = grossProfit.minus(opex.total);
  const otherNet = otherInc.total.plus(otherExp.total);
  const netIncome = operatingIncome.plus(otherNet);

  const lines: StatementLine[] = [
    header("Revenue", rev.total, 0),
    ...rev.lines,
    total("Total Revenue", rev.total, 0, revenueAccts.map((a) => a.id)),
    header("Cost of Revenue", cogs.total, 0),
    ...cogs.lines,
    total("Total Cost of Revenue", cogs.total, 0, cogsAccts.map((a) => a.id)),
    total("Gross Profit", grossProfit, 0),
    header("Operating Expenses", opex.total, 0),
    ...opex.lines,
    total("Total Operating Expenses", opex.total, 0, opexAccts.map((a) => a.id)),
    total("Operating Income", operatingIncome, 0),
    header("Other Income / (Expense)", otherNet, 0),
    ...otherInc.lines,
    ...otherExp.lines,
    total("Total Other Income / (Expense)", otherNet, 0),
    total("Net Income", netIncome, 0),
  ];

  return {
    kind: "INCOME_STATEMENT",
    fromDate: from,
    toDate: to,
    lines,
    revenue: money(rev.total),
    costOfRevenue: money(cogs.total),
    grossProfit: money(grossProfit),
    operatingExpenses: money(opex.total),
    operatingIncome: money(operatingIncome),
    otherIncomeExpense: money(otherNet),
    netIncome: money(netIncome),
    calcIds: [],
  };
}

/** Net income (credit − debit over P&L accounts) for a range, optionally including CLOSING entries. */
export function pnlNet(accounts: readonly Account[], entries: readonly JournalEntry[], from: ISODate | undefined, to: ISODate, includeClosing: boolean): Decimal {
  const map = movements(entries, { from, to, excludeSources: includeClosing ? [] : ["CLOSING"] });
  let n = new Decimal(0);
  for (const a of accounts) {
    if (!isPnlAccount(a)) continue;
    n = n.plus(creditNet(movementOf(map, a.id)));
  }
  return n;
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

const CURRENT_ASSET_SUBTYPES: ReadonlySet<AccountSubtype> = new Set<AccountSubtype>(["CASH", "ACCOUNTS_RECEIVABLE", "PREPAID", "OTHER_CURRENT_ASSET"]);
const FIXED_ASSET_SUBTYPES: ReadonlySet<AccountSubtype> = new Set<AccountSubtype>(["FIXED_ASSET", "ACCUMULATED_DEPRECIATION"]);

export function buildBalanceSheet(accounts: readonly Account[], entries: readonly JournalEntry[], asOf: ISODate): BalanceSheet {
  const map = movements(entries, { to: asOf });
  const fyStart = fiscalYearStart(asOf);
  const priorEnd = addDays(fyStart, -1);

  const assets = accounts.filter((a) => a.type === "ASSET");
  const currentAssets = assets.filter((a) => CURRENT_ASSET_SUBTYPES.has(a.subtype));
  const fixedAssets = assets.filter((a) => FIXED_ASSET_SUBTYPES.has(a.subtype));
  const otherAssets = assets.filter((a) => !CURRENT_ASSET_SUBTYPES.has(a.subtype) && !FIXED_ASSET_SUBTYPES.has(a.subtype));
  const cashAccts = assets.filter((a) => a.subtype === "CASH");

  const liabilities = accounts.filter((a) => a.type === "LIABILITY");
  const currentLiabs = liabilities.filter((a) => a.subtype !== "LONG_TERM_DEBT");
  const longTermLiabs = liabilities.filter((a) => a.subtype === "LONG_TERM_DEBT");

  const equity = accounts.filter((a) => a.type === "EQUITY");
  const capitalAccts = equity.filter((a) => a.subtype !== "SHAREHOLDER_DISTRIBUTIONS" && a.subtype !== "RETAINED_EARNINGS");
  const distributionAccts = equity.filter((a) => a.subtype === "SHAREHOLDER_DISTRIBUTIONS");
  const reAccts = equity.filter((a) => a.subtype === "RETAINED_EARNINGS");

  const ca = accountLines(currentAssets, map, 2);
  const fa = accountLines(fixedAssets, map, 2);
  const oa = accountLines(otherAssets, map, 2);
  const totalAssets = ca.total.plus(fa.total).plus(oa.total);
  const cash = sumSigned(cashAccts, map);

  const cl = accountLines(currentLiabs, map, 2);
  const ltl = accountLines(longTermLiabs, map, 2);
  const totalLiabilities = cl.total.plus(ltl.total);

  const cap = accountLines(capitalAccts, map, 2);
  const dist = accountLines(distributionAccts, map, 2);
  const reAccountBalance = sumSigned(reAccts, map);
  // Prior-year P&L not yet closed rolls into retained earnings automatically. Closing entries are
  // included here so an already-closed year is not double counted (its P&L nets to zero).
  const priorYearsEarnings = pnlNet(accounts, entries, undefined, priorEnd, true);
  const retainedEarnings = reAccountBalance.plus(priorYearsEarnings);
  const currentYearEarnings = pnlNet(accounts, entries, fyStart, asOf, true);
  const totalEquity = cap.total.plus(dist.total).plus(retainedEarnings).plus(currentYearEarnings);

  const liabPlusEquity = totalLiabilities.plus(totalEquity);
  const difference = totalAssets.minus(liabPlusEquity);

  const lines: StatementLine[] = [
    header("Assets", totalAssets, 0),
    header("Current Assets", ca.total, 1),
    ...ca.lines,
    total("Total Current Assets", ca.total, 1, currentAssets.map((a) => a.id)),
    header("Fixed Assets (net)", fa.total, 1),
    ...fa.lines,
    total("Total Fixed Assets (net)", fa.total, 1, fixedAssets.map((a) => a.id)),
    header("Other Assets", oa.total, 1),
    ...oa.lines,
    total("Total Other Assets", oa.total, 1, otherAssets.map((a) => a.id)),
    total("Total Assets", totalAssets, 0, assets.map((a) => a.id)),
    header("Liabilities", totalLiabilities, 0),
    header("Current Liabilities", cl.total, 1),
    ...cl.lines,
    total("Total Current Liabilities", cl.total, 1, currentLiabs.map((a) => a.id)),
    header("Long-term Liabilities", ltl.total, 1),
    ...ltl.lines,
    total("Total Long-term Liabilities", ltl.total, 1, longTermLiabs.map((a) => a.id)),
    total("Total Liabilities", totalLiabilities, 0, liabilities.map((a) => a.id)),
    header("Equity", totalEquity, 0),
    ...cap.lines,
    ...dist.lines,
    { label: "Retained Earnings", amount: money(retainedEarnings), level: 2, sourceAccountIds: reAccts.map((a) => a.id) },
    { label: "Current Year Earnings", amount: money(currentYearEarnings), level: 2, sourceAccountIds: accounts.filter(isPnlAccount).map((a) => a.id) },
    total("Total Equity", totalEquity, 0, equity.map((a) => a.id)),
    total("Total Liabilities & Equity", liabPlusEquity, 0),
  ];

  return {
    kind: "BALANCE_SHEET",
    asOfDate: asOf,
    lines,
    totalAssets: money(totalAssets),
    totalLiabilities: money(totalLiabilities),
    totalEquity: money(totalEquity),
    currentAssets: money(ca.total),
    currentLiabilities: money(cl.total),
    cash: money(cash),
    currentYearEarnings: money(currentYearEarnings),
    balanced: within(totalAssets, liabPlusEquity, "0.005"),
    difference: money(difference),
  };
}

// ---------------------------------------------------------------------------
// Cash flow statement (indirect)
// ---------------------------------------------------------------------------

/** Effective cash-flow section of a balance-sheet account (explicit section, else inferred). */
export function cashFlowSectionOf(a: Account): CashFlowSection {
  if (a.cashFlowSection) return a.cashFlowSection;
  if (a.subtype === "CASH") return "CASH";
  if (a.type === "ASSET") return a.subtype === "FIXED_ASSET" || a.subtype === "OTHER_ASSET" ? "INVESTING" : "OPERATING";
  if (a.type === "LIABILITY") return a.subtype === "LONG_TERM_DEBT" ? "FINANCING" : "OPERATING";
  return "FINANCING";
}

export function cashBalance(accounts: readonly Account[], entries: readonly JournalEntry[], asOf: ISODate): Decimal {
  const map = movements(entries, { to: asOf });
  return sumSigned(
    accounts.filter((a) => a.subtype === "CASH"),
    map,
  );
}

export function buildCashFlowStatement(accounts: readonly Account[], entries: readonly JournalEntry[], from: ISODate, to: ISODate): CashFlowStatement {
  // Closing entries are excluded end-to-end: they are non-cash equity reclassifications.
  const map = movements(entries, { from, to, excludeSources: ["CLOSING"] });
  const netIncome = pnlNet(accounts, entries, from, to, false);

  const bsAccounts = [...accounts].filter((a) => isBalanceSheetAccount(a) && cashFlowSectionOf(a) !== "CASH").sort(byCode);

  const operatingAdjustments: StatementLine[] = [];
  const investingLines: StatementLine[] = [];
  const financingLines: StatementLine[] = [];
  let operating = netIncome;
  let investing = new Decimal(0);
  let financing = new Decimal(0);

  // Depreciation first (add-back), then other operating working-capital changes.
  const depAccts = bsAccounts.filter((a) => a.subtype === "ACCUMULATED_DEPRECIATION");
  let depreciation = new Decimal(0);
  for (const a of depAccts) depreciation = depreciation.plus(creditNet(movementOf(map, a.id)));
  if (!depreciation.isZero()) {
    operatingAdjustments.push({ label: "Depreciation & amortization", amount: money(depreciation), level: 1, sourceAccountIds: depAccts.map((a) => a.id) });
    operating = operating.plus(depreciation);
  }

  for (const a of bsAccounts) {
    if (a.subtype === "ACCUMULATED_DEPRECIATION") continue;
    const effect = creditNet(movementOf(map, a.id));
    if (effect.isZero()) continue;
    const section = cashFlowSectionOf(a);
    const line: StatementLine = { accountId: a.id, code: a.code, label: `Change in ${a.name}`, amount: money(effect), level: 1 };
    if (section === "OPERATING") {
      operatingAdjustments.push(line);
      operating = operating.plus(effect);
    } else if (section === "INVESTING") {
      investingLines.push(line);
      investing = investing.plus(effect);
    } else {
      financingLines.push(line);
      financing = financing.plus(effect);
    }
  }

  const netChange = operating.plus(investing).plus(financing);
  const openingCash = cashBalance(accounts, entries, addDays(from, -1));
  const closingCash = cashBalance(accounts, entries, to);
  const difference = openingCash.plus(netChange).minus(closingCash);

  return {
    kind: "CASH_FLOW_STATEMENT",
    fromDate: from,
    toDate: to,
    method: "INDIRECT",
    netIncome: money(netIncome),
    operatingAdjustments,
    operating: money(operating),
    investingLines,
    investing: money(investing),
    financingLines,
    financing: money(financing),
    netChange: money(netChange),
    openingCash: money(openingCash),
    closingCash: money(closingCash),
    reconciled: within(difference, 0, "0.005"),
    difference: money(difference),
  };
}

/** True when the entry's debits equal its credits at 4 dp. */
export function entryBalances(entry: Pick<JournalEntry, "lines">): boolean {
  const debits = entry.lines.reduce((acc, l) => acc.plus(D(l.debit)), new Decimal(0));
  const credits = entry.lines.reduce((acc, l) => acc.plus(D(l.credit)), new Decimal(0));
  return debits.toFixed(4) === credits.toFixed(4);
}
