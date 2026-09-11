/** Expense accounts whose last-3-complete-month total grew > 15% over the prior 3 complete months. */
import { addMonths, monthEnd, monthKey, monthsBetween } from "@/lib/core/dates";
import { D, add, gt } from "@/lib/core/money";
import { growthRate } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const TREND_GROWTH_LIMIT = 0.15;
export const TREND_WINDOW_MONTHS = 3;

export const expenseTrendIncreasing: Monitor = {
  key: "expense_trend_increasing",
  description: "Expense accounts growing more than 15% over the trailing 3-month window vs the prior 3 months.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf, thresholds } = ctx;
    const lastComplete = monthKey(addMonths(asOf, -1));
    const firstMonth = monthKey(addMonths(`${lastComplete}-01`, -(TREND_WINDOW_MONTHS * 2 - 1)));
    const months = monthsBetween(firstMonth, lastComplete);
    const actuals = actualsByAccountMonth(dataset, `${firstMonth}-01`, monthEnd(`${lastComplete}-01`));
    const monthsWithData = new Set<string>();
    for (const byMonth of Object.values(actuals)) for (const m of Object.keys(byMonth)) monthsWithData.add(m);
    const available = months.filter((m) => monthsWithData.has(m));
    if (available.length < TREND_WINDOW_MONTHS * 2) return [];
    const recent = months.slice(-TREND_WINDOW_MONTHS);
    const prior = months.slice(0, TREND_WINDOW_MONTHS);
    const items: AttentionItem[] = [];
    for (const acct of dataset.accounts) {
      if (acct.type !== "EXPENSE" || acct.subtype === "SUSPENSE") continue;
      const series = actuals[acct.id];
      if (!series) continue;
      const sum = (ms: string[]) => ms.reduce((acc, m) => add(acc, series[m] ?? 0), "0.0000");
      const recentSum = sum(recent);
      const priorSum = sum(prior);
      if (D(priorSum).lte(0) || !gt(recentSum, thresholds.transactionReviewAmount)) continue;
      const calc = growthRate({ current: recentSum, prior: priorSum, asOfDate: asOf, label: `${acct.code} ${acct.name} ${TREND_WINDOW_MONTHS}m vs prior ${TREND_WINDOW_MONTHS}m`, sourceIds: [acct.id] });
      if (calc.value === null || calc.value <= TREND_GROWTH_LIMIT) continue;
      const calcId = ctx.recordCalc(calc);
      items.push(
        makeItem(ctx, {
          kind: "expense_trend_increasing",
          severity: "WARNING",
          title: `${acct.code} ${acct.name} up ${(calc.value * 100).toFixed(1)}% over the last ${TREND_WINDOW_MONTHS} months`,
          detail: `${recent[0]}–${recent[recent.length - 1]} total ${recentSum} vs ${prior[0]}–${prior[prior.length - 1]} total ${priorSum}. Growth above ${TREND_GROWTH_LIMIT * 100}% deserves an explanation (volume, price, one-off).`,
          amount: recentSum,
          relatedIds: [acct.id],
          calcIds: [calcId],
          suggestedTask: { kind: "fpa.budget_variance", params: { accountCode: acct.code } },
        }),
      );
    }
    return items;
  },
};
