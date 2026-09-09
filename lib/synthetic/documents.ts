/**
 * Synthetic documents: monthly bank and card statements, receipts for most card charges above
 * the receipt threshold (deliberately not all), the Harbor contract, entity documents, the
 * insurance policy and one piece of CPA correspondence. Invoice, bill and payroll documents are
 * created alongside their records.
 */
import { addDays, monthEnd } from "@/lib/core/dates";
import { D, abs, money } from "@/lib/core/money";
import type { Transaction } from "@/lib/core/types";
import { sid, type GenContext, type SourceKey } from "./context";

export const RECEIPT_THRESHOLD = "75";
export const RECEIPT_COVERAGE = 0.85;

function statements(ctx: GenContext): void {
  const sources: { key: SourceKey; id: string; kind: "BANK_STATEMENT" | "CARD_STATEMENT"; label: string }[] = [
    { key: "checking", id: ctx.refs.checking.id, kind: "BANK_STATEMENT", label: "Operating Checking ...4410" },
    { key: "savings", id: ctx.refs.savings.id, kind: "BANK_STATEMENT", label: "Business Savings ...4428" },
    { key: "card", id: ctx.refs.card.id, kind: "CARD_STATEMENT", label: "Business Visa ...7731" },
  ];
  for (const src of sources) {
    let running = D(0);
    for (const month of ctx.fullMonths) {
      const txs = ctx.ds.transactions.filter((t) => t.sourceAccountId === src.id && t.date.slice(0, 7) === month && !t.duplicateOfId);
      const opening = running;
      const net = txs.reduce((acc, t) => acc.plus(D(t.amount)), D(0));
      running = running.plus(net);
      const sign = src.kind === "CARD_STATEMENT" ? -1 : 1;
      ctx.addDoc({
        key: `statement:${src.key}:${month}`,
        kind: src.kind,
        title: `${src.label} statement ${month}`,
        date: monthEnd(`${month}-01`),
        transactionIds: txs.map((t) => t.id),
        storagePath: `synthetic://statements/${src.key}/${month}.pdf`,
        extracted: {
          account: src.label,
          period: month,
          openingBalance: money(opening.times(sign)),
          closingBalance: money(running.times(sign)),
          transactionCount: txs.length,
          totalDebits: money(txs.filter((t) => D(t.amount).lt(0)).reduce((a, t) => a.plus(D(t.amount).abs()), D(0))),
          totalCredits: money(txs.filter((t) => D(t.amount).gt(0)).reduce((a, t) => a.plus(D(t.amount)), D(0))),
        },
        tags: ["statement", src.key],
      });
    }
  }
}

function receiptFor(ctx: GenContext, tx: Transaction): void {
  const vendor = tx.counterpartyRef?.type === "VENDOR" ? ctx.ds.vendors.find((v) => v.id === tx.counterpartyRef?.id) : undefined;
  const meta = tx.meta ?? {};
  const extracted: Record<string, unknown> = {
    merchant: tx.merchantNormalized ?? tx.descriptionRaw,
    date: tx.date,
    total: abs(tx.amount),
    paymentMethod: tx.sourceKind === "CARD" ? "Business Visa ...7731" : "ACH / bank debit",
  };
  if (Array.isArray(meta.attendees)) extracted.attendees = meta.attendees;
  if (typeof meta.businessPurpose === "string") extracted.businessPurpose = meta.businessPurpose;
  const doc = ctx.addDoc({
    key: `receipt:${tx.id}`,
    kind: "RECEIPT",
    title: `Receipt — ${tx.merchantNormalized ?? tx.descriptionRaw} ${tx.date}`,
    date: tx.date,
    vendorId: vendor?.id,
    amount: abs(tx.amount),
    transactionIds: [tx.id],
    storagePath: `synthetic://receipts/${tx.date.slice(0, 7)}/${tx.id}.pdf`,
    extracted,
    confidence: 0.93,
    tags: ["receipt"],
  });
  const asset = ctx.ds.fixedAssets.find((a) => a.sourceTransactionId === tx.id);
  if (asset) asset.documentId = doc.id;
}

