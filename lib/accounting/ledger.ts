/**
 * Double-entry ledger engine operating on a `CompanyDataset` in place.
 *
 * Invariants enforced here (nothing may bypass this class):
 *  - every entry balances (debits == credits at 4 dp) or `UnbalancedEntryError` is thrown;
 *  - nothing is created or posted into a LOCKED period (`PeriodLockedError`), and only
 *    adjusting-type sources may enter a SOFT_CLOSED period;
 *  - POSTED entries are immutable: they can be reversed (a mirror entry), never edited or deleted.
 */
import { nowISO } from "@/lib/core/dates";
import { ApprovalRequiredError, ControlViolationError, PeriodLockedError, TauError, UnbalancedEntryError } from "@/lib/core/errors";
import { newId } from "@/lib/core/ids";
import { D, eq, isNeg, isZero, money } from "@/lib/core/money";
import type {
  BalanceSheet,
  CashFlowStatement,
  Entity,
  IncomeStatement,
  IntegrityReport,
  LedgerEngine,
  NewJournalEntryInput,
  NewJournalLineInput,
  TrialBalance,
} from "@/lib/core/contracts";
import type {
  Account,
  Actor,
  CollectionName,
  CompanyDataset,
  DecimalString,
  ID,
  ISODate,
  JournalEntry,
  JournalLine,
  JournalSource,
  Period,
} from "@/lib/core/types";
import { ACCT } from "./chart-of-accounts";
import { runIntegrityChecks } from "./integrity";
import { assertWritable, ensurePeriod, findPeriod, findPeriodById, lockTagAt, periodTag, unlockTagAt } from "./periods";
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  buildTrialBalance,
  hasPostedEffect,
  movements,
  movementOf,
  signedBalance,
} from "./statements";

export type PersistCallback = <K extends CollectionName>(collection: K, entity: Entity<K>) => void;

export interface ReverseOptions {
  /** Defaults to REVERSAL. CORRECTING is used for prior-period corrections. */
  source?: Extract<JournalSource, "REVERSAL" | "CORRECTING">;
  tags?: string[];
  /** Deterministic id for the reversal entry. */
  id?: ID;
  description?: string;
}

const VOIDABLE = new Set<JournalEntry["status"]>(["DRAFT", "PENDING_APPROVAL"]);

export class Ledger implements LedgerEngine {
  readonly dataset: CompanyDataset;
  private readonly onPersist?: PersistCallback;
  private accountsById = new Map<ID, Account>();
  private accountsByCode = new Map<string, Account>();
  private indexedLength = -1;
  private indexedRef: readonly Account[] | null = null;

