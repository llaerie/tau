/**
 * Transaction classification and single-count flow summaries.
 *
 * Every transaction has exactly one kind. Kinds decide whether a transaction is
 * cash flow (income / spending), a movement between the household's own
 * accounts (never cash flow), or informational (payroll withholding).
 */

export type TransactionKind =
  | "income"
  | "expense"
  | "bill_payment"
  | "transfer"
  | "cc_payment"
  | "savings_allocation"
  | "payroll_withholding";

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  income: "Income",
  expense: "Expense",
  bill_payment: "Bill payment",
  transfer: "Transfer between own accounts",
  cc_payment: "Credit-card payment",
  savings_allocation: "Savings allocation",
  payroll_withholding: "Payroll withholding (informational)",
};

export const TRANSACTION_KIND_RULES: Record<TransactionKind, string> = {
  income: "Counted once as money in.",
  expense: "Counted once as spending, on the account it was charged to (cards included).",
  bill_payment: "Counted once as spending and marks the linked bill paid for the period, so the bill is not also counted as due.",
  transfer: "Money between your own accounts. Never income or spending. Counted only as a contribution when it crosses a space boundary.",
  cc_payment: "Paying a card is not spending; the charges were already counted when they happened.",
  savings_allocation: "Moving money to savings is not spending; it is tracked as goal progress.",
  payroll_withholding: "Withheld from gross pay before it reaches an account. Shown for gross-to-net only; never cash flow.",
};

export interface LedgerTransaction {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Positive magnitude in cents. */
  amountCents: number;
  kind: TransactionKind;
  /** The account money leaves (outflows, transfers) or arrives in (income). */
  accountId: string;
  /** For transfers, cc payments and savings allocations: the receiving account. */
  counterAccountId?: string | null;
  categoryId?: string | null;
  billId?: string | null;
  goalId?: string | null;
  description: string;
}

export interface FlowScope {
  /** Accounts visible in this view. */
  accountIds: Set<string>;
}

export interface FlowSummary {
  incomeCents: number;
  spendingCents: number;
  /** Transfers leaving the scope (e.g. a personal → household contribution). */
  contributionsOutCents: number;
  /** Transfers arriving into the scope. */
  contributionsInCents: number;
  /** Money moved into savings inside the scope. Not spending. */
  savingsAllocatedCents: number;
  /** Informational: withholding on gross pay. Not cash flow. */
  withholdingCents: number;
  /** Excluded movements, reported so the reader can see nothing was hidden. */
  excluded: { internalTransfersCents: number; ccPaymentsCents: number; count: number };
  netCashFlowCents: number;
  transactionCount: number;
}

export function isInPeriod(date: string, period: { from: string; to: string }): boolean {
  return date >= period.from && date <= period.to;
}

export function monthPeriod(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function summarizeFlows(txns: LedgerTransaction[], scope: FlowScope, period?: { from: string; to: string }): FlowSummary {
  const s: FlowSummary = {
    incomeCents: 0,
    spendingCents: 0,
    contributionsOutCents: 0,
    contributionsInCents: 0,
    savingsAllocatedCents: 0,
    withholdingCents: 0,
    excluded: { internalTransfersCents: 0, ccPaymentsCents: 0, count: 0 },
    netCashFlowCents: 0,
    transactionCount: 0,
  };
  const inScope = (id: string | null | undefined) => !!id && scope.accountIds.has(id);

  for (const t of txns) {
    if (period && !isInPeriod(t.date, period)) continue;
    const fromIn = inScope(t.accountId);
    const toIn = inScope(t.counterAccountId);
    switch (t.kind) {
      case "income":
        if (fromIn) {
          s.incomeCents += t.amountCents;
          s.transactionCount++;
        }
        break;
      case "expense":
      case "bill_payment":
        if (fromIn) {
          s.spendingCents += t.amountCents;
          s.transactionCount++;
        }
        break;
      case "payroll_withholding":
        if (fromIn) {
          s.withholdingCents += t.amountCents;
          s.transactionCount++;
        }
        break;
      case "transfer":
      case "cc_payment":
      case "savings_allocation": {
        if (!fromIn && !toIn) break;
        s.transactionCount++;
        if (fromIn && toIn) {
          // Movement inside the scope: never cash flow.
          if (t.kind === "cc_payment") s.excluded.ccPaymentsCents += t.amountCents;
          else s.excluded.internalTransfersCents += t.amountCents;
          s.excluded.count++;
          if (t.kind === "savings_allocation") s.savingsAllocatedCents += t.amountCents;
        } else if (fromIn) {
          s.contributionsOutCents += t.amountCents;
        } else {
          s.contributionsInCents += t.amountCents;
        }
        break;
      }
    }
  }
  s.netCashFlowCents = s.incomeCents + s.contributionsInCents - s.spendingCents - s.contributionsOutCents;
  return s;
}

export interface BillPeriodStatus {
  billId: string;
  paid: boolean;
  paidCents: number;
  /** Amount due this period (monthly equivalent when the bill is not monthly). */
  dueCents: number | null;
}

/**
 * Decide, per bill, whether it was already paid in the period. A paid bill is
 * already out of cash and must not be counted again as a commitment.
 */
export function billStatuses(
  bills: { id: string; monthlyCents: number | null }[],
  txns: LedgerTransaction[],
  period: { from: string; to: string },
): { statuses: BillPeriodStatus[]; unpaidCommittedCents: number; unknownCount: number } {
  const paidByBill = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== "bill_payment" || !t.billId || !isInPeriod(t.date, period)) continue;
    paidByBill.set(t.billId, (paidByBill.get(t.billId) ?? 0) + t.amountCents);
  }
  let unpaid = 0;
  let unknownCount = 0;
  const statuses = bills.map((b) => {
    const paidCents = paidByBill.get(b.id) ?? 0;
    const paid = paidCents > 0;
    if (!paid) {
      if (b.monthlyCents === null) unknownCount++;
      else unpaid += b.monthlyCents;
    }
    return { billId: b.id, paid, paidCents, dueCents: b.monthlyCents };
  });
  return { statuses, unpaidCommittedCents: unpaid, unknownCount };
}

/** Balance of one account from an opening balance and its transactions. */
export function accountBalance(accountId: string, openingCents: number, txns: LedgerTransaction[], asOf?: string): number {
  let bal = openingCents;
  for (const t of txns) {
    if (asOf && t.date > asOf) continue;
    switch (t.kind) {
      case "income":
        if (t.accountId === accountId) bal += t.amountCents;
        break;
      case "expense":
      case "bill_payment":
        if (t.accountId === accountId) bal -= t.amountCents;
        break;
      case "transfer":
      case "cc_payment":
      case "savings_allocation":
        if (t.accountId === accountId) bal -= t.amountCents;
        if (t.counterAccountId === accountId) bal += t.amountCents;
        break;
      case "payroll_withholding":
        break;
    }
  }
  return bal;
}
