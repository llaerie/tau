/**
 * Receipt <-> transaction matching. Proposes links with a confidence; links below
 * AUTO_LINK_THRESHOLD are never auto-linked (they go to the owner for review).
 */
import type { CompanyDataset, Document, Transaction } from "@/lib/core/types";
import { daysBetween } from "@/lib/core/dates";
import { abs, within } from "@/lib/core/money";

export const AUTO_LINK_THRESHOLD = 0.8;
export const AMOUNT_TOLERANCE = "0.01";
export const DATE_TOLERANCE_DAYS = 3;

export interface ProposedLink {
  documentId: string;
  transactionId: string;
  confidence: number;
  reasons: string[];
  autoLinkEligible: boolean;
}

export interface MatchOptions {
  documentKinds?: Document["kind"][];
  /** Consider documents/transactions already linked? Default false. */
  includeLinked?: boolean;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function vendorMatches(doc: Document, tx: Transaction, dataset: CompanyDataset): { match: boolean; how?: string } {
  if (doc.vendorId && tx.counterpartyRef?.type === "VENDOR" && tx.counterpartyRef.id === doc.vendorId) return { match: true, how: "vendor id" };
  const vendor = doc.vendorId ? dataset.vendors.find((v) => v.id === doc.vendorId) : undefined;
  const names = vendor ? [vendor.name, ...vendor.normalizedNames] : [];
  const extractedVendor = typeof doc.extracted?.vendor === "string" ? (doc.extracted.vendor as string) : typeof doc.extracted?.merchant === "string" ? (doc.extracted.merchant as string) : undefined;
  if (extractedVendor) names.push(extractedVendor);
  const hay = normalizeName(`${tx.descriptionRaw} ${tx.merchantNormalized ?? ""}`);
  for (const n of names) {
    const nn = normalizeName(n);
    if (nn.length >= 3 && hay.includes(nn)) return { match: true, how: `name "${n}"` };
  }
  return { match: false };
}

/** Score a single (document, transaction) pair; null when the hard constraints fail. */
export function scoreLink(doc: Document, tx: Transaction, dataset: CompanyDataset): ProposedLink | null {
  if (!doc.amount) return null;
  if (!within(abs(tx.amount), abs(doc.amount), AMOUNT_TOLERANCE)) return null;
  const dayDiff = Math.abs(daysBetween(doc.date, tx.date));
  if (dayDiff > DATE_TOLERANCE_DAYS) return null;
  if (doc.currency && doc.currency !== tx.currency) return null;
  const reasons: string[] = [`amount ${doc.amount} within ${AMOUNT_TOLERANCE}`];
  let confidence = 0.5;
  if (dayDiff === 0) {
    confidence += 0.2;
    reasons.push("same date");
  } else {
    confidence += 0.1;
    reasons.push(`date within ${dayDiff} day(s)`);
  }
  const v = vendorMatches(doc, tx, dataset);
  if (v.match) {
    confidence += 0.3;
    reasons.push(`vendor match by ${v.how}`);
  } else {
    reasons.push("no vendor match");
  }
  confidence = Math.round(Math.min(1, confidence) * 100) / 100;
  return { documentId: doc.id, transactionId: tx.id, confidence, reasons, autoLinkEligible: confidence >= AUTO_LINK_THRESHOLD };
}

/**
 * Propose one-to-one links between unlinked receipt-type documents and outflow transactions.
 * Deterministic: candidates sorted by confidence desc, then document id, then transaction id.
 */
export function matchReceiptsToTransactions(dataset: CompanyDataset, opts: MatchOptions = {}): ProposedLink[] {
  const kinds = new Set(opts.documentKinds ?? ["RECEIPT", "VENDOR_BILL"]);
  const docs = dataset.documents.filter((d) => kinds.has(d.kind) && d.amount && (opts.includeLinked || d.linkedTransactionIds.length === 0));
  const txs = dataset.transactions.filter((t) => t.amount.startsWith("-") && !t.flags.includes("TRANSFER") && (opts.includeLinked || t.documentIds.length === 0));
  const candidates: ProposedLink[] = [];
  for (const d of docs) for (const t of txs) {
    const s = scoreLink(d, t, dataset);
    if (s) candidates.push(s);
  }
  candidates.sort((a, b) => b.confidence - a.confidence || a.documentId.localeCompare(b.documentId) || a.transactionId.localeCompare(b.transactionId));
  const usedDocs = new Set<string>();
  const usedTx = new Set<string>();
  const out: ProposedLink[] = [];
  for (const c of candidates) {
    if (usedDocs.has(c.documentId) || usedTx.has(c.transactionId)) continue;
    usedDocs.add(c.documentId);
    usedTx.add(c.transactionId);
    out.push(c);
  }
  return out;
}

/** Apply only the auto-link-eligible proposals (pure: returns updated copies). */
export function applyAutoLinks(dataset: CompanyDataset, proposals: ProposedLink[]): { documents: Document[]; transactions: Transaction[]; applied: ProposedLink[] } {
  const applied = proposals.filter((p) => p.autoLinkEligible && p.confidence >= AUTO_LINK_THRESHOLD);
  const byDoc = new Map(applied.map((p) => [p.documentId, p.transactionId]));
  const byTx = new Map(applied.map((p) => [p.transactionId, p.documentId]));
  const documents = dataset.documents.map((d) => (byDoc.has(d.id) ? { ...d, linkedTransactionIds: Array.from(new Set([...d.linkedTransactionIds, byDoc.get(d.id)!])) } : d));
  const transactions = dataset.transactions.map((t) => (byTx.has(t.id) ? { ...t, documentIds: Array.from(new Set([...t.documentIds, byTx.get(t.id)!])), flags: t.flags.filter((f) => f !== "MISSING_RECEIPT") } : t));
  return { documents, transactions, applied };
}
