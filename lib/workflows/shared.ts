/**
 * Helpers shared by the CFO workflows: calculation collection/persistence, cash-received and
 * expense extraction from the ledger, statement bundles and close-entry tagging conventions.
 */
import { hasPostedEffect } from "@/lib/accounting/statements";
import type { BalanceSheet, CashFlowStatement, IncomeStatement, LedgerEngine, TrialBalance } from "@/lib/core/contracts";
import type { Assumption, CalcResult, CompanyDataset, DecimalString, ID, ISODate, JournalEntry } from "@/lib/core/types";
import { D, add, min, money, sub } from "@/lib/core/money";
import type { LabRuntime } from "@/lib/db/runtime";
import { makeCalc } from "@/lib/finance/calc-result";

export class CalcCollector {
  private readonly map = new Map<ID, CalcResult>();

  add<T>(calc: CalcResult<T>): CalcResult<T> {
    if (!this.map.has(calc.id)) this.map.set(calc.id, calc);
    return calc;
  }
  addAll(calcs: readonly CalcResult[]): void {
    for (const c of calcs) this.add(c);
  }
  get calcs(): CalcResult[] {
    return [...this.map.values()];
  }
  get ids(): ID[] {
    return [...this.map.keys()];
  }
  get sourceIds(): ID[] {
    return Array.from(new Set(this.calcs.flatMap((c) => c.sourceIds)));
  }
  /** Every assumption carried by a collected calculation, tagged with the calc id. */
  get assumptions(): (Assumption & { calcId: ID })[] {
    return this.calcs.flatMap((c) => c.assumptions.map((a) => ({ ...a, calcId: c.id })));
  }
}

export async function persistCalcs(rt: LabRuntime, calcs: readonly CalcResult[]): Promise<void> {
  if (calcs.length) await rt.store.upsertMany("calculations", [...calcs]);
}

export function inRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Cash received from customers
// ---------------------------------------------------------------------------

export interface RevenueReceived {
  amount: DecimalString;
  entryIds: ID[];
  calc: CalcResult<DecimalString>;
}

/**
 * Cash received from customers in [from, to]: posted entries that debit a cash account and credit
 * AR or a revenue account (invoice payments and direct revenue deposits).
 */
export function revenueReceived(dataset: CompanyDataset, from: ISODate, to: ISODate, label: string): RevenueReceived {
  const acct = new Map(dataset.accounts.map((a) => [a.id, a]));
  let total = money(0);
  const entryIds: ID[] = [];
  for (const e of dataset.journalEntries) {
    if (!hasPostedEffect(e) || !inRange(e.date, from, to) || e.source === "CLOSING") continue;
    let cashIn = D(0);
    let customerCredit = D(0);
    for (const l of e.lines) {
      const a = acct.get(l.accountId);
      if (!a) continue;
      if (a.subtype === "CASH") cashIn = cashIn.plus(D(l.debit)).minus(D(l.credit));
      if (a.subtype === "ACCOUNTS_RECEIVABLE" || a.type === "REVENUE") customerCredit = customerCredit.plus(D(l.credit)).minus(D(l.debit));
    }
    if (cashIn.lte(0) || customerCredit.lte(0)) continue;
    total = add(total, min(cashIn, customerCredit));
    entryIds.push(e.id);
  }
  const calc = makeCalc<DecimalString>({
    name: `revenue_received_${label}`,
    value: total,
    unit: "USD",
    formula: "sum over posted entries in range of min(cash debited, AR/revenue credited)",
    inputs: { from, to, entryIds },
    sourceIds: entryIds,
    asOfDate: to,
  });
  return { amount: total, entryIds, calc };
}

// ---------------------------------------------------------------------------
// Expenses by account
// ---------------------------------------------------------------------------

export interface ExpenseRow {
  accountId: ID;
  code: string;
  name: string;
  amount: DecimalString;
}

export interface ExpenseBreakdown {
  total: DecimalString;
  byAccount: ExpenseRow[];
  calc: CalcResult<{ total: DecimalString; byAccount: ExpenseRow[] }>;
}