function receipts(ctx: GenContext): void {
  const card = ctx.refs.card.id;
  for (const tx of ctx.ds.transactions) {
    const policy = tx.meta?.receipt as string | undefined;
    if (policy === "none") continue;
    if (policy === "required") {
      receiptFor(ctx, tx);
      continue;
    }
    const isCharge = tx.sourceAccountId === card && D(tx.amount).lt(0) && !tx.flags.includes("TRANSFER");
    if (!isCharge || D(tx.amount).abs().lte(D(RECEIPT_THRESHOLD))) continue;
    if (ctx.rng.chance(RECEIPT_COVERAGE)) receiptFor(ctx, tx);
    else if (!tx.flags.includes("MISSING_RECEIPT")) tx.flags.push("MISSING_RECEIPT");
  }
}

function companyDocuments(ctx: GenContext): void {
  const start = `${ctx.startMonth}-01`;
  const harbor = ctx.refs.customers.harbor;
  const contract = ctx.addDoc({
    key: "contract:harbor",
    kind: "CONTRACT",
    title: "Master services agreement — Harbor Analytics Group",
    date: addDays(start, -4),
    customerId: harbor.id,
    amount: "30000",
    storagePath: "synthetic://contracts/harbor-analytics-msa.pdf",
    extracted: { counterparty: harbor.name, monthlyFee: "30000.0000", paymentTerms: "Net 15", invoicing: "1st of each month", relatedParty: "Counterparty principal is the CEO's father — related-party review required", term: "12 months, auto-renewing" },
    tags: ["contract", "related-party"],
  });
  harbor.contractDocumentId = contract.id;

  ctx.addDoc({ key: "entity:articles", kind: "ENTITY_DOCUMENT", title: "Articles of Organization — Northlight AI Services LLC (California)", date: addDays(start, -12), storagePath: "synthetic://entity/articles-of-organization.pdf", extracted: { entity: "Northlight AI Services LLC", state: "CA", filingType: "LLC-1" }, tags: ["entity"] });
  ctx.addDoc({ key: "entity:s-election", kind: "ENTITY_DOCUMENT", title: "IRS acceptance of S corporation election (Form 2553)", date: addDays(start, 40), storagePath: "synthetic://entity/s-election-acceptance.pdf", extracted: { form: "2553", effectiveDate: start, accepted: true }, tags: ["entity", "tax"] });
  ctx.addDoc({ key: "insurance:policy", kind: "INSURANCE", title: "Business owner's policy — Hartline Business Insurance", date: start, vendorId: ctx.refs.vendors.insurance.id, amount: "145", storagePath: "synthetic://insurance/hartline-bop.pdf", extracted: { carrier: "Hartline Business Insurance", monthlyPremium: "145.0000", coverage: "General liability + professional liability" }, tags: ["insurance"] });
  const corrDate = `${ctx.monthFromEnd(7)}-05`;
  ctx.addDoc({ key: "cpa:engagement", kind: "CPA_CORRESPONDENCE", title: "Kestrel Tax & Advisory — engagement letter and year-end request list", date: corrDate, vendorId: ctx.refs.vendors.cpa.id, storagePath: "synthetic://cpa/engagement-and-request-list.pdf", extracted: { from: "Kestrel Tax & Advisory LLP", topics: ["S-corp return preparation", "Reasonable compensation documentation", "International worker classification — refer to counsel", "1099 information returns"] }, tags: ["cpa"] });
}

export function generateDocuments(ctx: GenContext): void {
  statements(ctx);
  receipts(ctx);
  companyDocuments(ctx);
}

/** After posting, mirror each document's transactions' journal entries onto the document. */
export function linkDocumentsToEntries(ctx: GenContext): void {
  const txById = new Map(ctx.ds.transactions.map((t) => [t.id, t]));
  for (const doc of ctx.ds.documents) {
    for (const txId of doc.linkedTransactionIds) {
      const je = txById.get(txId)?.journalEntryId;
      if (je && !doc.linkedJournalEntryIds.includes(je)) doc.linkedJournalEntryIds.push(je);
    }
  }
}

export const documentId = (key: string) => sid("doc", key);
