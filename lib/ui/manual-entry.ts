/**
 * Manual entry path for the company workspace (and the lab): lets the owners begin without an
 * importer. Three operations, all restricted to OWNER / FINANCE_OPERATOR and all audited:
 *
 *  - `addManualTransaction`  → a bank/card Transaction, UNCATEGORIZED (categorisation stays a
 *                              governed action in the exception queue).
 *  - `createManualJournalEntry` → a DRAFT entry via `Ledger.createEntry` (posting still goes
 *                              through the existing approval flow; nothing bypasses the ledger).
 *  - `addFinancialAccount`   → a BankAccount / Card record (last4 only, never full numbers) and
 *                              the matching finance-bible field marked CONFIRMED.
 */
import type { LabRuntime } from "@/lib/db/runtime";
import type { Actor, BankAccount, Card, ConfigField, JournalEntry, Role, Transaction } from "@/lib/core/types";
import type { NewJournalLineInput } from "@/lib/core/contracts";
import { PermissionDeniedError, TauError } from "@/lib/core/errors";
import { isValidISODate, nowISO } from "@/lib/core/dates";
import { newId } from "@/lib/core/ids";
import { D, money } from "@/lib/core/money";
import { defaultGlAccountIdFor, eligibleGlAccountsFor } from "@/lib/db/workspace";
import { answerConfig } from "./config";

export const MANUAL_ENTRY_ROLES: readonly Role[] = Object.freeze(["OWNER", "FINANCE_OPERATOR"]);
export const BANK_ACCOUNTS_BIBLE_KEY = "bank_accounts.accounts";
export const CARDS_BIBLE_KEY = "cards.cards";

export function canEnterManually(actor: Pick<Actor, "role">): boolean {
  return MANUAL_ENTRY_ROLES.includes(actor.role);
}

export function requireManualEntryRole(actor: Actor): void {
  if (!canEnterManually(actor)) throw new PermissionDeniedError(`${actor.role} (${actor.id}) may not enter data manually; OWNER or FINANCE_OPERATOR required`, { actorId: actor.id, role: actor.role });
}

function requireText(v: unknown, field: string, max = 240): string {
  if (typeof v !== "string" || !v.trim()) throw new TauError("BAD_REQUEST", `${field} is required`);
  return v.trim().slice(0, max);
}

function requireDate(v: unknown, field: string): string {
  if (typeof v !== "string" || !isValidISODate(v)) throw new TauError("BAD_REQUEST", `${field} must be a valid YYYY-MM-DD date`);
  return v;
}