/** Expense (debit − credit) per EXPENSE account over [from, to], top N by amount. */
export function expensesByAccount(dataset: CompanyDataset, from: ISODate, to: ISODate, label: string, topN = 5): ExpenseBreakdown {
  const acct = new Map(dataset.accounts.map((a) => [a.id, a]));
  const sums = new Map<ID, DecimalString>();
  const entryIds: ID[] = [];
  for (const e of dataset.journalEntries) {
    if (!hasPostedEffect(e) || !inRange(e.date, from, to) || e.source === "CLOSING") continue;
    let touched = false;
    for (const l of e.lines) {
      const a = acct.get(l.accountId);
      if (!a || a.type !== "EXPENSE") continue;
      sums.set(a.id, add(sums.get(a.id) ?? 0, sub(l.debit, l.credit)));
      touched = true;
    }
    if (touched) entryIds.push(e.id);
  }
  const rows: ExpenseRow[] = [...sums.entries()]
    .map(([id, amount]) => ({ accountId: id, code: acct.get(id)?.code ?? id, name: acct.get(id)?.name ?? id, amount }))
    .filter((r) => !D(r.amount).isZero())
    .sort((a, b) => D(b.amount).cmp(D(a.amount)) || a.code.localeCompare(b.code));
  const total = rows.reduce((acc, r) => add(acc, r.amount), money(0));
  const byAccount = rows.slice(0, topN);
  const calc = makeCalc({
    name: `expenses_${label}`,
    value: { total, byAccount },
    unit: "USD",
    formula: "expense per account = sum(debit − credit) over posted entries in range; total = sum over EXPENSE accounts",
    inputs: { from, to, rows: rows.map((r) => ({ accountId: r.accountId, amount: r.amount })) },
    sourceIds: entryIds,
    asOfDate: to,
  });
  return { total, byAccount, calc };
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface StatementBundle {
  trialBalance: TrialBalance;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
}

export function statementsFor(ledger: LedgerEngine, from: ISODate, to: ISODate): StatementBundle {
  return {
    trialBalance: ledger.trialBalance(to),
    incomeStatement: ledger.incomeStatement(from, to),
    balanceSheet: ledger.balanceSheet(to),
    cashFlowStatement: ledger.cashFlowStatement(from, to),
  };
}

export function statementTotalsCalc(name: string, s: StatementBundle, sourceIds: ID[] = []): CalcResult<Record<string, DecimalString | boolean>> {
  const value = {
    revenue: s.incomeStatement.revenue,
    operatingExpenses: s.incomeStatement.operatingExpenses,
    netIncome: s.incomeStatement.netIncome,
    totalAssets: s.balanceSheet.totalAssets,
    totalLiabilities: s.balanceSheet.totalLiabilities,
    totalEquity: s.balanceSheet.totalEquity,
    cash: s.balanceSheet.cash,
    closingCash: s.cashFlowStatement.closingCash,
    trialBalanceBalanced: s.trialBalance.balanced,
    balanceSheetBalanced: s.balanceSheet.balanced,
    cashFlowReconciled: s.cashFlowStatement.reconciled,
  };
  return makeCalc({
    name,
    value,
    unit: "OBJECT",
    formula: "statement totals from the double-entry ledger (income statement, balance sheet, indirect cash flow)",
    inputs: { from: s.incomeStatement.fromDate, to: s.incomeStatement.toDate, ...value },
    sourceIds,
    asOfDate: s.incomeStatement.toDate,
  });
}

// ---------------------------------------------------------------------------
// Close-entry tagging
// ---------------------------------------------------------------------------

export const CLOSE_TAG_PREFIX = "close";

export function closeTag(periodId: string, stepKey: string): string {
  return `${CLOSE_TAG_PREFIX}:${periodId}:${stepKey}`;
}

export function closeItemTag(itemKey: string): string {
  return `${CLOSE_TAG_PREFIX}-item:${itemKey}`;
}

/** Non-void entries carrying every given tag. */
export function entriesWithTags(dataset: CompanyDataset, tags: readonly string[]): JournalEntry[] {
  return dataset.journalEntries.filter((e) => e.status !== "VOID" && tags.every((t) => (e.tags ?? []).includes(t)));
}

export const AI_ASSUMPTION_LABEL = "AI-GENERATED ASSUMPTION — NOT REVIEWED";
