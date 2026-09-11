/** Accounts receivable agent. */
import type { RouteRule } from "../intent";
import { arAgingTool, collectionReminderTool, createInvoiceTool, matchPaymentTool } from "../tools/ar-tools";
import { Specialist, nameAfter } from "./shared";

const rules: RouteRule[] = [
  { kind: "ar.collection_reminder", weight: 3.2, any: [/\breminder\b/i, /\bcollection (notice|email|letter)\b/i, /\bchase\b/i, /\bfollow[- ]up (with|on)\b[^.?!]{0,30}\b(invoice|customer|payment)\b/i, /\bnudge\b/i, /\bdunning\b/i], params: (_m, e, _asOf) => ({ invoiceId: e.ids.find((i) => i.startsWith("inv_")) ?? /\bINV-[\w-]+/i.exec(_m)?.[0] ?? "" }) },
  { kind: "ar.match_payment", weight: 3, any: [/\b(match|apply)\b[^.?!]{0,30}\bpayment\b/i, /\breceived (a )?payment\b/i, /\bpayment (of|for) \$?\d[\d,]*.{0,30}(came in|arrived|received|landed|hit the bank)\b/i, /\bcustomer paid\b/i, /\b(harbor|meridian|customer) (sent|paid|wired)\b/i, /\bcash receipt\b/i], params: (m, e, _asOf) => ({ paymentAmount: e.amounts[0], paymentDate: e.dates[0], customerId: e.ids.find((i) => i.startsWith("cust_")), invoiceId: e.ids.find((i) => i.startsWith("inv_")) }) },
  { kind: "ar.create_invoice", weight: 3, any: [/\b(create|draft|issue|send|prepare|raise|generate)\b[^.?!]{0,20}\binvoice\b/i, /\binvoice (the |our )?(customer|client|[A-Z][\w&]+)\b/, /\bbill (the |our )?(customer|client)\b/i], none: [/\bfrom\b/i], params: (m, e, _asOf) => ({ customerId: e.ids.find((i) => i.startsWith("cust_")) ?? nameAfter(m, /(?:to|for)/) ?? "", amount: e.amounts[0], description: m, issueDate: e.dates[0], termsDays: e.durations.find((d) => d.unit === "DAY")?.value }) },
  { kind: "ar.aging", weight: 2.5, any: [/\b(ar|a\/r|receivables?|accounts receivable)\b[^.?!]{0,20}\b(aging|report|outstanding|balance|overdue)\b/i, /\baging\b[^.?!]{0,10}\b(ar|receivables?)\b/i, /\bwho owes (us|the company)\b/i, /\boverdue invoices?\b/i, /\bopen invoices?\b/i, /\bunpaid invoices?\b/i, /\boutstanding invoices?\b/i, /\bcustomers? (who )?(haven'?t|have not) paid\b/i, /\bcollections?\b/i, /\breceivables?\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
];

export function createArAgent(): Specialist {
  return new Specialist({
    name: "ar",
    description: "Accounts receivable: AR aging, payment matching, invoice drafting and collection reminder drafts (never sent automatically).",
    keywords: [/\binvoice/i, /\bcustomer/i, /\breceivable/i, /\bar\b/i, /\bowes?\b/i, /\bcollect/i, /\boverdue\b/i, /\bpayment\b/i, /\bclient\b/i],
    rules,
    tools: [
      [arAgingTool, "ar.aging"],
      [matchPaymentTool, "ar.match_payment"],
      [createInvoiceTool, "ar.create_invoice"],
      [collectionReminderTool, "ar.collection_reminder"],
    ],
  });
}