function parseAmount(v: unknown, field: string): string {
  if (v === null || v === undefined || v === "") throw new TauError("BAD_REQUEST", `${field} is required`);
  try {
    return money(v as string | number);
  } catch {
    throw new TauError("BAD_REQUEST", `${field} must be a decimal amount`);
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface AddTransactionInput {
  sourceAccountId: string;
  date: string;
  postedDate?: string;
  /** Signed: negative = money leaving the account / charge on the card. */
  amount: string | number;
  description: string;
}

export async function addManualTransaction(rt: LabRuntime, actor: Actor, input: AddTransactionInput): Promise<Transaction> {
  requireManualEntryRole(actor);
  const sourceId = requireText(input.sourceAccountId, "sourceAccountId");
  const bank = rt.dataset.bankAccounts.find((b) => b.id === sourceId);
  const card = bank ? undefined : rt.dataset.cards.find((c) => c.id === sourceId);
  if (!bank && !card) throw new TauError("NOT_FOUND", `No bank account or card with id ${sourceId}; add it on Company setup first`);
  const date = requireDate(input.date, "date");
  const postedDate = input.postedDate ? requireDate(input.postedDate, "postedDate") : date;
  const amount = parseAmount(input.amount, "amount");
  if (D(amount).isZero()) throw new TauError("BAD_REQUEST", "amount must be non-zero (negative = money out / card charge)");
  const description = requireText(input.description, "description");
  const id = newId("tx");
  const now = nowISO();
  const tx: Transaction = {
    id,
    sourceKind: bank ? "BANK" : "CARD",
    sourceAccountId: sourceId,
    externalId: `manual:${id}`,
    date,
    postedDate,
    amount,
    currency: (bank ?? card)!.currency,
    descriptionRaw: description,
    category: { accountId: null, status: "UNCATEGORIZED", confidence: 0, reason: "Entered manually; awaiting categorisation" },
    documentIds: [],
    flags: ["UNCATEGORIZED"],
    importBatchId: `manual:${actor.id}:${date}`,
    meta: { enteredManually: true, enteredBy: actor.id, enteredAt: now },
  };
  await rt.store.upsert("transactions", tx);
  if (!rt.dataset.transactions.some((t) => t.id === tx.id)) rt.dataset.transactions.push(tx);
  await rt.audit.record({
    actor,
    workflowVersion: "console:manual-entry:v1",
    eventType: "TRANSACTION_ENTERED_MANUALLY",
    explanation: `Manual ${tx.sourceKind.toLowerCase()} transaction ${tx.id} entered for ${(bank ?? card)!.name} ····${(bank ?? card)!.last4} on ${date}; amount ${amount} ${tx.currency}; UNCATEGORIZED until reviewed.`,
    afterState: { transactionId: tx.id, sourceAccountId: sourceId, date, amount, categoryStatus: "UNCATEGORIZED" },
  });
  await rt.flush();
  return tx;
}

// ---------------------------------------------------------------------------
// Journal entries (DRAFT only)
// ---------------------------------------------------------------------------

export interface ManualJournalLineInput {
  accountCode: string;
  debit?: string | number;
  credit?: string | number;
  memo?: string;
}

export interface ManualJournalEntryInput {
  date: string;
  description: string;
  memo?: string;
  lines: ManualJournalLineInput[];
}

export async function createManualJournalEntry(rt: LabRuntime, actor: Actor, input: ManualJournalEntryInput): Promise<JournalEntry> {
  requireManualEntryRole(actor);
  const date = requireDate(input.date, "date");
  const description = requireText(input.description, "description");
  const memo = typeof input.memo === "string" && input.memo.trim() ? input.memo.trim().slice(0, 500) : undefined;
  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new TauError("BAD_REQUEST", "A journal entry needs at least two lines");
  const lines: NewJournalLineInput[] = input.lines.map((l, i) => {
    const code = requireText(l.accountCode, `lines[${i}].accountCode`, 16);
    const account = rt.dataset.accounts.find((a) => a.code === code || a.id === code);
    if (!account) throw new TauError("NOT_FOUND", `lines[${i}]: no account with code ${code}`);
    if (!account.isActive) throw new TauError("BAD_REQUEST", `lines[${i}]: account ${code} is inactive`);
    const debit = l.debit === undefined || l.debit === "" || l.debit === null ? "0.0000" : parseAmount(l.debit, `lines[${i}].debit`);
    const credit = l.credit === undefined || l.credit === "" || l.credit === null ? "0.0000" : parseAmount(l.credit, `lines[${i}].credit`);
    if (D(debit).isNegative() || D(credit).isNegative()) throw new TauError("BAD_REQUEST", `lines[${i}]: debit and credit must be non-negative`);
    if (D(debit).isZero() === D(credit).isZero()) throw new TauError("BAD_REQUEST", `lines[${i}]: exactly one of debit or credit must be non-zero`);
    return { accountCode: account.code, debit, credit, memo: typeof l.memo === "string" && l.memo.trim() ? l.memo.trim().slice(0, 240) : undefined };
  });
  // Ledger.createEntry validates balance, period status and account existence; result is a DRAFT.
  const entry = rt.ledger.createEntry({ date, description, memo, source: "MANUAL", lines, tags: ["manual-entry"] }, actor);
  await rt.audit.record({
    actor,
    workflowVersion: "console:manual-entry:v1",
    eventType: "JOURNAL_ENTRY_DRAFTED_MANUALLY",
    explanation: `Manual DRAFT journal entry #${entry.entryNumber} (${entry.id}) created for ${date}: ${description}. Posting requires the governed POST_JOURNAL_ENTRY action.`,
    afterState: { entryId: entry.id, entryNumber: entry.entryNumber, status: entry.status, lines: entry.lines.length },
  });
  await rt.flush();
  return entry;
}

// ---------------------------------------------------------------------------
// Bank accounts & cards
// ---------------------------------------------------------------------------

export interface AddFinancialAccountInput {
  kind: "BANK" | "CARD";
  name: string;
  /** Bank name or card issuer. */
  institution: string;
  accountType?: "CHECKING" | "SAVINGS" | "MONEY_MARKET";
  /** Last four digits only. Full account or card numbers are never accepted. */
  last4: string;
  currency?: string;
  glAccountId?: string;
  openedDate?: string;
  statementCloseDay?: number;
  paymentDueDay?: number;
}

export interface AddFinancialAccountResult {
  account: BankAccount | Card;
  configField: ConfigField;
}

function accountSummary(rt: LabRuntime, kind: "BANK" | "CARD") {
  const code = (id: string) => rt.dataset.accounts.find((a) => a.id === id)?.code ?? id;
  return kind === "BANK"
    ? rt.dataset.bankAccounts.filter((b) => !b.isSynthetic).map((b) => ({ id: b.id, institution: b.institution, type: b.accountType, last4: b.last4, currency: b.currency, glAccountCode: code(b.glAccountId) }))
    : rt.dataset.cards.filter((c) => !c.isSynthetic).map((c) => ({ id: c.id, issuer: c.issuer, last4: c.last4, currency: c.currency, glAccountCode: code(c.glAccountId) }));
}

export async function addFinancialAccount(rt: LabRuntime, actor: Actor, input: AddFinancialAccountInput): Promise<AddFinancialAccountResult> {
  requireManualEntryRole(actor);
  const kind = input.kind === "CARD" ? "CARD" : input.kind === "BANK" ? "BANK" : null;
  if (!kind) throw new TauError("BAD_REQUEST", 'kind must be "BANK" or "CARD"');
  const name = requireText(input.name, "name", 80);
  const institution = requireText(input.institution, "institution", 80);
  const last4 = typeof input.last4 === "string" ? input.last4.trim() : "";
  if (!/^\d{4}$/.test(last4)) throw new TauError("BAD_REQUEST", "last4 must be exactly four digits (never enter a full account or card number)");
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency.trim().toUpperCase()) ? input.currency.trim().toUpperCase() : "USD";
  const accountType = input.accountType === "SAVINGS" || input.accountType === "MONEY_MARKET" ? input.accountType : "CHECKING";
  const eligible = eligibleGlAccountsFor(rt.dataset, kind);
  // One GL account per registered bank account / card, otherwise balances would be double-counted.
  const mapped = new Set([...rt.dataset.bankAccounts.map((b) => b.glAccountId), ...rt.dataset.cards.map((c) => c.glAccountId)]);
  const free = eligible.filter((a) => !mapped.has(a.id));
  let gl: (typeof eligible)[number] | undefined;
  if (typeof input.glAccountId === "string" && input.glAccountId) {
    gl = eligible.find((a) => a.id === input.glAccountId || a.code === input.glAccountId);
    if (!gl) throw new TauError("BAD_REQUEST", `glAccountId must be one of the ${kind === "BANK" ? "cash" : "credit-card"} accounts: ${eligible.map((a) => a.code).join(", ")}`);
    if (mapped.has(gl.id)) throw new TauError("INVALID_STATE", `GL account ${gl.code} ${gl.name} is already mapped to another registered account; each bank account / card needs its own GL account${free.length ? ` (free: ${free.map((a) => a.code).join(", ")})` : " — ask the CPA to extend the chart of accounts first"}`);
  } else {
    const preferred = defaultGlAccountIdFor(kind, accountType);
    gl = free.find((a) => a.id === preferred) ?? free[0];
    if (!gl) throw new TauError("INVALID_STATE", `Every ${kind === "BANK" ? "cash" : "credit-card"} GL account (${eligible.map((a) => a.code).join(", ")}) is already mapped to a registered account; ask the CPA to extend the chart of accounts before adding another`);
  }
  const duplicate = kind === "BANK" ? rt.dataset.bankAccounts.find((b) => b.last4 === last4 && b.institution.toLowerCase() === institution.toLowerCase()) : rt.dataset.cards.find((c) => c.last4 === last4 && c.issuer.toLowerCase() === institution.toLowerCase());
  if (duplicate) throw new TauError("INVALID_STATE", `${institution} ····${last4} already exists (${duplicate.id})`);

  let account: BankAccount | Card;
  if (kind === "BANK") {
    const bank: BankAccount = { id: newId("bank"), name, institution, accountType, last4, currency, glAccountId: gl.id, isSynthetic: false, openedDate: input.openedDate && isValidISODate(input.openedDate) ? input.openedDate : undefined };
    await rt.store.upsert("bankAccounts", bank);
    if (!rt.dataset.bankAccounts.some((b) => b.id === bank.id)) rt.dataset.bankAccounts.push(bank);
    account = bank;
  } else {
    const day = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31 ? v : undefined);
    const card: Card = { id: newId("card"), name, issuer: institution, last4, currency, glAccountId: gl.id, isSynthetic: false, statementCloseDay: day(input.statementCloseDay), paymentDueDay: day(input.paymentDueDay) };
    await rt.store.upsert("cards", card);
    if (!rt.dataset.cards.some((c) => c.id === card.id)) rt.dataset.cards.push(card);
    account = card;
  }
  await rt.audit.record({
    actor,
    workflowVersion: "console:manual-entry:v1",
    eventType: kind === "BANK" ? "BANK_ACCOUNT_ADDED" : "CARD_ADDED",
    explanation: `${kind === "BANK" ? "Bank account" : "Card"} ${account.id} (${institution} ····${last4}) registered by ${actor.role}; mapped to GL ${gl.code} ${gl.name}. Only the last four digits are stored. No connection to the institution exists.`,
    afterState: { accountId: account.id, kind, institution, last4, glAccountCode: gl.code },
  });
  // The bible field is now a confirmed fact: the list of registered accounts (institution, type, last4 — never full numbers).
  const configField = await answerConfig(rt, actor, {
    key: kind === "BANK" ? BANK_ACCOUNTS_BIBLE_KEY : CARDS_BIBLE_KEY,
    value: accountSummary(rt, kind),
    status: "CONFIRMED",
    note: `Confirmed from the ${kind === "BANK" ? "bank accounts" : "cards"} registered in the console (last4 only; no live connection).`,
    eventType: kind === "BANK" ? "CONFIG_BANK_ACCOUNTS_CONFIRMED" : "CONFIG_CARDS_CONFIRMED",
  });
  return { account, configField };
}
