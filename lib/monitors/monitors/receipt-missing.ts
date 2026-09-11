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
        title: a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED" ? "Receipt threshold not set" : `${a.kind.replace(/_/g, " ").toLowerCase()}: ${a.targetId}`,
        detail: a.message,
        amount: a.amount === undefined ? undefined : a.amount.startsWith("-") ? a.amount.slice(1) : a.amount,
        dueDate: a.date,
        relatedIds: [a.targetId],
        suggestedTask: a.kind === "MISSING_RECEIPT" ? { kind: "documents.match_receipts", params: {} } : a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED" ? { kind: "cfo.config_status", params: {} } : { kind: "documents.missing", params: { asOf: ctx.asOf } },
      }),
    );
  },
};
