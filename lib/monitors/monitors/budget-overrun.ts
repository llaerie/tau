/** Actual vs APPROVED budget for the prior and current month; unfavorable variances beyond the materiality ratio. */
import { addMonths, monthKey, monthStart, yearOf } from "@/lib/core/dates";
import { abs, gte } from "@/lib/core/money";
import { budgetVariance } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { approvedBudgetFor, makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const budgetOverrun: Monitor = {
  key: "budget_overrun",
  description: "Unfavorable actual-vs-approved-budget variances above the materiality ratio (prior month and month-to-date).",
  run(ctx): AttentionItem[] {
    const { dataset, asOf, thresholds } = ctx;
    const budget = approvedBudgetFor(dataset, yearOf(asOf));
    if (!budget) return [];
    const currentMonth = monthKey(asOf);
    const priorMonth = monthKey(addMonths(asOf, -1));
    const actuals = actualsByAccountMonth(dataset, monthStart(addMonths(asOf, -1)), asOf);
    const calc = budgetVariance(actuals, budget, { accounts: dataset.accounts, materialityRatio: thresholds.varianceRatio, months: [priorMonth, currentMonth], asOfDate: asOf });
    const flagged = calc.value.flagged.filter((r) => r.favorable === false);
    if (!flagged.length) return [];
    const calcId = ctx.recordCalc(calc);
    return flagged.map((r) =>
      makeItem(ctx, {
        kind: "budget_overrun",
        severity: gte(abs(r.variance), thresholds.redAmount) ? "CRITICAL" : "WARNING",
        title: `${r.accountCode ?? r.accountId} ${r.accountName ?? ""} ${r.accountType === "REVENUE" ? "below" : "over"} budget in ${r.month}`,
        detail: `Actual ${r.actual} vs budget ${r.budget} (variance ${r.variance}${r.variancePct === null ? "" : `, ${(r.variancePct * 100).toFixed(1)}%`}); materiality ratio ${thresholds.varianceRatio}${thresholds.status !== "CONFIRMED" ? " (UNCONFIRMED lab default)" : ""}.${r.month === currentMonth ? " Current month is partial." : ""} Budget ${budget.name} v${budget.version}.`,
        amount: abs(r.variance),
        relatedIds: [r.accountId, budget.id, r.month],
        calcIds: [calcId],
        sourceIds: [budget.id],
        suggestedTask: { kind: "fpa.budget_variance", params: { accountCode: r.accountCode, month: r.month } },
      }),
    );
  },
};
