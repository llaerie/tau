/**
 * Missing-document alerts. Never assumes which tax form applies to a worker, never assumes
 * a receipt threshold that has not been set.
 */
import type { Transaction, CompanyDataset, DecimalString, ISODate } from "@/lib/core/types";
import { abs, gte } from "@/lib/core/money";

export type MissingDocumentAlertKind =
  | "RECEIPT_THRESHOLD_UNCONFIRMED"
  | "MISSING_RECEIPT"
  | "BILL_WITHOUT_DOCUMENT"
  | "WORKER_TAX_DOC_UNKNOWN"
  | "BANK_STATEMENT_MISSING"
  | "CARD_STATEMENT_MISSING"
  | "CONTRACT_MISSING";

export interface MissingDocumentAlert {
  id: string;
  kind: MissingDocumentAlertKind;
  severity: "INFO" | "WARNING" | "HIGH";
  targetType: "TRANSACTION" | "BILL" | "WORKER" | "BANK_ACCOUNT" | "CARD" | "CUSTOMER" | "CONFIG";
  targetId: string;
  message: string;
  amount?: DecimalString;
  date?: ISODate;
}

export interface MissingDocumentThresholds {
  /** null = unconfirmed -> transaction receipt checks are skipped and a config alert is raised */
  receiptThreshold: DecimalString | null;
  /** Customers with at least this many invoices are treated as recurring. Default 2. */
  recurringInvoiceCount?: number;
}

export const WORKER_TAX_DOC_MESSAGE = "UNKNOWN — confirm which form applies; do not assume";

