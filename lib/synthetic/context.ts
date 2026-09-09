/**
 * Shared generation context for the synthetic Northlight dataset.
 *
 * Every id is derived with `deterministicId` from a semantic key, every random draw goes through
 * one `SeededRandom`, and every ledger posting is queued as a closure and executed in date order
 * (see `index.ts`) so journal entry numbers are chronological and the output is reproducible.
 */
import { accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import type { Ledger } from "@/lib/accounting/ledger";
import { entryForBankTransaction, entryForCardCharge, type EntryOptions } from "@/lib/accounting/posting-helpers";
import { addDays, monthEnd, monthKey, monthsBetween, pad2 } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { money } from "@/lib/core/money";
import { SeededRandom } from "@/lib/core/random";
import type {
  Actor,
  BankAccount,
  Card,
  CategoryStatus,
  CompanyDataset,
  Customer,
  DecimalString,
  Document,
  DocumentKind,
  EntityRef,
  ID,
  ISODate,
  ISODateTime,
  JournalEntry,
  Transaction,
  TransactionFlag,
  Vendor,
  Worker,
} from "@/lib/core/types";

export const SYNTHETIC_NAMESPACE = "northlight-synthetic-v1";

export const GENERATOR_ACTOR: Actor = { type: "SYSTEM", id: "synthetic_generator", role: "SYSTEM", displayName: "Synthetic dataset generator" };
export const OPERATOR_ACTOR: Actor = { type: "USER", id: "user_finance_operator", role: "FINANCE_OPERATOR", displayName: "Jordan Reyes (SYNTHETIC)" };
export const OWNER_ACTOR: Actor = { type: "USER", id: "user_owner", role: "OWNER", displayName: "Avery Lin (SYNTHETIC)" };

/** Deterministic id namespaced to this generator. */
export const sid = (prefix: string, ...parts: (string | number)[]): ID => deterministicId(prefix, SYNTHETIC_NAMESPACE, ...parts);
/** Deterministic timestamp for a calendar date. */
export const ts = (date: ISODate, hour = 12, minute = 0): ISODateTime => `${date}T${pad2(hour)}:${pad2(minute)}:00.000Z`;
export const acct = accountIdForCode;

export type SourceKey = "checking" | "savings" | "card";

export interface Refs {
  checking: BankAccount;
  savings: BankAccount;
  card: Card;
  vendors: Record<string, Vendor>;
  customers: { harbor: Customer; meridian: Customer };
  workers: { owner: Worker; finance: Worker; engineer: Worker; cn: Worker[] };
}

export interface Posting {
  date: ISODate;
  seq: number;
  run: (ledger: Ledger) => void;
}

export interface CaseIds {
  transactionIds: ID[];
  entityIds: ID[];
}

export interface TxSpec {
  /** Unique semantic key — the transaction id and journal entry id derive from it. */
  key: string;
  source: SourceKey;
  date: ISODate;
  /** Signed: negative = money leaving / charge on the card. */
  amount: DecimalString | number;
  description: string;
  merchant?: string;
  counterparty?: EntityRef;
  categoryCode: string | null;
  categoryStatus?: CategoryStatus;
  confidence?: number;
  reason?: string;
  approvedBy?: string;
  flags?: TransactionFlag[];
  meta?: Record<string, unknown>;
  postedDate?: ISODate;
}

export interface DocSpec {
  key: string;
  kind: DocumentKind;
  title: string;
  date: ISODate;
  vendorId?: ID;
  customerId?: ID;
  workerId?: ID;
  amount?: DecimalString | number;
  transactionIds?: ID[];
  journalEntryIds?: ID[];
  storagePath?: string;
  mimeType?: string;
  extracted?: Record<string, unknown>;
  confidence?: number;
  tags?: string[];
}

export interface PostTxOptions extends EntryOptions {
  /** Extra ids (documents, bills, …) appended to the entry's sourceIds. */
  extraSourceIds?: ID[];
}

export class GenContext {
  readonly ds: CompanyDataset;
  readonly rng: SeededRandom;
  readonly seed: number;
  readonly asOf: ISODate;
  readonly startMonth: string;
  /** Every month from startMonth through the asOf month (inclusive). */
  readonly months: string[];
  /** Months whose last day is on or before asOf. */
  readonly fullMonths: string[];
  readonly currentMonth: string;
  readonly priorMonth: string;
  readonly postings: Posting[] = [];
  readonly cases = new Map<string, CaseIds>();
  /** Cross-file references to notable ids (e.g. the franchise-tax transaction). */
  readonly marks = new Map<string, ID>();
  refs!: Refs;
  private seq = 0;

  constructor(ds: CompanyDataset, opts: { seed: number; asOfDate: ISODate; startMonth: string }) {
    this.ds = ds;
    this.seed = opts.seed;
    this.rng = new SeededRandom(opts.seed);
    this.asOf = opts.asOfDate;
    this.startMonth = opts.startMonth;
    this.months = monthsBetween(opts.startMonth, monthKey(opts.asOfDate));
    this.fullMonths = this.months.filter((m) => monthEnd(`${m}-01`) <= opts.asOfDate);
    this.currentMonth = this.months[this.months.length - 1];
    this.priorMonth = this.months.length > 1 ? this.months[this.months.length - 2] : this.currentMonth;
  }

  inRange(date: ISODate): boolean {
    return date >= `${this.startMonth}-01` && date <= this.asOf;
  }

  /** Month `offset` positions before the current (partial) month; 0 = current month. */
  monthFromEnd(offset: number): string {
    const idx = this.months.length - 1 - offset;
    if (idx < 0) throw new Error(`Synthetic timeline too short: need month ${offset} before ${this.currentMonth}`);
    return this.months[idx];
  }

  schedule(date: ISODate, run: (ledger: Ledger) => void): void {
    this.postings.push({ date, seq: this.seq++, run });
  }

  sourceFor(key: SourceKey): { id: ID; kind: "BANK" | "CARD"; glCode: string; last4: string } {
    const r = this.refs;
    if (key === "checking") return { id: r.checking.id, kind: "BANK", glCode: "1000", last4: r.checking.last4 };
    if (key === "savings") return { id: r.savings.id, kind: "BANK", glCode: "1010", last4: r.savings.last4 };
    return { id: r.card.id, kind: "CARD", glCode: "2050", last4: r.card.last4 };
  }

  glCodeFor(tx: Transaction): string {
    const r = this.refs;
    if (tx.sourceAccountId === r.checking.id) return "1000";
    if (tx.sourceAccountId === r.savings.id) return "1010";
    if (tx.sourceAccountId === r.card.id) return "2050";
    throw new Error(`Unknown source account ${tx.sourceAccountId}`);
  }

  addTx(spec: TxSpec): Transaction {
    if (!this.inRange(spec.date)) throw new Error(`Transaction ${spec.key} dated ${spec.date} is outside the generated range`);
    const src = this.sourceFor(spec.source);
    const id = sid("tx", spec.key);
    const status: CategoryStatus = spec.categoryStatus ?? (spec.categoryCode ? "APPROVED" : "UNCATEGORIZED");
    const defaultPosted = src.kind === "CARD" ? addDays(spec.date, 1) : spec.date;
    const postedDate = spec.postedDate ?? (defaultPosted > this.asOf ? spec.date : defaultPosted);
    const tx: Transaction = {
      id,
      sourceKind: src.kind,
      sourceAccountId: src.id,
      externalId: `${src.kind}-${src.last4}-${id.slice(3, 15).toUpperCase()}`,
      date: spec.date,
      postedDate,
      amount: money(spec.amount),
      currency: "USD",
      descriptionRaw: spec.description,
      merchantNormalized: spec.merchant,
      counterpartyRef: spec.counterparty,
      category: {
        accountId: spec.categoryCode ? acct(spec.categoryCode) : null,
        status,
        confidence: spec.confidence ?? (status === "APPROVED" ? 0.98 : status === "SUGGESTED" ? 0.6 : 0),
        reason: spec.reason,
        suggestedBy: status === "UNCATEGORIZED" ? undefined : "RULE",
        approvedBy: status === "APPROVED" ? (spec.approvedBy ?? OPERATOR_ACTOR.id) : undefined,
      },
      documentIds: [],
      flags: [...(spec.flags ?? [])],
      importBatchId: `import_${spec.source}_${monthKey(spec.date)}`,
      meta: { isSynthetic: true, ...(spec.meta ?? {}) },
    };
    this.ds.transactions.push(tx);
    return tx;
  }

  addDoc(spec: DocSpec): Document {
    const id = sid("doc", spec.key);
    const doc: Document = {
      id,
      kind: spec.kind,
      title: spec.title,
      date: spec.date,
      vendorId: spec.vendorId,
      customerId: spec.customerId,
      workerId: spec.workerId,
      amount: spec.amount === undefined ? undefined : money(spec.amount),
      currency: spec.amount === undefined ? undefined : "USD",
      linkedTransactionIds: [...(spec.transactionIds ?? [])],
      linkedJournalEntryIds: [...(spec.journalEntryIds ?? [])],
      storagePath: spec.storagePath ?? `synthetic://documents/${spec.kind.toLowerCase()}/${id}.pdf`,
      mimeType: spec.mimeType ?? "application/pdf",
      extracted: spec.extracted,
      classificationConfidence: spec.confidence ?? 0.97,
      retention: { policyKey: "records-retention-default", retainUntil: null },
      isSynthetic: true,
      tags: ["synthetic", ...(spec.tags ?? [])],
      uploadedAt: ts(spec.date, 15),
    };
    this.ds.documents.push(doc);
    for (const txId of doc.linkedTransactionIds) {
      const tx = this.ds.transactions.find((t) => t.id === txId);
      if (tx && !tx.documentIds.includes(id)) tx.documentIds.push(id);
    }
    return doc;
  }

  /** Link a transaction and a journal entry both ways. */
  link(tx: Transaction, entry: JournalEntry): void {
    tx.journalEntryId = entry.id;
    if (!entry.sourceIds.includes(tx.id)) entry.sourceIds.push(tx.id);
  }

  /** Queue the standard two-line posting for a bank or card transaction against `offsetCode`. */
  postTx(tx: Transaction, offsetCode: string, opts: PostTxOptions = {}): ID {
    const entryId = opts.id ?? sid("je", `tx:${tx.id}`);
    const { extraSourceIds, ...entryOpts } = opts;
    this.schedule(tx.date, (ledger) => {
      const glCode = this.glCodeFor(tx);
      const options: EntryOptions = { ...entryOpts, id: entryId, post: true, sourceIds: [...(entryOpts.sourceIds ?? []), ...(extraSourceIds ?? [])] };
      const input = tx.sourceKind === "CARD" ? entryForCardCharge(tx, offsetCode, glCode, options) : entryForBankTransaction(tx, offsetCode, glCode, options);
      const entry = ledger.createEntry(input, GENERATOR_ACTOR);
      this.link(tx, entry);
    });
    return entryId;
  }

  caseTx(key: string, ...txs: (Transaction | ID)[]): void {
    const c = this.caseIds(key);
    for (const t of txs) {
      const id = typeof t === "string" ? t : t.id;
      if (!c.transactionIds.includes(id)) c.transactionIds.push(id);
      if (typeof t !== "string") {
        const keys = (t.meta?.groundTruthKeys as string[] | undefined) ?? [];
        if (!keys.includes(key)) t.meta = { ...(t.meta ?? {}), groundTruthKeys: [...keys, key] };
      }
    }
  }

  caseEntity(key: string, ...ids: ID[]): void {
    const c = this.caseIds(key);
    for (const id of ids) if (!c.entityIds.includes(id)) c.entityIds.push(id);
  }

  private caseIds(key: string): CaseIds {
    let c = this.cases.get(key);
    if (!c) {
      c = { transactionIds: [], entityIds: [] };
      this.cases.set(key, c);
    }
    return c;
  }

  mark(key: string, id: ID): void {
    this.marks.set(key, id);
  }

  requireMark(key: string): ID {
    const id = this.marks.get(key);
    if (!id) throw new Error(`Synthetic generator: missing mark ${key}`);
    return id;
  }
}
