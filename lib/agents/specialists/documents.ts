/** Documents agent: missing documents, classification, receipt matching, retention. */
import type { RouteRule } from "../intent";
import { classifyDocumentTool, matchReceiptsTool, missingDocumentsTool, retentionTool } from "../tools/documents-tools";
import { Specialist } from "./shared";

const rules: RouteRule[] = [
  { kind: "documents.retention", weight: 3.2, any: [/\bretention\b/i, /\bretain\b/i, /\bhow long (do|should|must) (we|i) keep\b/i, /\bkeep (the )?(receipts|statements|records|documents|returns) for\b/i, /\bcan (we|i) (delete|shred|throw away|discard)\b/i], params: (m) => ({ kind: /\b(receipt|invoice|bill|bank statement|card statement|contract|payroll report|tax notice|tax return|w-?9|w-?8|entity document|insurance|cpa correspondence)s?\b/i.exec(m)?.[1]?.replace(/\s+/g, "_").replace(/-/g, "").toUpperCase().replace("BANK_STATEMENT", "BANK_STATEMENT") ?? "OTHER" }) },
  { kind: "documents.match_receipts", weight: 3, all: [/\breceipts?\b/i], any: [/\bmatch/i, /\blink/i, /\battach/i, /\bpair/i], params: (_m, e, _asOf) => ({ from: e.dates[0], to: e.dates[1] }) },
  { kind: "documents.classify", weight: 3, any: [/\bclassify (this|the|a) (document|file|pdf|upload)\b/i, /\bwhat (kind|type) of document\b/i, /\bwhat is this (document|file)\b/i, /\bdocument (kind|type) for\b/i], params: (m) => ({ title: /["“]([^"”]+)["”]/.exec(m)?.[1] ?? m }) },
  { kind: "documents.missing", weight: 2.8, any: [/\bmissing (receipts?|documents?|docs|paperwork|statements?|contracts?|w-?9s?)\b/i, /\b(receipts?|documents?|docs)\b[^.?!]{0,20}\b(are )?missing\b/i, /\bwhich (receipts?|documents?) (are|do we) (missing|need|lack)\b/i, /\bno receipt\b/i, /\bwithout (a )?receipt\b/i, /\bdocument(ation)? gaps?\b/i, /\bunsupported (transactions|expenses)\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
];

export function createDocumentsAgent(): Specialist {
  return new Specialist({
    name: "documents",
    description: "Documents: missing-document alerts, document classification, receipt matching and retention status.",
    keywords: [/\bdocument/i, /\breceipt/i, /\bstatement/i, /\bcontract/i, /\bw-?9/i, /\bretention/i, /\bpaperwork/i, /\bfile\b/i, /\bupload/i],
    rules,
    tools: [
      [missingDocumentsTool, "documents.missing"],
      [classifyDocumentTool, "documents.classify"],
      [matchReceiptsTool, "documents.match_receipts"],
      [retentionTool, "documents.retention"],
    ],
  });
}
