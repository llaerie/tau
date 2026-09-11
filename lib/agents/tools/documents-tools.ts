/**
 * Documents tools: missing-document alerts, document classification, receipt-to-transaction
 * matching (proposals only; auto-link eligible ones are reported) and retention status.
 */
import type { DocumentKind } from "@/lib/core/types";
import { classifyDocument } from "@/lib/documents/classifier";
import { matchReceiptsToTransactions } from "@/lib/documents/linking";
import { missingDocumentAlerts } from "@/lib/documents/missing-documents";
import { retentionFor } from "@/lib/documents/retention";
import { POLICY_KEYS, policyParameter } from "@/lib/knowledge/policies";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, ok, textFigure } from "./common";

const DOC_KINDS: DocumentKind[] = ["RECEIPT", "CUSTOMER_INVOICE", "VENDOR_BILL", "BANK_STATEMENT", "CARD_STATEMENT", "CONTRACT", "PAYROLL_REPORT", "TAX_NOTICE", "TAX_RETURN", "W9", "W8", "ENTITY_DOCUMENT", "INSURANCE", "CPA_CORRESPONDENCE", "OTHER"];

export const missingDocumentsTool = defineTool({
  name: "missing_documents",
  description: "Missing document alerts (receipts, bills, worker tax docs, statements, contracts).",
  riskLevel: "GREEN",
  capabilityKey: "document_classification",
  inputSchema: TASKS["documents.missing"].params,
  async execute(input, ctx) {
    const param = policyParameter<string>(ctx.dataset.policies, POLICY_KEYS.EXPENSE_DOCUMENTATION, "receiptThreshold");
    const threshold = param.status === "CONFIRMED" && param.value ? param.value : null;
    const alerts = missingDocumentAlerts(ctx.dataset, { receiptThreshold: threshold }).filter((a) => !input.asOf || !a.date || a.date <= input.asOf);
    const byKind: Record<string, number> = {};
    for (const a of alerts) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    const high = alerts.filter((a) => a.severity === "HIGH");
    const flagTargets = alerts.filter((a) => a.kind === "MISSING_RECEIPT").map((a) => a.targetId);
    return ok({
      answer: alerts.length ? `${alerts.length} missing-document alert(s): ${Object.entries(byKind).map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ")}; ${high.length} high severity.${threshold === null ? " The receipt threshold is UNCONFIRMED, so per-transaction receipt checks are skipped rather than assumed." : ""}` : "No missing-document alerts.",
      numbers: [textFigure("Alerts", alerts.length), textFigure("High severity", high.length), textFigure("Receipt threshold", threshold ?? "UNCONFIRMED")],
      why: alerts.slice(0, 10).map((a) => `[${a.severity}] ${a.message}`),
      risks: high.length ? ["High-severity gaps (statements for closed periods, worker tax docs, related-party contracts) block the CPA package."] : [],
      confidence: 0.9,
      structured: { value: alerts.length, values: { alerts: alerts.length, high: high.length }, byKind, alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, targetType: a.targetType, targetId: a.targetId, message: a.message })), receiptThreshold: threshold, missingReceiptTransactionIds: flagTargets },
    });
  },
});

export const classifyDocumentTool = defineTool({
  name: "classify_document",
  description: "Classify a document by title/extracted fields into a document kind with confidence.",
  riskLevel: "GREEN",
  capabilityKey: "document_classification",
  inputSchema: TASKS["documents.classify"].params,
  async execute(input) {
    const r = classifyDocument({ title: input.title, extracted: input.extracted });
    return ok({
      answer: `"${input.title}" classifies as ${r.kind} (confidence ${r.confidence}; rules: ${r.matchedRules.join(", ") || "none"}).`,
      numbers: [textFigure("Kind", r.kind), textFigure("Confidence", r.confidence)],
      risks: r.confidence < 0.6 ? ["Low confidence: a human should confirm the document kind."] : [],
      confidence: r.confidence,
      structured: { value: r.kind, category: { kind: r.kind, confidence: r.confidence, matchedRules: r.matchedRules } },
    });
  },
});

