/** Bank / card reconciliation for the prior month end: any difference or unmatched item is an alert. */
import { addMonths, monthEnd, monthKey } from "@/lib/core/dates";
import { reconcileAllAccounts } from "@/lib/accounting/reconciliation";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const accountNotReconciled: Monitor = {
  key: "account_not_reconciled",
  description: "Bank or card account not reconciled to the GL at the prior month end.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const priorEnd = monthEnd(addMonths(asOf, -1));
    const month = monthKey(priorEnd);
    const names = new Map<string, string>([...dataset.bankAccounts.map((b) => [b.id, b.name] as [string, string]), ...dataset.cards.map((c) => [c.id, c.name] as [string, string])]);
    const items: AttentionItem[] = [];
    for (const rec of reconcileAllAccounts(dataset, priorEnd)) {
      const hasActivity = dataset.transactions.some((t) => t.sourceAccountId === rec.sourceAccountId && t.date <= priorEnd) || rec.unmatchedJournalLines.length > 0;
      if (rec.reconciled || !hasActivity) continue;
      items.push(
        makeItem(ctx, {
          kind: "account_not_reconciled",
          severity: "WARNING",
          title: `${names.get(rec.sourceAccountId) ?? rec.sourceAccountId} not reconciled for ${month}`,
          detail: `GL ${rec.glBalance} vs statement-side ${rec.bankBalance} (difference ${rec.difference}); ${rec.unmatchedTransactions.length} unmatched transaction(s), ${rec.unmatchedJournalLines.length} unmatched journal line(s) as of ${priorEnd}.`,
          amount: rec.difference.startsWith("-") ? rec.difference.slice(1) : rec.difference,
          dueDate: priorEnd,
          relatedIds: [rec.sourceAccountId, rec.glAccountId, month],
          sourceIds: [rec.sourceAccountId, ...rec.unmatchedTransactions.map((t) => t.id), ...rec.unmatchedJournalLines.map((l) => l.entryId)],
          suggestedTask: { kind: "accounting.bank_reconciliation", params: { accountId: rec.sourceAccountId, asOf: priorEnd } },
        }),
      );
    }
    return items;
  },
};
