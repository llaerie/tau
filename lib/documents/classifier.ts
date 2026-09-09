/**
 * Deterministic document-kind classifier from title, tags, mime type and extracted fields.
 * Rules are ordered from most to least specific; confidence reflects rule strength and is
 * never 1.0 (a human may always re-classify).
 */
import type { DocumentKind } from "@/lib/core/types";

export interface ClassifyDocumentInput {
  title: string;
  extracted?: Record<string, unknown>;
  mimeType?: string;
  tags?: string[];
}

export interface DocumentClassification {
  kind: DocumentKind;
  confidence: number;
  matchedRules: string[];
}

interface Rule {
  name: string;
  kind: DocumentKind;
  confidence: number;
  test: (haystack: string, input: ClassifyDocumentInput) => boolean;
}

const has = (h: string, ...needles: (string | RegExp)[]) => needles.some((n) => (typeof n === "string" ? h.includes(n) : n.test(h)));

const RULES: Rule[] = [
  { name: "w9", kind: "W9", confidence: 0.95, test: (h) => has(h, /\bw-?9\b/) },
  { name: "w8", kind: "W8", confidence: 0.95, test: (h) => has(h, /\bw-?8(ben|ben-e|eci|imy)?\b/) },
  { name: "tax_return", kind: "TAX_RETURN", confidence: 0.92, test: (h) => has(h, /\b1120-?s\b/, /\bform 100s\b/, "tax return", /\bschedule k-?1\b/, /\bform 1040\b/) },
  { name: "tax_notice", kind: "TAX_NOTICE", confidence: 0.9, test: (h) => has(h, /\b(irs|ftb|edd|franchise tax board)\b.*\b(notice|letter|cp\d+)\b/, /\b(notice|letter)\b.*\b(irs|ftb|edd|tax)\b/) },
  { name: "entity_document", kind: "ENTITY_DOCUMENT", confidence: 0.9, test: (h) => has(h, "articles of organization", "operating agreement", /\bform 2553\b/, "statement of information", "s election", "ein assignment", "certificate of formation", /\bcp ?575\b/) },
  { name: "payroll_report", kind: "PAYROLL_REPORT", confidence: 0.9, test: (h) => has(h, /\bpayroll\b.*\b(report|register|summary|journal)\b/, /\bpay ?stub/, /\bde ?9c?\b/, /\bform 941\b/, /\bw-?2\b/) },
  { name: "bank_statement", kind: "BANK_STATEMENT", confidence: 0.9, test: (h) => has(h, /\b(bank|checking|savings|account)\b.*\bstatement\b/, /\bstatement\b.*\b(checking|savings)\b/) },
  { name: "card_statement", kind: "CARD_STATEMENT", confidence: 0.9, test: (h) => has(h, /\b(card|credit card|visa|mastercard|amex|american express)\b.*\bstatement\b/, /\bstatement\b.*\b(card|visa|mastercard|amex)\b/) },
  { name: "insurance", kind: "INSURANCE", confidence: 0.85, test: (h) => has(h, "insurance", "certificate of liability", /\bpolicy declarations?\b/, /\bcoi\b/) },
  { name: "cpa_correspondence", kind: "CPA_CORRESPONDENCE", confidence: 0.85, test: (h) => has(h, /\b(cpa|accountant|tax advisor)\b.*\b(memo|letter|email|guidance|correspondence|engagement)\b/, /\b(memo|letter|engagement letter)\b.*\b(cpa|accountant)\b/) },
  { name: "contract", kind: "CONTRACT", confidence: 0.85, test: (h) => has(h, "agreement", "contract", /\bmsa\b/, /\bsow\b/, "statement of work", "terms of service", "engagement letter") },
  { name: "receipt", kind: "RECEIPT", confidence: 0.85, test: (h) => has(h, "receipt", /\border confirmation\b/, /\bpayment confirmation\b/) },
  { name: "customer_invoice_by_direction", kind: "CUSTOMER_INVOICE", confidence: 0.88, test: (h, i) => has(h, "invoice") && (i.extracted?.direction === "OUTBOUND" || !!i.extracted?.customerId || i.tags?.includes("ar") === true) },
  { name: "vendor_bill_by_direction", kind: "VENDOR_BILL", confidence: 0.88, test: (h, i) => has(h, "invoice", "bill") && (i.extracted?.direction === "INBOUND" || !!i.extracted?.vendorId || i.tags?.includes("ap") === true) },
  { name: "bill", kind: "VENDOR_BILL", confidence: 0.7, test: (h) => has(h, /\bbill\b/, /\binvoice from\b/) },
  { name: "invoice_ambiguous", kind: "VENDOR_BILL", confidence: 0.5, test: (h) => has(h, "invoice") },
];

export function classifyDocument(input: ClassifyDocumentInput): DocumentClassification {
  const extractedText = input.extracted ? Object.entries(input.extracted).map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : "";
  const haystack = `${input.title} ${(input.tags ?? []).join(" ")} ${extractedText}`.toLowerCase();
  const matched: string[] = [];
  let best: Rule | null = null;
  for (const r of RULES) {
    if (r.test(haystack, input)) {
      matched.push(r.name);
      if (!best || r.confidence > best.confidence) best = r;
    }
  }
  if (!best) return { kind: "OTHER", confidence: 0.2, matchedRules: [] };
  // Multiple conflicting high-confidence rules reduce confidence.
  const conflicting = matched.filter((m) => RULES.find((r) => r.name === m)!.kind !== best!.kind && RULES.find((r) => r.name === m)!.confidence >= 0.85).length;
  const confidence = Math.max(0.3, Math.round((best.confidence - 0.15 * conflicting) * 100) / 100);
  return { kind: best.kind, confidence, matchedRules: matched };
}
