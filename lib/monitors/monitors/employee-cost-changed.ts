/** Last payroll run's total employer cost vs the prior run, beyond the forecast-change ratio. */
import { abs, sub } from "@/lib/core/money";
import { growthRate } from "@/lib/finance/variance";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const employeeCostChanged: Monitor = {
  key: "employee_cost_changed",
  description: "Payroll total employer cost changed materially versus the prior run.",
  run(ctx): AttentionItem[] {
    const runs = [...ctx.dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => a.payDate.localeCompare(b.payDate));
    if (runs.length < 2) return [];
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    const calc = growthRate({ current: last.totals.totalEmployerCost, prior: prev.totals.totalEmployerCost, asOfDate: ctx.asOf, label: "payroll total employer cost run-over-run", sourceIds: [last.id, prev.id] });
    if (calc.value === null || Math.abs(calc.value) <= ctx.thresholds.forecastChangeRatio) return [];
    const calcId = ctx.recordCalc(calc);
    const headcountDelta = last.lines.length - prev.lines.length;
    return [
      makeItem(ctx, {
        kind: "employee_cost_changed",
        severity: "WARNING",
        title: `Payroll cost ${calc.value > 0 ? "up" : "down"} ${(Math.abs(calc.value) * 100).toFixed(1)}% vs prior run`,
        detail: `Run ${last.payDate}: total employer cost ${last.totals.totalEmployerCost} vs ${prev.totals.totalEmployerCost} on ${prev.payDate} (change ${sub(last.totals.totalEmployerCost, prev.totals.totalEmployerCost)}).${headcountDelta ? ` Worker count changed by ${headcountDelta}.` : ""} Threshold ratio ${ctx.thresholds.forecastChangeRatio}.`,
        amount: abs(sub(last.totals.totalEmployerCost, prev.totals.totalEmployerCost)),
        relatedIds: [last.id, prev.id],
        calcIds: [calcId],
        suggestedTask: { kind: "payroll.reconcile_run", params: { payrollRunId: last.id } },
      }),
    ];
  },
};