export function missingDocumentAlerts(dataset: CompanyDataset, thresholds: MissingDocumentThresholds): MissingDocumentAlert[] {
  const alerts: MissingDocumentAlert[] = [];
  const docs = dataset.documents;
  const receiptKinds = new Set(["RECEIPT", "VENDOR_BILL", "CUSTOMER_INVOICE"]);

  // 1. Transactions at/above the receipt threshold without a linked receipt-type document
  if (thresholds.receiptThreshold === null) {
    alerts.push({ id: "mda_config_receipt_threshold", kind: "RECEIPT_THRESHOLD_UNCONFIRMED", severity: "WARNING", targetType: "CONFIG", targetId: "expense_policy.receipt_required_above", message: "Receipt threshold is UNCONFIRMED; per-transaction receipt checks are skipped until the owner sets it." });
  } else {
    // Outflows that are not purchases (payroll net pay, tax deposits, card payments, distributions,
    // loan payments) are evidenced by payroll reports, government confirmations or statements, not receipts.
    const NON_PURCHASE_SUBTYPES = new Set(["PAYROLL_EXPENSE", "PAYROLL_LIABILITY", "TAX_LIABILITY", "TAX_EXPENSE", "CREDIT_CARD", "CASH", "OWNER_EQUITY", "SHAREHOLDER_DISTRIBUTIONS", "LONG_TERM_DEBT", "OTHER_CURRENT_LIABILITY"]);
    const accountById = new Map(dataset.accounts.map((a) => [a.id, a]));
    const entryById = new Map(dataset.journalEntries.map((e) => [e.id, e]));
    const billsWithDocsByPayment = new Set<string>();
    for (const p of dataset.payments) {
      if (!p.transactionId) continue;
      if (p.applications.some((ap) => ap.targetType === "BILL" && dataset.bills.find((b) => b.id === ap.targetId)?.documentId)) billsWithDocsByPayment.add(p.transactionId);
    }
    // Contractor / international worker payments are purchases of services: an invoice is required.
    const CONTRACTOR_CODES = new Set(["6050", "6060", "5200"]);
    const needsInvoice = (accountId: string) => CONTRACTOR_CODES.has(accountById.get(accountId)?.code ?? "");
    const isNonPurchase = (t: Transaction): boolean => {
      if (t.category.accountId && needsInvoice(t.category.accountId)) return false;
      const cat = t.category.accountId ? accountById.get(t.category.accountId) : undefined;
      if (cat && NON_PURCHASE_SUBTYPES.has(cat.subtype)) return true;
      const je = t.journalEntryId ? entryById.get(t.journalEntryId) : undefined;
      if (!je) return false;
      if (je.lines.some((l) => needsInvoice(l.accountId))) return false;
      const nonCashLines = je.lines.filter((l) => accountById.get(l.accountId)?.subtype !== "CASH");
      return nonCashLines.length > 0 && nonCashLines.every((l) => NON_PURCHASE_SUBTYPES.has(accountById.get(l.accountId)?.subtype ?? ""));
    };
    for (const t of dataset.transactions) {
      if (!t.amount.startsWith("-")) continue; // outflows only
      if (t.flags.includes("TRANSFER") || t.transferPairId) continue;
      if (!gte(abs(t.amount), thresholds.receiptThreshold)) continue;
      if (isNonPurchase(t)) continue;
      const linked =
        t.documentIds.some((id) => receiptKinds.has(docs.find((d) => d.id === id)?.kind ?? "")) ||
        docs.some((d) => receiptKinds.has(d.kind) && d.linkedTransactionIds.includes(t.id)) ||
        billsWithDocsByPayment.has(t.id);
      if (!linked) {
        alerts.push({ id: `mda_receipt_${t.id}`, kind: "MISSING_RECEIPT", severity: "WARNING", targetType: "TRANSACTION", targetId: t.id, message: `Transaction ${t.date} ${t.descriptionRaw} (${t.amount}) is at/above the receipt threshold and has no linked receipt.`, amount: t.amount, date: t.date });
      }
    }
  }

  // 2. Bills without a document
  for (const b of dataset.bills) {
    if (b.status === "VOID" || b.status === "DUPLICATE") continue;
    if (!b.documentId || !docs.some((d) => d.id === b.documentId)) {
      alerts.push({ id: `mda_bill_${b.id}`, kind: "BILL_WITHOUT_DOCUMENT", severity: "WARNING", targetType: "BILL", targetId: b.id, message: `Bill ${b.number} (${b.total}) has no supporting document.`, amount: b.total, date: b.billDate });
    }
  }

  // 3. Workers without tax documentation (owner-employees excluded; the form is never assumed)
  for (const w of dataset.workers) {
    if (w.isOwner) continue;
    if (w.workerType === "EMPLOYEE" && w.country === "US") continue; // W-4/I-9 are payroll-provider documents, not in DocumentKind
    const hasTaxDoc = docs.some((d) => (d.kind === "W9" || d.kind === "W8") && (d.workerId === w.id || w.documentIds.includes(d.id)));
    if (!hasTaxDoc) {
      alerts.push({ id: `mda_worker_${w.id}`, kind: "WORKER_TAX_DOC_UNKNOWN", severity: w.country === "US" ? "WARNING" : "HIGH", targetType: "WORKER", targetId: w.id, message: `${w.displayName} (${w.country}, ${w.workerType}) has no tax documentation on file. Required form: ${WORKER_TAX_DOC_MESSAGE}.` });
    }
  }

  // 4. Statements missing for closed months
  const closedPeriods = dataset.periods.filter((p) => p.status === "SOFT_CLOSED" || p.status === "LOCKED");
  for (const p of closedPeriods) {
    const month = p.id.slice(0, 7);
    for (const acct of dataset.bankAccounts) {
      const present = docs.some((d) => d.kind === "BANK_STATEMENT" && d.date.startsWith(month) && (d.extracted?.accountId === acct.id || d.tags.includes(`account:${acct.id}`) || dataset.bankAccounts.length === 1));
      if (!present) alerts.push({ id: `mda_bankstmt_${acct.id}_${month}`, kind: "BANK_STATEMENT_MISSING", severity: "HIGH", targetType: "BANK_ACCOUNT", targetId: acct.id, message: `No bank statement on file for ${acct.name} for closed period ${month}.`, date: p.endDate });
    }
    for (const card of dataset.cards) {
      const present = docs.some((d) => d.kind === "CARD_STATEMENT" && d.date.startsWith(month) && (d.extracted?.cardId === card.id || d.tags.includes(`card:${card.id}`) || dataset.cards.length === 1));
      if (!present) alerts.push({ id: `mda_cardstmt_${card.id}_${month}`, kind: "CARD_STATEMENT_MISSING", severity: "WARNING", targetType: "CARD", targetId: card.id, message: `No card statement on file for ${card.name} for closed period ${month}.`, date: p.endDate });
    }
  }

  // 5. Contracts missing for customers with recurring revenue
  const minInvoices = thresholds.recurringInvoiceCount ?? 2;
  for (const c of dataset.customers) {
    if (!c.active) continue;
    const invoiceCount = dataset.invoices.filter((i) => i.customerId === c.id && i.status !== "VOID").length;
    if (invoiceCount < minInvoices) continue;
    const hasContract = (c.contractDocumentId && docs.some((d) => d.id === c.contractDocumentId)) || docs.some((d) => d.kind === "CONTRACT" && d.customerId === c.id);
    if (!hasContract) {
      alerts.push({ id: `mda_contract_${c.id}`, kind: "CONTRACT_MISSING", severity: c.relatedParty ? "HIGH" : "WARNING", targetType: "CUSTOMER", targetId: c.id, message: `Customer ${c.name} has ${invoiceCount} invoices (recurring revenue) but no contract on file.${c.relatedParty ? " Related party: written terms required for CPA disclosure." : ""}` });
    }
  }

  return alerts;
}