  constructor(dataset: CompanyDataset, onPersist?: PersistCallback) {
    this.dataset = dataset;
    this.onPersist = onPersist;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  private ensureIndex(): void {
    const accts = this.dataset.accounts;
    if (this.indexedRef === accts && this.indexedLength === accts.length) return;
    this.accountsById = new Map(accts.map((a) => [a.id, a]));
    this.accountsByCode = new Map(accts.map((a) => [a.code, a]));
    this.indexedRef = accts;
    this.indexedLength = accts.length;
  }

  getAccount(idOrCode: string): Account | undefined {
    this.ensureIndex();
    return this.accountsById.get(idOrCode) ?? this.accountsByCode.get(idOrCode);
  }

  requireAccount(idOrCode: string): Account {
    const a = this.getAccount(idOrCode);
    if (!a) throw new TauError("ACCOUNT_NOT_FOUND", `Unknown account: ${idOrCode}`, { idOrCode });
    return a;
  }

  // ---------------------------------------------------------------------------
  // Periods
  // ---------------------------------------------------------------------------

  getPeriod(date: ISODate): Period {
    const p = findPeriod(this.dataset, date);
    if (!p) throw new TauError("PERIOD_NOT_FOUND", `No period exists for ${date}`, { date });
    return p;
  }

  ensurePeriod(date: ISODate): Period {
    return ensurePeriod(this.dataset, date, (p) => this.persist("periods", p));
  }

  requirePeriodById(periodId: ID): Period {
    const p = findPeriodById(this.dataset, periodId);
    if (!p) throw new TauError("PERIOD_NOT_FOUND", `No period with id ${periodId}`, { periodId });
    return p;
  }

  softClosePeriod(periodId: ID, actor: Actor): Period {
    const p = this.requirePeriodById(periodId);
    if (p.status === "LOCKED") throw new PeriodLockedError(`Period ${periodId} is LOCKED; unlock it before changing its status`, { periodId });
    p.status = "SOFT_CLOSED";
    periodTag(p, `soft-closed:${nowISO()}:${actor.id}`);
    this.persist("periods", p);
    return p;
  }

  lockPeriod(periodId: ID, actor: Actor, approvalId: ID): Period {
    if (!approvalId) throw new ApprovalRequiredError(`Locking period ${periodId} requires an approval`, { periodId });
    this.assertApprovalUsable(approvalId, "LOCK_PERIOD");
    const p = this.requirePeriodById(periodId);
    if (p.status === "LOCKED") return p;

    const suspense = this.suspenseBalance(p.endDate);
    if (!isZero(suspense)) {
      throw new ControlViolationError(`Cannot lock ${periodId}: suspense account ${ACCT.SUSPENSE} balance is ${suspense}, must be zero`, {
        periodId,
        suspense,
      });
    }
    const report = runIntegrityChecks(this, p.endDate);
    const errors = report.checks.filter((c) => !c.passed && c.severity === "ERROR");
    if (errors.length) {
      throw new ControlViolationError(`Cannot lock ${periodId}: integrity errors: ${errors.map((e) => e.key).join(", ")}`, {
        periodId,
        checks: errors,
      });
    }
    const at = nowISO();
    p.status = "LOCKED";
    p.lockedAt = at;
    p.lockedBy = actor.id;
    p.lockApprovalId = approvalId;
    periodTag(p, lockTagAt(actor.id, approvalId, at));
    this.persist("periods", p);
    return p;
  }

  unlockPeriod(periodId: ID, actor: Actor, approvalId: ID, reason: string): Period {
    if (!approvalId) throw new ApprovalRequiredError(`Unlocking period ${periodId} requires an approval`, { periodId });
    if (!reason || !reason.trim()) throw new ControlViolationError(`Unlocking period ${periodId} requires a reason`, { periodId });
    this.assertApprovalUsable(approvalId, "UNLOCK_PERIOD");
    const p = this.requirePeriodById(periodId);
    if (p.status !== "LOCKED") throw new ControlViolationError(`Period ${periodId} is not LOCKED (status ${p.status})`, { periodId });
    p.status = "OPEN";
    periodTag(p, unlockTagAt(actor.id, approvalId, reason.trim()));
    delete p.lockedAt;
    delete p.lockedBy;
    delete p.lockApprovalId;
    this.persist("periods", p);
    return p;
  }

  /** If the approval is known to the dataset it must be APPROVED; unknown ids are accepted (the approval engine owns them). */
  private assertApprovalUsable(approvalId: ID, what: string): void {
    const approval = this.dataset.approvals.find((a) => a.id === approvalId);
    if (approval && approval.status !== "APPROVED") {
      throw new ApprovalRequiredError(`${what} requires an APPROVED approval; ${approvalId} is ${approval.status}`, { approvalId });
    }
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  getEntry(entryId: ID): JournalEntry | undefined {
    return this.dataset.journalEntries.find((e) => e.id === entryId);
  }

  requireEntry(entryId: ID): JournalEntry {
    const e = this.getEntry(entryId);
    if (!e) throw new TauError("ENTRY_NOT_FOUND", `Unknown journal entry: ${entryId}`, { entryId });
    return e;
  }

  /** Entries that affect balances (POSTED, plus REVERSED originals which their reversal offsets). */
  postedEntries(): JournalEntry[] {
    return this.dataset.journalEntries.filter(hasPostedEffect);
  }

  entriesInPeriod(periodId: ID): JournalEntry[] {
    return this.dataset.journalEntries.filter((e) => e.periodId === periodId);
  }

  nextEntryNumber(): number {
    let max = 0;
    for (const e of this.dataset.journalEntries) if (e.entryNumber > max) max = e.entryNumber;
    return max + 1;
  }

  createEntry(input: NewJournalEntryInput, actor: Actor): JournalEntry {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new TauError("INVALID_DATE", `Invalid entry date: ${input.date}`);
    if (!input.description || !input.description.trim()) throw new TauError("INVALID_ENTRY", "Journal entry requires a description");
    if (input.id && this.getEntry(input.id)) throw new TauError("DUPLICATE_ENTRY", `Journal entry ${input.id} already exists`, { id: input.id });

    const id = input.id ?? newId("je");
    const { lines, restricted } = this.normalizeLines(input.lines, id);
    this.assertBalanced(lines, id);

    const period = this.ensurePeriod(input.date);
    assertWritable(period, input.source, "create entry");

    const tags = [...new Set([...(input.tags ?? []), ...(restricted ? ["restricted-account"] : [])])];
    const now = nowISO();
    const entry: JournalEntry = {
      id,
      entryNumber: this.nextEntryNumber(),
      date: input.date,
      periodId: period.id,
      description: input.description.trim(),
      memo: input.memo,
      status: "DRAFT",
      source: input.source,
      lines,
      sourceIds: [...(input.sourceIds ?? [])],
      createdBy: actor.id,
      createdAt: now,
      approvalId: input.approvalId,
      tags,
    };
    if (input.post) {
      entry.status = "POSTED";
      entry.postedAt = now;
    }
    this.dataset.journalEntries.push(entry);
    this.persist("journalEntries", entry);
    return entry;
  }

  postEntry(entryId: ID, actor: Actor, approvalId?: ID): JournalEntry {
    const entry = this.requireEntry(entryId);
    if (!VOIDABLE.has(entry.status)) {
      throw new ControlViolationError(`Entry ${entryId} cannot be posted from status ${entry.status}`, { entryId, status: entry.status });
    }
    // Re-validate: the draft may have been created before an account was deactivated or a period closed.
    this.assertBalanced(entry.lines, entryId);
    for (const l of entry.lines) this.requireActiveAccount(l.accountId);
    const period = this.ensurePeriod(entry.date);
    assertWritable(period, entry.source, "post entry");
    if (entry.periodId !== period.id) entry.periodId = period.id;
    entry.status = "POSTED";
    entry.postedAt = nowISO();
    if (approvalId) entry.approvalId = approvalId;
    entry.tags = [...new Set([...(entry.tags ?? []), `posted-by:${actor.id}`])];
    this.persist("journalEntries", entry);
    return entry;
  }

  reverseEntry(entryId: ID, reversalDate: ISODate, actor: Actor, reason: string, approvalId?: ID, opts: ReverseOptions = {}): JournalEntry {
    const original = this.requireEntry(entryId);
    if (original.status !== "POSTED") {
      throw new ControlViolationError(`Only POSTED entries can be reversed; ${entryId} is ${original.status}`, { entryId, status: original.status });
    }
    if (!reason || !reason.trim()) throw new ControlViolationError("Reversal requires a reason", { entryId });
    const source = opts.source ?? "REVERSAL";
    const period = this.ensurePeriod(reversalDate);
    assertWritable(period, source, "reverse entry");

    const reversal = this.createEntry(
      {
        id: opts.id,
        date: reversalDate,
        description: opts.description ?? `Reversal of #${original.entryNumber} (${original.description}): ${reason.trim()}`,
        memo: reason.trim(),
        source,
        lines: original.lines.map<NewJournalLineInput>((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          memo: l.memo,
          entityRef: l.entityRef,
        })),
        sourceIds: [original.id, ...original.sourceIds],
        tags: [...new Set(["reversal", ...(opts.tags ?? []), ...(original.tags ?? []).filter((t) => t === "restricted-account")])],
        post: true,
        approvalId,
      },
      actor,
    );
    reversal.reversesEntryId = original.id;
    original.reversedByEntryId = reversal.id;
    original.status = "REVERSED";
    this.persist("journalEntries", reversal);
    this.persist("journalEntries", original);
    return reversal;
  }

  voidDraft(entryId: ID, actor: Actor): JournalEntry {
    const entry = this.requireEntry(entryId);
    if (!VOIDABLE.has(entry.status)) {
      throw new ControlViolationError(`Only DRAFT or PENDING_APPROVAL entries may be voided; ${entryId} is ${entry.status}. Posted entries can only be reversed.`, {
        entryId,
        status: entry.status,
      });
    }
    entry.status = "VOID";
    entry.tags = [...new Set([...(entry.tags ?? []), `voided-by:${actor.id}`, `voided-at:${nowISO()}`])];
    this.persist("journalEntries", entry);
    return entry;
  }

  // ---------------------------------------------------------------------------
  // Balances & statements
  // ---------------------------------------------------------------------------

  accountBalance(accountId: ID, asOf: ISODate, from?: ISODate): DecimalString {
    const account = this.requireAccount(accountId);
    const map = movements(this.dataset.journalEntries, { from, to: asOf });
    return money(signedBalance(account, movementOf(map, account.id)));
  }

  suspenseBalance(asOf: ISODate): DecimalString {
    const s = this.getAccount(ACCT.SUSPENSE);
    if (!s) return money(0);
    return this.accountBalance(s.id, asOf);
  }

  trialBalance(asOf: ISODate, from?: ISODate): TrialBalance {
    return buildTrialBalance(this.dataset.accounts, this.dataset.journalEntries, asOf, from);
  }

  incomeStatement(from: ISODate, to: ISODate): IncomeStatement {
    return buildIncomeStatement(this.dataset.accounts, this.dataset.journalEntries, from, to);
  }

  balanceSheet(asOf: ISODate): BalanceSheet {
    return buildBalanceSheet(this.dataset.accounts, this.dataset.journalEntries, asOf);
  }

  cashFlowStatement(from: ISODate, to: ISODate): CashFlowStatement {
    return buildCashFlowStatement(this.dataset.accounts, this.dataset.journalEntries, from, to);
  }

  runIntegrityChecks(asOf: ISODate): IntegrityReport {
    return runIntegrityChecks(this, asOf);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private persist<K extends CollectionName>(collection: K, entity: Entity<K>): void {
    this.onPersist?.(collection, entity);
  }

  private requireActiveAccount(idOrCode: string): Account {
    const a = this.requireAccount(idOrCode);
    if (!a.isActive) throw new TauError("INACTIVE_ACCOUNT", `Account ${a.code} ${a.name} is inactive`, { accountId: a.id });
    return a;
  }

  private normalizeLines(inputs: NewJournalLineInput[], entryId: ID): { lines: JournalLine[]; restricted: boolean } {
    if (!Array.isArray(inputs) || inputs.length < 2) {
      throw new UnbalancedEntryError("A journal entry requires at least two lines", { entryId, lineCount: inputs?.length ?? 0 });
    }
    const currency = this.dataset.profile.functionalCurrency;
    let restricted = false;
    const lines = inputs.map<JournalLine>((l, i) => {
      const ref = l.accountId ?? l.accountCode;
      if (!ref) throw new TauError("INVALID_LINE", `Line ${i + 1} has neither accountId nor accountCode`, { entryId, line: i });
      const account = this.requireActiveAccount(ref);
      if (account.restricted) restricted = true;
      const debit = money(l.debit ?? 0);
      const credit = money(l.credit ?? 0);
      if (isNeg(debit) || isNeg(credit)) {
        throw new TauError("INVALID_LINE", `Line ${i + 1} (${account.code}) has a negative amount`, { entryId, line: i, debit, credit });
      }
      const hasDebit = !isZero(debit);
      const hasCredit = !isZero(credit);
      if (hasDebit === hasCredit) {
        throw new TauError("INVALID_LINE", `Line ${i + 1} (${account.code}) must have exactly one of debit or credit greater than zero`, {
          entryId,
          line: i,
          debit,
          credit,
        });
      }
      return {
        id: `${entryId}_l${i + 1}`,
        accountId: account.id,
        debit,
        credit,
        currency,
        memo: l.memo,
        entityRef: l.entityRef,
      };
    });
    const currencies = new Set(lines.map((l) => l.currency));
    if (currencies.size > 1) throw new TauError("MIXED_CURRENCY", "All lines of an entry must share one currency", { entryId, currencies: [...currencies] });
    return { lines, restricted };
  }

  private assertBalanced(lines: readonly JournalLine[], entryId: ID): void {
    const debits = lines.reduce((acc, l) => acc.plus(D(l.debit)), D(0));
    const credits = lines.reduce((acc, l) => acc.plus(D(l.credit)), D(0));
    if (!eq(money(debits), money(credits))) {
      throw new UnbalancedEntryError(`Entry ${entryId} does not balance: debits ${money(debits)} != credits ${money(credits)}`, {
        entryId,
        debits: money(debits),
        credits: money(credits),
        difference: money(debits.minus(credits)),
      });
    }
  }
}

export { entryBalances } from "./statements";
