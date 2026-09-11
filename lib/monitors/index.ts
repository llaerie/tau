/**
 * Proactive monitors → attention queue.
 *
 * `MONITORS` is the ordered registry; `runMonitors` executes a subset deterministically and
 * `buildAttentionQueue` returns the sorted items (severity desc) while persisting the
 * calculations the monitors produced so every number in the queue is traceable.
 */
import type { LabRuntime } from "@/lib/db/runtime";
import type { CalcResult, ID, ISODate } from "@/lib/core/types";
import { mergeBibleFields } from "@/lib/knowledge/finance-bible";
import { makeItem, sortItems } from "./helpers";
import { accountNotReconciled } from "./monitors/account-not-reconciled";
import { budgetOverrun } from "./monitors/budget-overrun";
import { duplicateVendorPayment } from "./monitors/duplicate-vendor-payment";
import { employeeCostChanged } from "./monitors/employee-cost-changed";
import { expenseTrendIncreasing } from "./monitors/expense-trend-increasing";
import { financeSetupIncomplete } from "./monitors/finance-setup-incomplete";
import { forecastDeteriorating } from "./monitors/forecast-deteriorating";
import { internationalWorkerReview } from "./monitors/international-worker-review";
import { invoiceOverdue } from "./monitors/invoice-overdue";
import { lowProjectedCash } from "./monitors/low-projected-cash";
import { payrollUpcoming } from "./monitors/payroll-upcoming";
import { personalBusinessMixing } from "./monitors/personal-business-mixing";
import { receiptMissing } from "./monitors/receipt-missing";
import { relatedPartyFlow } from "./monitors/related-party-flow";
import { revenuePaymentMissing } from "./monitors/revenue-payment-missing";
import { statementsNotReconciling } from "./monitors/statements-not-reconciling";
import { taxDeadlineApproaching } from "./monitors/tax-deadline-approaching";
import { unknownTransaction } from "./monitors/unknown-transaction";
import { unusualExpense } from "./monitors/unusual-expense";
import type { AttentionItem, Monitor, MonitorContext, MonitorRunResult } from "./types";

export * from "./types";
export * from "./helpers";
export { CASH_RESERVE_NOT_SET_TITLE, CASH_UNKNOWN_TITLE } from "./monitors/low-projected-cash";
export { TAX_DUE_DATES_PENDING_TITLE } from "./monitors/tax-deadline-approaching";

export const MONITORS: readonly Monitor[] = Object.freeze([
  revenuePaymentMissing,
  invoiceOverdue,
  unusualExpense,
  payrollUpcoming,
  lowProjectedCash,
  budgetOverrun,
  duplicateVendorPayment,
  taxDeadlineApproaching,
  receiptMissing,
  forecastDeteriorating,
  expenseTrendIncreasing,
  accountNotReconciled,
  statementsNotReconciling,
  employeeCostChanged,
  unknownTransaction,
  personalBusinessMixing,
  relatedPartyFlow,
  internationalWorkerReview,
  financeSetupIncomplete,
]);

export const MONITOR_KEYS: readonly string[] = MONITORS.map((m) => m.key);

export function monitorByKey(key: string): Monitor | undefined {
  return MONITORS.find((m) => m.key === key);
}

/** Build the read-only context monitors run against. */
export function buildMonitorContext(rt: LabRuntime, asOf: ISODate = rt.asOfDate): MonitorContext {
  const calcs: CalcResult[] = [];
  const seen = new Set<ID>();
  return {
    dataset: rt.dataset,
    ledger: rt.ledger,
    thresholds: rt.thresholds,
    // The static bible overlaid with the answers persisted in this workspace (synthetic fields never overlay).
    bible: mergeBibleFields(rt.bible, rt.dataset.configFields),
    policies: rt.policies,
    taxRules: rt.taxRules,
    asOf,
    calcs,
    recordCalc(calc) {
      if (!seen.has(calc.id)) {
        seen.add(calc.id);
        calcs.push(calc);
      }
      return calc.id;
    },
  };
}

/** Run the named monitors (default: all) without persisting anything. A failing monitor never hides the others. */
export function runMonitorsInContext(ctx: MonitorContext, keys?: readonly string[]): MonitorRunResult {
  const selected = keys ? MONITORS.filter((m) => keys.includes(m.key)) : [...MONITORS];
  const items: AttentionItem[] = [];
  const monitors: MonitorRunResult["monitors"] = [];
  for (const m of selected) {
    try {
      const out = m.run(ctx);
      items.push(...out);
      monitors.push({ key: m.key, itemCount: out.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      monitors.push({ key: m.key, itemCount: 0, error: message });
      items.push(
        makeItem(ctx, {
          kind: "monitor_error",
          severity: "WARNING",
          title: `Monitor ${m.key} could not run`,
          detail: `${m.description} — failed with: ${message}. Its findings are missing from this queue.`,
          relatedIds: [m.key],
          sourceIds: [],
        }),
      );
    }
  }
  const dedup = new Map<ID, AttentionItem>();
  for (const it of items) if (!dedup.has(it.id)) dedup.set(it.id, it);
  return { asOf: ctx.asOf, items: sortItems([...dedup.values()]), calcs: [...ctx.calcs], monitors };
}

/** Run monitors against a runtime and persist the calculations they produced. */
export async function runMonitors(rt: LabRuntime, asOf: ISODate = rt.asOfDate, keys?: readonly string[]): Promise<MonitorRunResult> {
  const ctx = buildMonitorContext(rt, asOf);
  const result = runMonitorsInContext(ctx, keys);
  if (result.calcs.length) await rt.store.upsertMany("calculations", result.calcs);
  return result;
}

/** The attention queue: every monitor's items, sorted by severity (CRITICAL → WARNING → INFO). */
export async function buildAttentionQueue(rt: LabRuntime, asOf: ISODate = rt.asOfDate): Promise<AttentionItem[]> {
  const result = await runMonitors(rt, asOf);
  return result.items;
}
