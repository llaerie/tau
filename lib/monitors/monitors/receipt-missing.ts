/** Missing receipts and other missing documents from lib/documents (threshold never assumed). */
import { missingDocumentAlerts, type MissingDocumentAlert } from "@/lib/documents/missing-documents";
import { makeItem, receiptThresholdFor } from "../helpers";
import type { AttentionItem, AttentionSeverity, Monitor } from "../types";

const SEVERITY: Record<MissingDocumentAlert["severity"], AttentionSeverity> = { INFO: "INFO", WARNING: "WARNING", HIGH: "CRITICAL" };
const RECEIPT_KINDS = new Set<MissingDocumentAlert["kind"]>(["MISSING_RECEIPT", "BILL_WITHOUT_DOCUMENT", "RECEIPT_THRESHOLD_UNCONFIRMED"]);

export const receiptMissing: Monitor = {
  key: "receipt_missing",
  description: "Transactions above the receipt threshold without a receipt, bills without documents, and other missing-document alerts.",
  run(ctx): AttentionItem[] {
    const threshold = receiptThresholdFor(ctx.dataset.configFields, ctx.policies);
    const alerts = missingDocumentAlerts(ctx.dataset, { receiptThreshold: threshold });
    return alerts.map((a) =>
      makeItem(ctx, {
        kind: RECEIPT_KINDS.has(a.kind) ? "receipt_missing" : "document_missing",
        severity: a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED" ? "INFO" : SEVERITY[a.severity],
        title: a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED" ? "Receipt threshold not set" : `${a.kind.replace(/_/g, " ").toLowerCase()}: ${describeTarget(ctx.dataset, a)}`,
        detail: a.message,
        amount: a.amount === undefined ? undefined : a.amount.startsWith("-") ? a.amount.slice(1) : a.amount,
        dueDate: a.date,
        relatedIds: [a.targetId],
        suggestedTask: a.kind === "MISSING_RECEIPT" ? { kind: "documents.match_receipts", params: {} } : a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED" ? { kind: "cfo.config_status", params: {} } : { kind: "documents.missing", params: { asOf: ctx.asOf } },
      }),
    );
  },
};

function describeTarget(dataset: import("@/lib/core/types").CompanyDataset, a: { targetType: string; targetId: string; amount?: string; date?: string }): string {
  if (a.targetType === "TRANSACTION") {
    const t = dataset.transactions.find((x) => x.id === a.targetId);
    if (t) return `${t.date} ${t.merchantNormalized ?? t.descriptionRaw} (${t.amount.startsWith("-") ? t.amount.slice(1) : t.amount})`;
  }
  if (a.targetType === "BANK_ACCOUNT") return dataset.bankAccounts.find((b) => b.id === a.targetId)?.name ?? a.targetId;
  if (a.targetType === "CARD") return dataset.cards.find((c) => c.id === a.targetId)?.name ?? a.targetId;
  if (a.targetType === "WORKER") return dataset.workers.find((w) => w.id === a.targetId)?.displayName ?? a.targetId;
  if (a.targetType === "BILL") return dataset.bills.find((b) => b.id === a.targetId)?.number ?? a.targetId;
  if (a.targetType === "CUSTOMER") return dataset.customers.find((c) => c.id === a.targetId)?.name ?? a.targetId;
  return a.targetId;
}
