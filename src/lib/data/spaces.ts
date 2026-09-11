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
  /** Bills that belong to this space (whoever pays them). */
  bills: s.Bill[];
  /** Bills from other spaces this space's accounts pay (e.g. household rent paid by the company). */
  billsPaidForOthers: s.Bill[];
  /** Payments for this space's bills, wherever the paying account lives. */
  billPayments: s.Transaction[];
  goals: s.Goal[];
  budgets: s.Budget[];
  transactions: s.Transaction[];
  categories: s.Category[];
  accountIds: Set<string>;
  /** Expense shares for the person of a personal space (their part of each food/shared expense). */
  shares: s.ExpenseShare[];
}

/** Load everything for one space. Callers must have checked access already: this reads only that space's records. */
export function loadSpaceData(viewer: Viewer, space: ViewerSpace): SpaceData {
  const db = getDb();
  const accounts = db.select().from(s.accounts).where(eq(s.accounts.spaceId, space.id)).all();
  const ids = accounts.map((a) => a.id);
  const transactions = ids.length
    ? db.select().from(s.transactions).where(or(inArray(s.transactions.accountId, ids), inArray(s.transactions.counterAccountId, ids))).orderBy(s.transactions.date).all()
    : [];
  const bills = db.select().from(s.bills).where(and(eq(s.bills.spaceId, space.id), eq(s.bills.isActive, true))).all();
  const billsPaidForOthers = db.select().from(s.bills).where(and(eq(s.bills.payerSpaceId, space.id), eq(s.bills.isActive, true))).all();
  const billIds = bills.map((b) => b.id);
  const billPayments = billIds.length ? db.select().from(s.transactions).where(and(inArray(s.transactions.billId, billIds), eq(s.transactions.kind, "bill_payment"))).all() : [];
  const goals = db.select().from(s.goals).where(eq(s.goals.spaceId, space.id)).orderBy(s.goals.priority).all().filter((g) => !g.archivedAt);
  const budgets = db.select().from(s.budgets).where(eq(s.budgets.spaceId, space.id)).orderBy(s.budgets.sortOrder).all().filter((b) => !b.archivedAt);
  const categories = db.select().from(s.categories).where(eq(s.categories.workspaceId, viewer.workspace.id)).all();
  const shares = space.kind === "personal" && space.personId ? db.select().from(s.expenseShares).where(eq(s.expenseShares.personId, space.personId)).all() : [];
  const ledger = toLedger(transactions);
  const today = todayIso();
  const withBalances: AccountWithBalance[] = accounts.map((a) => {
    const count = ledger.filter((t) => t.accountId === a.id || t.counterAccountId === a.id).length;
    if (a.openingBalanceCents === null) return { ...a, balance: unknown(`${a.name} balance not entered`), balanceAsOf: today, transactionCount: count };
    const since = ledger.filter((t) => !a.openingBalanceAsOf || t.date >= a.openingBalanceAsOf);
    return { ...a, balance: known(accountBalance(a.id, a.openingBalanceCents, since, today)), balanceAsOf: today, transactionCount: count };
  });
  return { space, accounts: withBalances, bills, billsPaidForOthers, billPayments, goals, budgets, transactions, categories, accountIds: new Set(ids), shares };
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
    treatment: t.treatment,
    economicEventId: t.economicEventId,
    voidedAt: t.voidedAt,
  }));
}

/** Cash = deposit-style accounts; card balances are liabilities and reported separately. */
export function cashBalance(accounts: AccountWithBalance[]): Amount {
  const t = cashTotal(accounts);
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}

/** No cash accounts recorded is "unknown", never $0. */
export function cashTotal(accounts: AccountWithBalance[]): Total {
  const cash = accounts.filter((a) => !a.isArchived && a.type !== "credit_card");
  if (cash.length === 0) return sumAmounts([unknown("No cash account recorded yet")]);
  return sumAmounts(cash.map((a) => a.balance));
}

export function cardBalance(accounts: AccountWithBalance[]): Amount {
  const t = sumAmounts(accounts.filter((a) => !a.isArchived && a.type === "credit_card").map((a) => a.balance));
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}

export function toBillInputs(bills: s.Bill[]): BillInput[] {
  return bills.map((b) => ({ id: b.id, name: b.name, amount: amountFromNullable(b.amountCents, `${b.name} amount not entered`), cadence: b.cadence, dueDay: b.dueDay }));
}

export function toGoalInputs(goals: s.Goal[]): GoalInput[] {
  return goals.map((g) => ({ id: g.id, name: g.name, monthlyTarget: amountFromNullable(g.monthlyTargetCents, `${g.name} monthly target not set`), priority: g.priority, targetTotalCents: g.targetTotalCents, savedCents: g.savedCents, rule: g.rule ?? undefined }));
}

export function monthlyBillCents(b: s.Bill): number | null {
  if (b.amountCents === null) return null;
  const m = monthlyEquivalent(known(b.amountCents), b.cadence);
  return isKnown(m) ? m.cents : null;
}

export function loadSubscriptions(workspaceId: string): s.Subscription[] {
  return getDb().select().from(s.subscriptions).where(eq(s.subscriptions.workspaceId, workspaceId)).all();
}

export function loadPurchasePlans(workspaceId: string): s.PurchasePlan[] {
  return getDb().select().from(s.purchasePlans).where(eq(s.purchasePlans.workspaceId, workspaceId)).all();
}

export function loadPreferences(userId: string): s.UserPreferences {
  const row = getDb().select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)).get();
  return row ?? { userId, theme: "system", spokenReplies: false, sharePersonalSummary: true, updatedAt: "" };
}

/** Sum of a person's food shares in a period, plus own-account food expenses that were never split (imports). */
export function foodSpentCents(data: SpaceData, period: { from: string; to: string }): { cents: number; count: number } {
  const foodCategoryIds = new Set(data.categories.filter((c) => c.group === "food").map((c) => c.id));
  const sharedTxnIds = new Set(data.shares.map((sh) => sh.transactionId));
  let cents = 0;
  let count = 0;
  for (const sh of data.shares) {
    if (sh.date < period.from || sh.date > period.to) continue;
    if (sh.categoryId && !foodCategoryIds.has(sh.categoryId)) continue;
    cents += sh.cents;
    count++;
  }
  for (const t of data.transactions) {
    if (t.voidedAt || sharedTxnIds.has(t.id)) continue;
    if (t.kind !== "expense" && t.kind !== "bill_payment") continue;
    if (!data.accountIds.has(t.accountId) || !t.categoryId || !foodCategoryIds.has(t.categoryId)) continue;
    if (t.date < period.from || t.date > period.to) continue;
    cents += t.amountCents;
    count++;
  }
  return { cents, count };
}
