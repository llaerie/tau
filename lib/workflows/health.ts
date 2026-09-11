/**
 * Financial health score card. Every metric carries the calc id that produced it and a
 * GOOD / WATCH / ACTION status. Unknown inputs stay null — never zero, never a guess.
 */
import { addMonths, monthEnd, monthKey, monthStart, yearOf } from "@/lib/core/dates";
import { D, ratio } from "@/lib/core/money";
import type { DecimalString, ID, ISODate } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import { arAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { burnRate, cashReserveCoverage, cashRunway, type MonthlyCashPoint } from "@/lib/finance/cash";
import { budgetVariance } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { approvedBudgetFor, cashPosition } from "@/lib/monitors/helpers";
import { CalcCollector, persistCalcs } from "./shared";

export type HealthStatus = "GOOD" | "WATCH" | "ACTION";

export interface HealthMetric<T> {
  value: T;
  calcId: ID;
  status: HealthStatus;
  note?: string;
}

export interface FinancialHealth {
  asOf: ISODate;
  isSyntheticData: boolean;
  cash: HealthMetric<DecimalString> & { minimumReserve: DecimalString | null; surplus: DecimalString | null; reserveStatus: "CONFIRMED" | "UNKNOWN" };
  runwayMonths: HealthMetric<number | null> & { burnRate: DecimalString | null };
  arOverdue: HealthMetric<DecimalString> & { count: number; overdueShare: number | null };
  integrityPassed: HealthMetric<boolean> & { failingChecks: string[] };
  unknownConfigCount: HealthMetric<number> & { byRole: Record<string, number> };
  openApprovals: HealthMetric<number> & { red: number; yellow: number };
  budgetVariance: HealthMetric<DecimalString | null> & { budgetId: ID | null; flaggedCount: number | null };
  overall: HealthStatus;
  calcIds: ID[];
}

const worst = (...s: HealthStatus[]): HealthStatus => (s.includes("ACTION") ? "ACTION" : s.includes("WATCH") ? "WATCH" : "GOOD");

export async function financialHealth(rt: LabRuntime, asOf: ISODate = rt.asOfDate): Promise<FinancialHealth> {
  const ds = rt.dataset;
  const calcs = new CalcCollector();

  // Cash & reserve (reserve unknown → null, WATCH)
  const cash = calcs.add(cashPosition(ds, rt.ledger, asOf).calc);
  const reserve = rt.thresholds.minimumCashReserve;
  const coverage = calcs.add(cashReserveCoverage({ cash: cash.value.total, minimumReserve: reserve, asOfDate: asOf, policyStatus: reserve === null ? "UNCONFIRMED" : "CONFIRMED", sourceIds: [cash.id] }));
  const cashMetric: FinancialHealth["cash"] = {
    value: cash.value.total,
    calcId: cash.id,
    minimumReserve: coverage.value?.minimumReserve ?? null,
    surplus: coverage.value?.surplus ?? null,
    reserveStatus: reserve === null ? "UNKNOWN" : "CONFIRMED",
    status: D(cash.value.total).lte(0) ? "ACTION" : coverage.value === null ? "WATCH" : coverage.value.meetsPolicy ? "GOOD" : "ACTION",
    note: coverage.value === null ? "Minimum cash reserve policy not set; coverage cannot be evaluated (null, not zero)." : `Coverage ${coverage.value.coverageRatio ?? "n/a"}× the reserve.`,
  };

  // Burn & runway from trailing monthly cash balances (4 points → 3 flows)
  const points: MonthlyCashPoint[] = [];
  for (let i = 3; i >= 0; i--) {
    const m = monthKey(addMonths(asOf, -i));
    const end = i === 0 ? asOf : monthEnd(`${m}-01`);
    points.push({ month: m, balance: cashPosition(ds, rt.ledger, end).total });
  }
  const burn = calcs.add(burnRate({ monthlyCashBalances: points, months: 3, asOfDate: asOf, sourceIds: [cash.id] }));
  const runway = calcs.add(cashRunway({ cash: cash.value.total, burnRate: burn.value, asOfDate: asOf, sourceIds: [burn.id] }));
  const cashFlowPositive = burn.value !== null && D(burn.value).lte(0);
  const runwayMetric: FinancialHealth["runwayMonths"] = {
    value: runway.value,
    calcId: runway.id,
    burnRate: burn.value,
    status: burn.value === null ? "WATCH" : cashFlowPositive ? "GOOD" : runway.value !== null && runway.value >= 6 ? "GOOD" : runway.value !== null && runway.value >= 3 ? "WATCH" : "ACTION",
    note: burn.value === null ? "Insufficient cash history to compute burn." : cashFlowPositive ? "Cash-flow positive over the trailing 3 months; runway unbounded (null)." : undefined,
  };

  // AR overdue
  const aging = calcs.add(arAging(ds.invoices, asOf, ds.customers));
  const share = ratio(aging.value.overdueTotal, aging.value.total);
  const arMetric: FinancialHealth["arOverdue"] = { value: aging.value.overdueTotal, calcId: aging.id, count: aging.value.overdue.length, overdueShare: share, status: share === null || share === 0 ? "GOOD" : share <= 0.25 ? "WATCH" : "ACTION" };

  // Integrity
  const integrity = rt.ledger.runIntegrityChecks(asOf);
  const failing = integrity.checks.filter((c) => !c.passed);
  const integrityCalc = calcs.add(makeCalc({ name: "ledger_integrity", value: { passed: integrity.passed, failing: failing.map((c) => c.key) }, unit: "OBJECT", formula: "all ERROR-severity integrity checks pass", inputs: { asOf, checks: integrity.checks.map((c) => ({ key: c.key, passed: c.passed, severity: c.severity })) }, asOfDate: asOf }));
  const integrityMetric: FinancialHealth["integrityPassed"] = { value: integrity.passed, calcId: integrityCalc.id, failingChecks: failing.map((c) => c.key), status: integrity.passed ? (failing.length ? "WATCH" : "GOOD") : "ACTION" };

  // Unknown config
  const unknowns = unknownsRegistry(rt.bible).filter((u) => u.status !== "CONFIRMED");
  const byRole: Record<string, number> = {};
  for (const u of unknowns) byRole[u.whoCanAnswer] = (byRole[u.whoCanAnswer] ?? 0) + 1;
  const unknownCalc = calcs.add(makeCalc({ name: "unknown_config_count", value: unknowns.length, unit: "COUNT", formula: "count of finance-setup items with status ≠ CONFIRMED", inputs: { keys: unknowns.map((u) => u.key) }, asOfDate: asOf }));
  const unknownMetric: FinancialHealth["unknownConfigCount"] = { value: unknowns.length, calcId: unknownCalc.id, byRole, status: unknowns.length === 0 ? "GOOD" : unknowns.length <= 5 ? "WATCH" : "ACTION" };

  // Open approvals
  const pending = rt.approvals.pending();
  const red = pending.filter((a) => a.risk.level === "RED").length;
  const yellow = pending.filter((a) => a.risk.level === "YELLOW").length;
  const approvalsCalc = calcs.add(makeCalc({ name: "open_approvals", value: pending.length, unit: "COUNT", formula: "count of PENDING, unexpired approval requests", inputs: { asOf, ids: pending.map((a) => a.id) }, sourceIds: pending.map((a) => a.id), asOfDate: asOf }));
  const approvalsMetric: FinancialHealth["openApprovals"] = { value: pending.length, calcId: approvalsCalc.id, red, yellow, status: pending.length === 0 ? "GOOD" : red ? "ACTION" : "WATCH" };

  // Budget variance (MTD net vs approved budget)
  const budget = approvedBudgetFor(ds, yearOf(asOf));
  let budgetMetric: FinancialHealth["budgetVariance"];
  if (budget) {
    const bv = calcs.add(budgetVariance(actualsByAccountMonth(ds, monthStart(asOf), asOf), budget, { accounts: ds.accounts, materialityRatio: rt.thresholds.varianceRatio, months: [monthKey(asOf)], asOfDate: asOf }));
    const unfavorable = bv.value.flagged.filter((r) => r.favorable === false).length;
    budgetMetric = { value: bv.value.summary.netVariance, calcId: bv.id, budgetId: budget.id, flaggedCount: bv.value.flagged.length, status: unfavorable === 0 ? "GOOD" : unfavorable <= 2 ? "WATCH" : "ACTION", note: "Month-to-date actuals against a full-month budget." };
  } else {
    const none = calcs.add(makeCalc({ name: "budget_variance_unavailable", value: null, unit: "USD", formula: "net variance = (actual revenue − actual expense) − (budget revenue − budget expense)", inputs: { asOf, fiscalYear: yearOf(asOf) }, asOfDate: asOf, notes: ["INSUFFICIENT_INFORMATION: no APPROVED budget for the fiscal year."], assumptions: [{ key: "missing:approved_budget", description: "No approved budget exists.", value: null, status: "UNCONFIRMED" }] }));
    budgetMetric = { value: null, calcId: none.id, budgetId: null, flaggedCount: null, status: "WATCH", note: "No APPROVED budget; variance unknown (null)." };
  }

  await persistCalcs(rt, calcs.calcs);
  return {
    asOf,
    isSyntheticData: ds.profile.isSynthetic,
    cash: cashMetric,
    runwayMonths: runwayMetric,
    arOverdue: arMetric,
    integrityPassed: integrityMetric,
    unknownConfigCount: unknownMetric,
    openApprovals: approvalsMetric,
    budgetVariance: budgetMetric,
    overall: worst(cashMetric.status, runwayMetric.status, arMetric.status, integrityMetric.status, unknownMetric.status, approvalsMetric.status, budgetMetric.status),
    calcIds: calcs.ids,
  };
}
