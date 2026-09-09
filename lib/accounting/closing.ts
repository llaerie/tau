/**
 * Year-end close and prior-period corrections.
 *
 * `buildClosingEntries` and `buildCorrectingEntry` are pure: they return `NewJournalEntryInput`s
 * that must still go through `Ledger.createEntry` (which enforces balance and period rules).
 */
import { D, money } from "@/lib/core/money";
import type { NewJournalEntryInput, NewJournalLineInput } from "@/lib/core/contracts";
import type { Actor, ID, ISODate, JournalEntry } from "@/lib/core/types";
import { ACCT } from "./chart-of-accounts";
import type { Ledger } from "./ledger";
import { isPnlAccount } from "./statements";

export interface ClosingOptions {
  /** Deterministic id prefix for the generated entries (e.g. "je_close_2026"). */
  idPrefix?: string;
  post?: boolean;
  approvalId?: ID;
}

/**
 * Build the year-end closing entries for a calendar fiscal year:
 *  1. close every revenue and expense account into retained earnings;
 *  2. close shareholder distributions into retained earnings.
 * Accounts with a zero balance are skipped; if nothing needs closing an empty list is returned.
 */
export function buildClosingEntries(ledger: Ledger, fiscalYear: number, opts: ClosingOptions = {}): NewJournalEntryInput[] {
  const from: ISODate = `${fiscalYear}-01-01`;
  const to: ISODate = `${fiscalYear}-12-31`;
  const re = ledger.requireAccount(ACCT.RETAINED_EARNINGS);
  const out: NewJournalEntryInput[] = [];

  // 1. P&L → retained earnings
  const pnlLines: NewJournalLineInput[] = [];
  let net = D(0); // credit-positive net income
  for (const a of ledger.dataset.accounts.filter(isPnlAccount)) {
    const bal = D(ledger.accountBalance(a.id, to, from)); // normal-balance signed
    if (bal.isZero()) continue;
    // Revenue (credit-normal): debit to close; expense (debit-normal): credit to close.
    const closeDebit = a.normalBalance === "CREDIT" ? bal : bal.neg();
    if (closeDebit.gt(0)) pnlLines.push({ accountId: a.id, debit: money(closeDebit), memo: `Close ${a.code} ${a.name} FY${fiscalYear}` });
    else pnlLines.push({ accountId: a.id, credit: money(closeDebit.neg()), memo: `Close ${a.code} ${a.name} FY${fiscalYear}` });
    net = net.plus(a.normalBalance === "CREDIT" ? bal : bal.neg());
  }
  if (pnlLines.length) {
    if (net.gt(0)) pnlLines.push({ accountId: re.id, credit: money(net), memo: `Net income FY${fiscalYear} to retained earnings` });
    else if (net.lt(0)) pnlLines.push({ accountId: re.id, debit: money(net.neg()), memo: `Net loss FY${fiscalYear} to retained earnings` });
    // If net is exactly zero the P&L lines already balance among themselves.
    out.push({
      id: opts.idPrefix ? `${opts.idPrefix}_pnl` : undefined,
      date: to,
      description: `Year-end close FY${fiscalYear}: revenue and expenses to retained earnings`,
      source: "CLOSING",
      lines: pnlLines,
      tags: ["year-end-close", `fy:${fiscalYear}`],
      post: opts.post,
      approvalId: opts.approvalId,
    });
  }

  // 2. Distributions → retained earnings
  const distLines: NewJournalLineInput[] = [];
  for (const a of ledger.dataset.accounts.filter((x) => x.subtype === "SHAREHOLDER_DISTRIBUTIONS")) {
    const bal = D(ledger.accountBalance(a.id, to, from)); // credit-normal; distributions leave a negative (debit) balance
    if (bal.isZero()) continue;
    const debitBal = bal.neg();
    if (debitBal.gt(0)) {
      distLines.push({ accountId: re.id, debit: money(debitBal), memo: `Close distributions FY${fiscalYear}` });
      distLines.push({ accountId: a.id, credit: money(debitBal), memo: `Close ${a.code} ${a.name} FY${fiscalYear}` });
    } else {
      distLines.push({ accountId: a.id, debit: money(debitBal.neg()), memo: `Close ${a.code} ${a.name} FY${fiscalYear}` });
      distLines.push({ accountId: re.id, credit: money(debitBal.neg()), memo: `Close distributions FY${fiscalYear}` });
    }
  }
  if (distLines.length) {
    out.push({
      id: opts.idPrefix ? `${opts.idPrefix}_dist` : undefined,
      date: to,
      description: `Year-end close FY${fiscalYear}: shareholder distributions to retained earnings`,
      source: "CLOSING",
      lines: distLines,
      tags: ["year-end-close", `fy:${fiscalYear}`, "restricted-account"],
      post: opts.post,
      approvalId: opts.approvalId,
    });
  }
  return out;
}

export interface CorrectionSpec {
  /** Date of the correction (both the reversal and the re-entry are dated here). */
  date: ISODate;
  reason: string;
  /** The corrected lines (what the entry should have been). */
  lines: NewJournalLineInput[];
  description?: string;
  approvalId?: ID;
  /** Deterministic id prefix for the pair. */
  idPrefix?: string;
}

export interface CorrectingEntryPair {
  reversal: NewJournalEntryInput;
  reentry: NewJournalEntryInput;
}

/**
 * Produce a reversal + re-entry pair for a prior-period correction. Both carry source
 * CORRECTING and the "prior-period-correction" tag; nothing is posted here.
 */
export function buildCorrectingEntry(original: JournalEntry, corrections: CorrectionSpec): CorrectingEntryPair {
  if (!corrections.reason || !corrections.reason.trim()) throw new Error("A correcting entry requires a reason");
  const tags = ["prior-period-correction", `corrects:${original.id}`];
  const reversal: NewJournalEntryInput = {
    id: corrections.idPrefix ? `${corrections.idPrefix}_rev` : undefined,
    date: corrections.date,
    description: `Correction (reversal) of #${original.entryNumber} ${original.description}: ${corrections.reason.trim()}`,
    memo: corrections.reason.trim(),
    source: "CORRECTING",
    lines: original.lines.map<NewJournalLineInput>((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo, entityRef: l.entityRef })),
    sourceIds: [original.id, ...original.sourceIds],
    tags,
    approvalId: corrections.approvalId,
  };
  const reentry: NewJournalEntryInput = {
    id: corrections.idPrefix ? `${corrections.idPrefix}_new` : undefined,
    date: corrections.date,
    description: corrections.description ?? `Correction (re-entry) of #${original.entryNumber} ${original.description}`,
    memo: corrections.reason.trim(),
    source: "CORRECTING",
    lines: corrections.lines,
    sourceIds: [original.id, ...original.sourceIds],
    tags,
    approvalId: corrections.approvalId,
  };
  return { reversal, reentry };
}

/**
 * Apply a correction through the ledger: reverse the original with source CORRECTING (linking
 * reversesEntryId / reversedByEntryId and marking the original REVERSED) and post the re-entry.
 */
export function applyCorrection(ledger: Ledger, original: JournalEntry, corrections: CorrectionSpec, actor: Actor): { reversal: JournalEntry; reentry: JournalEntry } {
  const pair = buildCorrectingEntry(original, corrections);
  const reversal = ledger.reverseEntry(original.id, corrections.date, actor, corrections.reason, corrections.approvalId, {
    source: "CORRECTING",
    tags: pair.reversal.tags,
    id: pair.reversal.id,
    description: pair.reversal.description,
  });
  const reentry = ledger.createEntry({ ...pair.reentry, post: true }, actor);
  return { reversal, reentry };
}
