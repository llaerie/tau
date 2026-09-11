/** Bookkeeping agent: categorization, duplicates, transfers, exception queue, receipt matching. */
import type { RouteRule } from "../intent";
import { classifyTransactionTool, detectDuplicatesTool, exceptionQueueTool, matchTransfersTool } from "../tools/bookkeeping-tools";
import { matchReceiptsTool } from "../tools/documents-tools";
import { Specialist } from "./shared";

const rules: RouteRule[] = [
  { kind: "accounting.detect_duplicates", weight: 2.5, any: [/\bduplicate/i, /\bdouble[- ]?(charg|bill)/i, /\bcharged twice\b/i, /\btwice\b/i], params: (_m, e, _asOf) => ({ windowDays: e.durations.find((d) => d.unit === "DAY")?.value }) },
  { kind: "accounting.match_transfers", weight: 2.5, all: [/\btransfer/i], any: [/\bmatch/i, /\bpair/i, /\bbetween (our |the |company )?accounts\b/i, /\bunmatched\b/i, /\bidentify\b/i], params: (_m, e, _asOf) => ({ from: e.dates[0], to: e.dates[1] }) },
  { kind: "accounting.exception_queue", weight: 2.5, any: [/\bexception(s| queue)\b/i, /\bneeds? review\b/i, /\buncategori[sz]ed\b/i, /\breview queue\b/i, /\bflagged transactions?\b/i, /\bwhat('s| is) (still )?(un)?categori[sz]ed\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
  { kind: "documents.match_receipts", weight: 2.4, all: [/\breceipts?\b/i], any: [/\bmatch/i, /\blink/i, /\battach/i], params: (_m, e, _asOf) => ({ from: e.dates[0], to: e.dates[1] }) },
  { kind: "accounting.classify_transaction", weight: 2, any: [/\bcategori[sz]e\b/i, /\bclassify\b/i, /\bwhat (account|category)\b/i, /\bcode (this|it|the)\b/i, /\bhow (should|do) (i|we) (book|categori[sz]e|code|classify)\b/i, /\bwhich account\b/i, /\bis this (a )?(business|personal|deductible)\b/i, /\btx_[\w-]+/i], params: (m, e, _asOf) => ({ transactionId: e.ids.find((i) => i.startsWith("tx_")), description: m, amount: e.amounts[0] ? (/\brefund|credit\b/i.test(m) ? e.amounts[0] : `-${e.amounts[0]}`) : undefined, date: e.dates[0], sourceKind: /\bcard\b/i.test(m) ? "CARD" : /\b(bank|checking|ach)\b/i.test(m) ? "BANK" : undefined, hasReceipt: /\b(no|without|missing) (a )?receipt\b/i.test(m) ? false : /\bwith (a )?receipt\b/i.test(m) ? true : undefined, notes: m }) },
];

export function createBookkeepingAgent(): Specialist {
  return new Specialist({
    name: "bookkeeping",
    description: "Bookkeeping: transaction categorization, duplicate and transfer detection, receipt matching and the exception queue.",
    keywords: [/\bcategori/i, /\bclassif/i, /\btransaction/i, /\bduplicate/i, /\btransfer/i, /\breceipt/i, /\bmerchant/i, /\bcharge/i, /\bexception/i, /\buncategori/i, /\bvendor\b/i],
    rules,
    tools: [
      [classifyTransactionTool, "accounting.classify_transaction"],
      [detectDuplicatesTool, "accounting.detect_duplicates"],
      [matchTransfersTool, "accounting.match_transfers"],
      [exceptionQueueTool, "accounting.exception_queue"],
      [matchReceiptsTool],
    ],
  });
}
