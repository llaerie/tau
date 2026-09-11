/**
 * Unusual spend in the trailing 30 days: amount > 3× the merchant's trailing-6-month median, or a
 * merchant never seen before charging at/above the transaction review amount.
 */
import { addDays, addMonths } from "@/lib/core/dates";
import { D, abs, gte, gt, mul } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { isSpendOutflow, makeItem, median, merchantKey } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const UNUSUAL_MULTIPLE = 3;
export const REVIEW_WINDOW_DAYS = 30;

export const unusualExpense: Monitor = {
  key: "unusual_expense",
  description: "Charges far above a merchant's trailing-6-month median, or large charges from a new merchant.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf, thresholds } = ctx;
    const windowStart = addDays(asOf, -REVIEW_WINDOW_DAYS);
    const historyStart = addMonths(asOf, -6);
    const spend = dataset.transactions.filter((t) => isSpendOutflow(t) && t.date >= historyStart && t.date <= asOf);
    const byMerchant = new Map<string, typeof spend>();
    for (const t of spend) {
      const k = merchantKey(t);
      const arr = byMerchant.get(k) ?? [];
      arr.push(t);
      byMerchant.set(k, arr);
    }
    const items: AttentionItem[] = [];
    for (const t of spend) {
      if (t.date < windowStart) continue;
      const amount = abs(t.amount);
      const history = (byMerchant.get(merchantKey(t)) ?? []).filter((h) => h.id !== t.id && h.date < t.date);
      const flaggedLarge = t.flags.includes("LARGE_UNUSUAL");
      if (history.length === 0) {
        if (!gte(amount, thresholds.transactionReviewAmount) && !flaggedLarge) continue;
        items.push(
          makeItem(ctx, {
            kind: "unusual_expense",
            severity: gte(amount, thresholds.redAmount) ? "CRITICAL" : "WARNING",
            title: `New merchant charge: ${t.merchantNormalized ?? t.descriptionRaw} ${amount}`,
            detail: `${t.date}: ${t.descriptionRaw} for ${amount} from a merchant with no prior history in the last 6 months (review amount ${thresholds.transactionReviewAmount}${thresholds.status !== "CONFIRMED" ? ", UNCONFIRMED lab default" : ""}). Category: ${t.category.status}.`,
            amount,
            relatedIds: [t.id],
            suggestedTask: { kind: "accounting.classify_transaction", params: { transactionId: t.id } },
          }),
        );
        continue;
      }
      const med = median(history.map((h) => abs(h.amount)));
      const limit = mul(med, UNUSUAL_MULTIPLE);
      if (!gt(amount, limit) && !flaggedLarge) continue;
      const calc = makeCalc({
        name: "merchant_spend_deviation",
        value: { amount, median: med, multiple: D(med).isZero() ? null : Number(D(amount).div(D(med)).toFixed(2)) },
        unit: "OBJECT",
        formula: "flag when amount > 3 * median(|merchant outflows over trailing 6 months|)",
        inputs: { transactionId: t.id, amount, historyAmounts: history.map((h) => abs(h.amount)) },
        sourceIds: [t.id, ...history.map((h) => h.id)],
        asOfDate: asOf,
      });
      const calcId = ctx.recordCalc(calc);
      items.push(
        makeItem(ctx, {
          kind: "unusual_expense",
          severity: gte(amount, thresholds.redAmount) ? "CRITICAL" : "WARNING",
          title: `Unusual charge: ${t.merchantNormalized ?? t.descriptionRaw} ${amount} vs median ${med}`,
          detail: `${t.date}: ${amount} is more than ${UNUSUAL_MULTIPLE}× this merchant's trailing-6-month median of ${med} (${history.length} prior charge(s)).${flaggedLarge ? " Flagged LARGE_UNUSUAL at import." : ""}`,
          amount,
          relatedIds: [t.id],
          calcIds: [calcId],
          sourceIds: [t.id, ...history.map((h) => h.id)],
          suggestedTask: { kind: "accounting.classify_transaction", params: { transactionId: t.id } },
        }),
      );
    }
    return items;
  },
};
