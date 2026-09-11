/**
 * 13-week minimum cash vs the minimum cash reserve policy. When the policy is unknown (null) the
 * monitor says so (INFO) rather than assuming a reserve; a negative projection is always CRITICAL.
 */
import { D, lt } from "@/lib/core/money";
import { makeItem, thirteenWeekFor } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const CASH_RESERVE_NOT_SET_TITLE = "Cash reserve policy not set";
export const CASH_UNKNOWN_TITLE = "Cash position unknown — no bank data";

export const lowProjectedCash: Monitor = {
  key: "low_projected_cash",
  description: "13-week cash forecast minimum below the confirmed cash reserve policy (or the policy is not set).",
  run(ctx): AttentionItem[] {
    const { forecast, cash } = thirteenWeekFor(ctx.dataset, ctx.ledger, ctx.thresholds, ctx.asOf);
    const calcIds = [ctx.recordCalc(cash.calc), ctx.recordCalc(forecast.calc)];
    const items: AttentionItem[] = [];
    if (!cash.known) {
      // No posted activity: there is no cash balance to judge and no forecast to alarm about.
      items.push(
        makeItem(ctx, {
          kind: "low_projected_cash",
          severity: "INFO",
          title: CASH_UNKNOWN_TITLE,
          detail: "The ledger has no posted entries, so there is no cash balance and the 13-week forecast has no opening position. Nothing is assumed: add bank accounts, then enter or import transactions and post opening balances.",
          relatedIds: ["cash_position"],
          calcIds,
          suggestedTask: { kind: "cash.position", params: { asOf: ctx.asOf } },
        }),
      );
      return items;
    }
    const lowAt = `week of ${forecast.lowestCashWeekStart} (week ${forecast.lowestCashWeek})`;
    if (D(forecast.lowestCash).lt(0)) {
      items.push(
        makeItem(ctx, {
          kind: "low_projected_cash",
          severity: "CRITICAL",
          title: `Projected cash goes negative in the ${lowAt}`,
          detail: `Opening cash ${cash.total}; lowest projected balance ${forecast.lowestCash}. Receipts ${forecast.totalReceipts} vs disbursements ${forecast.totalDisbursements} over ${forecast.weeks} weeks. ${forecast.assumptions.length} assumption(s) apply.`,
          amount: forecast.lowestCash,
          dueDate: forecast.lowestCashWeekStart,
          relatedIds: [forecast.calc.id],
          calcIds,
          suggestedTask: { kind: "cash.thirteen_week", params: { asOf: ctx.asOf } },
        }),
      );
    }
    const reserve = ctx.thresholds.minimumCashReserve;
    if (reserve === null) {
      items.push(
        makeItem(ctx, {
          kind: "low_projected_cash",
          severity: "INFO",
          title: CASH_RESERVE_NOT_SET_TITLE,
          detail: `No confirmed minimum cash reserve exists, so the 13-week low of ${forecast.lowestCash} (${lowAt}) cannot be judged against policy. The system does not assume a reserve; the owner sets it in the finance setup.`,
          amount: forecast.lowestCash,
          dueDate: forecast.lowestCashWeekStart,
          relatedIds: ["materiality.minimumCashReserve"],
          calcIds,
          suggestedTask: { kind: "cfo.config_status", params: {} },
        }),
      );
      return items;
    }
    if (lt(forecast.lowestCash, reserve) && D(forecast.lowestCash).gte(0)) {
      items.push(
        makeItem(ctx, {
          kind: "low_projected_cash",
          severity: "CRITICAL",
          title: `Projected cash falls below the ${reserve} reserve in the ${lowAt}`,
          detail: `Lowest projected balance ${forecast.lowestCash} vs minimum reserve ${reserve}; ${forecast.weeksBelowMinimum ?? 0} week(s) below minimum (first: week ${forecast.firstWeekBelowMinimum}).`,
          amount: forecast.lowestCash,
          dueDate: forecast.lowestCashWeekStart,
          relatedIds: [forecast.calc.id],
          calcIds,
          suggestedTask: { kind: "cash.thirteen_week", params: { asOf: ctx.asOf } },
        }),
      );
    }
    return items;
  },
};
