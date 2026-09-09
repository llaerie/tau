import { and, eq, inArray, or } from "drizzle-orm";
import type { Viewer, ViewerSpace } from "../auth/session";
import { getDb } from "../db";
import * as s from "../db/schema";
import { accountBalance, monthlyEquivalent, type LedgerTransaction } from "../finance";
import { amountFromNullable, isKnown, known, sumAmounts, unknown, type Amount, type Total } from "../finance/money";
import type { BillInput, GoalInput } from "../finance/types";
import { todayIso } from "../ids";

export interface AccountWithBalance extends s.Account {
  balance: Amount;
  balanceAsOf: string;
  transactionCount: number;
}

export interface SpaceData {
  space: ViewerSpace;
  accounts: AccountWithBalance[];
  bills: s.Bill[];
  goals: s.Goal[];
  transactions: s.Transaction[];
  categories: s.Category[];
  accountIds: Set<string>;
}

/** Load everything for one space. Callers must have checked access already. */
export function loadSpaceData(viewer: Viewer, space: ViewerSpace): SpaceData {
  const db = getDb();
  const accounts = db.select().from(s.accounts).where(eq(s.accounts.spaceId, space.id)).all();
  const ids = accounts.map((a) => a.id);
  const transactions = ids.length
    ? db
        .select()
        .from(s.transactions)
        .where(or(inArray(s.transactions.accountId, ids), inArray(s.transactions.counterAccountId, ids)))
        .orderBy(s.transactions.date)
        .all()
    : [];
  const bills = db.select().from(s.bills).where(and(eq(s.bills.spaceId, space.id), eq(s.bills.isActive, true))).all();
  const goals = db.select().from(s.goals).where(eq(s.goals.spaceId, space.id)).orderBy(s.goals.priority).all();
  const categories = db.select().from(s.categories).where(eq(s.categories.workspaceId, viewer.workspace.id)).all();
  const ledger = toLedger(transactions);
  const today = todayIso();
  const withBalances: AccountWithBalance[] = accounts.map((a) => {
    const count = ledger.filter((t) => t.accountId === a.id || t.counterAccountId === a.id).length;
    if (a.openingBalanceCents === null) {
      return { ...a, balance: unknown(`${a.name} balance not entered`), balanceAsOf: today, transactionCount: count };
    }
    const since = ledger.filter((t) => !a.openingBalanceAsOf || t.date >= a.openingBalanceAsOf);
    return { ...a, balance: known(accountBalance(a.id, a.openingBalanceCents, since, today)), balanceAsOf: today, transactionCount: count };
  });
  return { space, accounts: withBalances, bills, goals, transactions, categories, accountIds: new Set(ids) };
}

export function toLedger(rows: s.Transaction[]): LedgerTransaction[] {
  return rows.map((t) => ({
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    kind: t.kind,
    accountId: t.accountId,
    counterAccountId: t.counterAccountId,
    categoryId: t.categoryId,
    billId: t.billId,
    goalId: t.goalId,
    description: t.description,
  }));
}

/** Cash = deposit-style accounts; card balances are liabilities and reported separately. */
export function cashBalance(accounts: AccountWithBalance[]): Amount {
  const cashAccounts = accounts.filter((a) => !a.isArchived && a.type !== "credit_card");
  const t = sumAmounts(cashAccounts.map((a) => a.balance));
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}

export function cardBalance(accounts: AccountWithBalance[]): Amount {
  const cards = accounts.filter((a) => !a.isArchived && a.type === "credit_card");
  const t = sumAmounts(cards.map((a) => a.balance));
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}

export function toBillInputs(bills: s.Bill[]): BillInput[] {
  return bills.map((b) => ({ id: b.id, name: b.name, amount: amountFromNullable(b.amountCents, `${b.name} amount not entered`), cadence: b.cadence, dueDay: b.dueDay }));
}

export function toGoalInputs(goals: s.Goal[]): GoalInput[] {
  return goals.map((g) => ({
    id: g.id,
    name: g.name,
    monthlyTarget: amountFromNullable(g.monthlyTargetCents, `${g.name} monthly target not set`),
    priority: g.priority,
    targetTotalCents: g.targetTotalCents,
    savedCents: g.savedCents,
    rule: g.rule ?? undefined,
  }));
}

export function monthlyBillCents(b: s.Bill): number | null {
  if (b.amountCents === null) return null;
  const m = monthlyEquivalent(known(b.amountCents), b.cadence);
  return isKnown(m) ? m.cents : null;
}

/** Known portion of cash plus the accounts whose balance is missing. */
export function cashTotal(accounts: AccountWithBalance[]): Total {
  return sumAmounts(accounts.filter((a) => !a.isArchived && a.type !== "credit_card").map((a) => a.balance));
}
