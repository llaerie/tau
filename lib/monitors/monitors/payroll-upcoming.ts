/** Next pay date(s) within 7 days from the detected cadence, with the amount projected from the last run. */
import { addDays } from "@/lib/core/dates";
import { add } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { detectPayrollCadence, projectPayDates } from "@/lib/forecasting/drivers";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const PAYROLL_LOOKAHEAD_DAYS = 7;

export const payrollUpcoming: Monitor = {
  key: "payroll_upcoming",
  description: "Upcoming payroll within 7 days (cadence detected from history; amount projected from the last run).",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const pattern = detectPayrollCadence(dataset.payrollRuns);
    const lastRun = [...dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => a.payDate.localeCompare(b.payDate)).pop();
    if (!lastRun || pattern.cadence === "UNKNOWN") return [];
    const dates = projectPayDates(pattern, addDays(asOf, -1), addDays(asOf, PAYROLL_LOOKAHEAD_DAYS));
    if (!dates.length) return [];
    const taxes = add(lastRun.totals.employeeTaxes, lastRun.totals.employerTaxes);
    const calc = makeCalc({
      name: "projected_payroll_cash_requirement",
      value: { netPay: lastRun.totals.netPay, taxDeposits: taxes, totalEmployerCost: lastRun.totals.totalEmployerCost },
      unit: "USD",
      formula: "projected = last run net pay; tax deposits = last run employee taxes + employer taxes (deposit timing per confirmed schedule)",
      inputs: { lastRunId: lastRun.id, cadence: pattern.cadence, payDates: dates },
      sourceIds: [lastRun.id],
      asOfDate: asOf,
      assumptions: [{ key: "payroll_projection", description: "Next payroll assumed equal to the last run; changes in hours, headcount or withholding are not known.", value: lastRun.totals.totalEmployerCost, status: "UNCONFIRMED" }],
    });
    const calcId = ctx.recordCalc(calc);
    return dates.map((d) =>
      makeItem(ctx, {
        kind: "payroll_upcoming",
        severity: "INFO",
        title: `Payroll due ${d} (${pattern.cadence.toLowerCase().replace("_", "-")})`,
        detail: `Projected from last run ${lastRun.payDate}: net pay ${lastRun.totals.netPay}, tax deposits ${taxes}, total employer cost ${lastRun.totals.totalEmployerCost}. Payroll execution is simulation-only in Phase One.`,
        amount: lastRun.totals.totalEmployerCost,
        dueDate: d,
        relatedIds: [lastRun.id, d],
        calcIds: [calcId],
        sourceIds: [lastRun.id],
        suggestedTask: { kind: "payroll.calendar", params: { asOf } },
      }),
    );
  },
};
