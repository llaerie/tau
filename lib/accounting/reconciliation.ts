/**
 * Bank / card and subledger reconciliations. Read-only over a `CompanyDataset`.
 */
import Decimal from "decimal.js";
import { D, money, within } from "@/lib/core/money";
import type { Bill, CompanyDataset, DecimalString, ID, ISODate, Invoice, JournalEntry, JournalLine, Transaction } from "@/lib/core/types";
import { ACCT } from "./chart-of-accounts";
import { Ledger } from "./ledger";
import { hasPostedEffect } from "./statements";

const TOL = "0.005";

export interface UnmatchedJournalLine {
  entryId: ID;
  entryNumber: number;
  date: ISODate;
  description: string;
  line: JournalLine;
}

export interface AccountReconciliation {
  kind: "BANK" | "CARD";
  sourceAccountId: ID;
  glAccountId: ID;
  asOfDate: ISODate;
  /** GL balance in normal-balance convention (positive cash; positive card liability owed). */
  glBalance: DecimalString;
  /** Statement-side balance from transactions: cash held, or card balance owed. */
  bankBalance: DecimalString;
  unmatchedTransactions: Transaction[];
  unmatchedJournalLines: UnmatchedJournalLine[];
  difference: DecimalString;
  reconciled: boolean;
}

function reconcileSource(dataset: CompanyDataset, kind: "BANK" | "CARD", sourceAccountId: ID, glAccountId: ID, asOf: ISODate): AccountReconciliation {
  const ledger = new Ledger(dataset);
  const glBalance = D(ledger.accountBalance(glAccountId, asOf));

  const txs = dataset.transactions.filter((t) => t.sourceKind === kind && t.sourceAccountId === sourceAccountId && t.date <= asOf && !t.duplicateOfId);
  const raw = txs.reduce((acc, t) => acc.plus(D(t.amount)), new Decimal(0));
  // Card transactions are negative for charges; the balance owed is the negated sum.
  const bankBalance = kind === "CARD" ? raw.neg() : raw;

  const unmatchedTransactions = txs.filter((t) => !t.journalEntryId);
  const matchedEntryIds = new Set(txs.map((t) => t.journalEntryId).filter((id): id is ID => Boolean(id)));

  const unmatchedJournalLines: UnmatchedJournalLine[] = [];
  for (const e of dataset.journalEntries) {
    if (!hasPostedEffect(e) || e.date > asOf || matchedEntryIds.has(e.id)) continue;
    if (e.reversesEntryId && matchedEntryIds.has(e.reversesEntryId)) continue;
    for (const line of e.lines) {
      if (line.accountId === glAccountId) unmatchedJournalLines.push(lineRef(e, line));
    }
  }

  const difference = glBalance.minus(bankBalance);
  return {
    kind,
    sourceAccountId,
    glAccountId,
    asOfDate: asOf,
    glBalance: money(glBalance),
    bankBalance: money(bankBalance),
    unmatchedTransactions,
    unmatchedJournalLines,
    difference: money(difference),
    reconciled: within(difference, 0, TOL) && unmatchedTransactions.length === 0,
  };
}

const lineRef = (e: JournalEntry, line: JournalLine): UnmatchedJournalLine => ({ entryId: e.id, entryNumber: e.entryNumber, date: e.date, description: e.description, line });

export function reconcileBankAccount(dataset: CompanyDataset, bankAccountId: ID, asOf: ISODate): AccountReconciliation {
  const bank = dataset.bankAccounts.find((b) => b.id === bankAccountId);
  if (!bank) throw new Error(`Unknown bank account: ${bankAccountId}`);
  return reconcileSource(dataset, "BANK", bank.id, bank.glAccountId, asOf);
}

export function reconcileCard(dataset: CompanyDataset, cardId: ID, asOf: ISODate): AccountReconciliation {
  const card = dataset.cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`Unknown card: ${cardId}`);
  return reconcileSource(dataset, "CARD", card.id, card.glAccountId, asOf);
}

export function reconcileAllAccounts(dataset: CompanyDataset, asOf: ISODate): AccountReconciliation[] {
  return [
    ...dataset.bankAccounts.map((b) => reconcileBankAccount(dataset, b.id, asOf)),
    ...dataset.cards.map((c) => reconcileCard(dataset, c.id, asOf)),
  ];
}

// ---------------------------------------------------------------------------
// Subledgers
// ---------------------------------------------------------------------------

export interface SubledgerItem {
  id: ID;
  number: string;
  counterpartyId: ID;
  date: ISODate;
  dueDate: ISODate;
  total: DecimalString;
  amountPaid: DecimalString;
  open: DecimalString;
  status: string;
}

export interface SubledgerReconciliation {
  kind: "AR" | "AP";
  glAccountId: ID;
  asOfDate: ISODate;
  glBalance: DecimalString;
  subledgerBalance: DecimalString;
  difference: DecimalString;
  reconciled: boolean;
  openItems: SubledgerItem[];
}

const invoiceItem = (i: Invoice): SubledgerItem => ({
  id: i.id,
  number: i.number,
  counterpartyId: i.customerId,
  date: i.issueDate,
  dueDate: i.dueDate,
  total: money(i.total),
  amountPaid: money(i.amountPaid),
  open: money(D(i.total).minus(D(i.amountPaid))),
  status: i.status,
});
const billItem = (b: Bill): SubledgerItem => ({
  id: b.id,
  number: b.number,
  counterpartyId: b.vendorId,
  date: b.billDate,
  dueDate: b.dueDate,
  total: money(b.total),
  amountPaid: money(b.amountPaid),
  open: money(D(b.total).minus(D(b.amountPaid))),
  status: b.status,
});

export function arReconciliation(dataset: CompanyDataset, asOf: ISODate): SubledgerReconciliation {
  const ledger = new Ledger(dataset);
  const ar = ledger.requireAccount(ACCT.AR);
  const items = dataset.invoices
    .filter((i) => i.issueDate <= asOf && i.status !== "DRAFT" && i.status !== "VOID")
    .map(invoiceItem)
    .filter((it) => !D(it.open).isZero());
  return build("AR", ar.id, asOf, D(ledger.accountBalance(ar.id, asOf)), items);
}

export function apReconciliation(dataset: CompanyDataset, asOf: ISODate): SubledgerReconciliation {
  const ledger = new Ledger(dataset);
  const ap = ledger.requireAccount(ACCT.AP);
  const items = dataset.bills
    .filter((b) => b.billDate <= asOf && b.status !== "VOID" && b.status !== "DUPLICATE")
    .map(billItem)
    .filter((it) => !D(it.open).isZero());
  return build("AP", ap.id, asOf, D(ledger.accountBalance(ap.id, asOf)), items);
}

function build(kind: "AR" | "AP", glAccountId: ID, asOf: ISODate, gl: Decimal, items: SubledgerItem[]): SubledgerReconciliation {
  const sub = items.reduce((acc, it) => acc.plus(D(it.open)), new Decimal(0));
  const difference = gl.minus(sub);
  return {
    kind,
    glAccountId,
    asOfDate: asOf,
    glBalance: money(gl),
    subledgerBalance: money(sub),
    difference: money(difference),
    reconciled: within(difference, 0, TOL),
    openItems: items,
  };
}

export function subledgerReconciliation(dataset: CompanyDataset, asOf: ISODate): { ar: SubledgerReconciliation; ap: SubledgerReconciliation; reconciled: boolean } {
  const ar = arReconciliation(dataset, asOf);
  const ap = apReconciliation(dataset, asOf);
  return { ar, ap, reconciled: ar.reconciled && ap.reconciled };
}