export const matchReceiptsTool = defineTool({
  name: "match_receipts",
  description: "Propose links between unlinked receipts/bills and outflow transactions (amount, date, vendor).",
  riskLevel: "GREEN",
  capabilityKey: "receipt_matching",
  inputSchema: TASKS["documents.match_receipts"].params,
  async execute(input, ctx) {
    const proposals = matchReceiptsToTransactions(ctx.dataset).filter((p) => {
      const doc = ctx.dataset.documents.find((d) => d.id === p.documentId);
      return doc && (!input.from || doc.date >= input.from) && (!input.to || doc.date <= input.to);
    });
    const auto = proposals.filter((p) => p.autoLinkEligible);
    const unlinkedDocs = ctx.dataset.documents.filter((d) => (d.kind === "RECEIPT" || d.kind === "VENDOR_BILL") && d.linkedTransactionIds.length === 0).length;
    return ok({
      answer: `${proposals.length} receipt→transaction link(s) proposed (${auto.length} at or above the auto-link threshold); ${unlinkedDocs} receipt/bill document(s) remain unlinked.`,
      numbers: [textFigure("Proposed links", proposals.length), textFigure("Auto-link eligible", auto.length), textFigure("Unlinked documents", unlinkedDocs)],
      why: proposals.slice(0, 10).map((p) => `${p.documentId} ↔ ${p.transactionId} (${p.confidence}): ${p.reasons.join(", ")}`),
      confidence: 0.85,
      structured: { value: proposals.length, values: { proposed: proposals.length, autoLinkEligible: auto.length, unlinkedDocuments: unlinkedDocs }, links: proposals },
    }, { sourceIds: proposals.flatMap((p) => [p.documentId, p.transactionId]) });
  },
});

export const retentionTool = defineTool({
  name: "document_retention",
  description: "Retention status for a document kind (computed only from CONFIRMED policy parameters).",
  riskLevel: "GREEN",
  capabilityKey: "retention_management",
  inputSchema: TASKS["documents.retention"].params,
  async execute(input, ctx) {
    const kind = input.kind.toUpperCase().replace(/[\s-]+/g, "_") as DocumentKind;
    if (!DOC_KINDS.includes(kind)) return ok(insufficient([`document kind (one of ${DOC_KINDS.join(", ")})`], `"${input.kind}" is not a known document kind.`));
    const r = retentionFor(kind, ctx.dataset.policies, ctx.asOfDate);
    const count = ctx.dataset.documents.filter((d) => d.kind === kind).length;
    return ok({
      answer: `${kind}: ${r.permanent ? "retained permanently" : r.years !== null ? `${r.years}-year default` : "no retention rule"} — basis ${r.basis}. ${r.note} ${count} document(s) of this kind on file; nothing is ever deleted on an unconfirmed basis.`,
      escalation: r.basis !== "CONFIRMED" ? esc("INSUFFICIENT_INFORMATION", `Retention for ${kind} is ${r.basis}; confirm the policy with the CPA before computing retain-until dates.`, { missingItems: [`retention policy for ${kind}`], relatedConfigKeys: [r.policyKey] }) : undefined,
      numbers: [textFigure("Kind", kind), textFigure("Years", r.permanent ? "permanent" : r.years ?? "UNKNOWN"), textFigure("Basis", r.basis), textFigure("Documents on file", count)],
      confidence: r.basis === "CONFIRMED" ? 0.9 : 0.7,
      sourceLayers: ["COMPANY"],
      structured: { value: r.years, values: { years: r.years, documents: count }, kind, basis: r.basis, permanent: r.permanent, retainUntil: r.retainUntil, policyKey: r.policyKey },
    });
  },
});

export const documentsTools = [missingDocumentsTool, classifyDocumentTool, matchReceiptsTool, retentionTool];
