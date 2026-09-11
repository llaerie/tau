/** Uncategorized transactions and a non-zero suspense balance. */
import { ACCT } from "@/lib/accounting/chart-of-accounts";
import { abs, gte, isZero } from "@/lib/core/money";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const unknownTransaction: Monitor = {
  key: "unknown_transaction",
  description: "Uncategorized transactions and suspense-account balances that must be resolved before a period can lock.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf, thresholds } = ctx;
    const items: AttentionItem[] = [];
    for (const t of dataset.transactions) {
      if (t.date > asOf) continue;
      if (t.flags.includes("TRANSFER") || t.transferPairId) continue;
      const uncategorized = t.category.status === "UNCATEGORIZED" || t.category.accountId === null || t.flags.includes("UNCATEGORIZED");
      if (!uncategorized) continue;
      items.push(
        makeItem(ctx, {
          kind: "unknown_transaction",
          severity: gte(abs(t.amount), thresholds.redAmount) ? "CRITICAL" : "WARNING",
          title: `Uncategorized: ${t.merchantNormalized ?? t.descriptionRaw} ${t.amount}`,
          detail: `${t.date} ${t.sourceKind} transaction ${t.descriptionRaw} (${t.amount}) has no approved category${t.journalEntryId ? " and sits in suspense" : ""}. The owner must confirm the business purpose; the system does not guess.`,
          amount: abs(t.amount),
          relatedIds: [t.id],
          suggestedTask: { kind: "accounting.classify_transaction", params: { transactionId: t.id } },
        }),
      );
    }
    const suspense = ctx.ledger.getAccount(ACCT.SUSPENSE);
    if (suspense) {
      const bal = ctx.ledger.accountBalance(suspense.id, asOf);
      if (!isZero(bal)) {
        items.push(
          makeItem(ctx, {
            kind: "unknown_transaction",
            severity: "WARNING",
            title: `Suspense account balance ${bal} must be cleared`,
            detail: `Account ${suspense.code} ${suspense.name} holds ${bal} as of ${asOf}. No period can lock while suspense is non-zero.`,
            amount: abs(bal),
            relatedIds: [suspense.id],
            suggestedTask: { kind: "accounting.trial_balance", params: { asOf } },
          }),
        );
      }
    }
    return items;
  },
};
