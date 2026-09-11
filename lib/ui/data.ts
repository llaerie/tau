/**
 * Server-side data loaders for the console. Every function takes the LabRuntime and
 * returns plain data. All numbers come from deterministic engines (ledger, finance,
 * forecasting); nothing here invents a value — unknowns stay null.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LabRuntime } from "@/lib/db/runtime";
import type { EvalRunSummary, IncomeStatement, BalanceSheet } from "@/lib/core/contracts";
import type { BankAccount, Card, DecimalString, ISODate, CalcResult, Transaction, ApprovalRequest, Worker, Invoice } from "@/lib/core/types";
import { add, sub, D, isNeg, gt, ratio } from "@/lib/core/money";
import { addDays, addMonths, monthEnd, monthKey, monthStart } from "@/lib/core/dates";
import { arAging, apAging, type AgingReport } from "@/lib/finance/aging";
import { burnRate, cashRunway, cashReserveCoverage, currentRatio, type ReserveCoverage } from "@/lib/finance/cash";
import { grossMargin, netMargin } from "@/lib/finance/margins";
import { buildThirteenWeekForecast, delayedReceiptScenario, stressTest, flowsFromDataset, type ThirteenWeekForecast, type ThirteenWeekInput } from "@/lib/forecasting/thirteen-week";
import { detectPayrollCadence, projectPayDates } from "@/lib/forecasting/drivers";
import { LAB_SNAPSHOT_PATH } from "@/lib/db/index";
import { CASH_UNKNOWN_LABEL, COMPANY_SNAPSHOT_PATH, currentWorkspace, hasBookData, type Workspace } from "@/lib/db/workspace";
import { openingCashUnknownAssumption } from "@/lib/monitors/helpers";

export { CASH_UNKNOWN_LABEL, hasBookData };

export interface AccountBalance {
  id: string;
  name: string;
  institution: string;
  kind: "BANK" | "CARD";
  last4: string;
  currency: string;
  balance: DecimalString;
  isSynthetic: boolean;
}

export interface CashPosition {
  asOf: ISODate;
  accounts: AccountBalance[];
  /** Structural 0.0000 when `known` is false — never display it as a balance then. */
  totalCash: DecimalString;
  cardBalances: DecimalString;
  /** false when the ledger has no posted activity: cash is UNKNOWN (no bank data), not 0.00. */
  known: boolean;
}

/** Display string for a cash figure that respects `known`. */
export function cashLabel(cash: Pick<CashPosition, "known">, value: DecimalString | null | undefined, format: (v: DecimalString) => string): string {
  return cash.known && value !== null && value !== undefined ? format(value) : CASH_UNKNOWN_LABEL;
}

export function cashPosition(rt: LabRuntime, asOf: ISODate = rt.asOfDate): CashPosition {
  const known = hasBookData(rt.dataset);
  const banks = rt.dataset.bankAccounts.map<AccountBalance>((b: BankAccount) => ({
    id: b.id,
    name: b.name,
    institution: b.institution,
    kind: "BANK",
    last4: b.last4,
    currency: b.currency,
    balance: rt.ledger.accountBalance(b.glAccountId, asOf),
    isSynthetic: b.isSynthetic,
  }));
  const cards = rt.dataset.cards.map<AccountBalance>((c: Card) => ({
    id: c.id,
    name: c.name,
    institution: c.issuer,
    kind: "CARD",
    last4: c.last4,
    currency: c.currency,
    balance: rt.ledger.accountBalance(c.glAccountId, asOf),
    isSynthetic: c.isSynthetic,
  }));
  // Totals are over distinct GL accounts: two registered accounts sharing a GL must not double-count.
  const uniqueGl = (list: (BankAccount | Card)[]) => Array.from(new Map(list.map((x) => [x.glAccountId, x])).values());
  const totalCash = uniqueGl(rt.dataset.bankAccounts).reduce((acc, b) => add(acc, rt.ledger.accountBalance(b.glAccountId, asOf)), "0.0000");
  const cardBalances = uniqueGl(rt.dataset.cards).reduce((acc, c) => add(acc, rt.ledger.accountBalance(c.glAccountId, asOf)), "0.0000");
  return { asOf, accounts: [...banks, ...cards], totalCash, cardBalances, known };
}

export interface ThirteenWeekOptions {
  delayDays?: number;
  receiptHaircut?: number;
  extraDisbursement?: { amount: DecimalString; date?: ISODate; label?: string };
}

export function thirteenWeekInput(rt: LabRuntime, asOf: ISODate = rt.asOfDate): ThirteenWeekInput {
  const flows = flowsFromDataset(rt.dataset, asOf, { weeks: 13 });
  const cash = cashPosition(rt, asOf);
  if (!cash.known) flows.assumptions.unshift(openingCashUnknownAssumption());
  return {
    asOfDate: asOf,
    openingCash: cash.totalCash,
    weeks: 13,
    receipts: flows.receipts,
    disbursements: flows.disbursements,
    minimumCash: rt.thresholds.minimumCashReserve,
    assumptions: flows.assumptions,
    sourceIds: cash.accounts.map((a) => a.id),
  };
}

export function thirteenWeek(rt: LabRuntime, opts: ThirteenWeekOptions = {}, asOf: ISODate = rt.asOfDate): ThirteenWeekForecast {
  const input = thirteenWeekInput(rt, asOf);
  if (opts.delayDays && opts.delayDays > 0) return delayedReceiptScenario(input, opts.delayDays);
  if ((opts.receiptHaircut && opts.receiptHaircut > 0) || opts.extraDisbursement) {
    return stressTest(input, { receiptHaircut: opts.receiptHaircut, extraDisbursement: opts.extraDisbursement });
  }
  return buildThirteenWeekForecast(input);
}

export interface MonthPoint {
  month: string;
  revenue: DecimalString;
  expenses: DecimalString;
  netIncome: DecimalString;
}

export function monthlyPnl(rt: LabRuntime, months = 12, asOf: ISODate = rt.asOfDate): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = monthStart(addMonths(monthStart(asOf), -i));
    const end = i === 0 ? asOf : monthEnd(start);
    const is = rt.ledger.incomeStatement(start, end);
    out.push({ month: monthKey(start), revenue: is.revenue, expenses: add(is.costOfRevenue, is.operatingExpenses), netIncome: is.netIncome });
  }
  return out;
}

export interface RevenueMtd {
  month: string;
  actual: DecimalString;
  budget: DecimalString | null;
  variance: DecimalString | null;
  budgetName: string | null;
}

export function activeBudget(rt: LabRuntime) {
  const approved = rt.dataset.budgets.filter((b) => b.status === "APPROVED").sort((a, b) => b.version - a.version);
  return approved[0] ?? [...rt.dataset.budgets].sort((a, b) => b.version - a.version)[0] ?? null;
}

export function revenueMtd(rt: LabRuntime, asOf: ISODate = rt.asOfDate): RevenueMtd {
  const month = monthKey(asOf);
  const is = rt.ledger.incomeStatement(monthStart(asOf), asOf);
  const budget = activeBudget(rt);
  let budgetAmt: DecimalString | null = null;
  if (budget) {
    const revenueIds = new Set(rt.dataset.accounts.filter((a) => a.type === "REVENUE").map((a) => a.id));
    const lines = budget.lines.filter((l) => l.month === month && revenueIds.has(l.accountId));
    if (lines.length) budgetAmt = lines.reduce((acc, l) => add(acc, l.amount), "0.0000");
  }
  return { month, actual: is.revenue, budget: budgetAmt, variance: budgetAmt ? sub(is.revenue, budgetAmt) : null, budgetName: budget?.name ?? null };
}

export function arReport(rt: LabRuntime, asOf: ISODate = rt.asOfDate): CalcResult<AgingReport> {
  return arAging(rt.dataset.invoices, asOf, rt.dataset.customers);
}

export function apReport(rt: LabRuntime, asOf: ISODate = rt.asOfDate): CalcResult<AgingReport> {
  return apAging(rt.dataset.bills, asOf, rt.dataset.vendors);
}

export interface NextPayroll {
  date: ISODate | null;
  cadence: string;
  expectedEmployerCost: DecimalString | null;
  expectedNetPay: DecimalString | null;
  basis: string;
}

export function nextPayroll(rt: LabRuntime, asOf: ISODate = rt.asOfDate): NextPayroll {
  const pattern = detectPayrollCadence(rt.dataset.payrollRuns);
  const dates = projectPayDates(pattern, asOf, addDays(asOf, 62));
  const last = [...rt.dataset.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => (a.payDate < b.payDate ? 1 : -1))[0];
  return {
    date: dates[0] ?? null,
    cadence: pattern.cadence,
    expectedEmployerCost: last?.totals.totalEmployerCost ?? null,
    expectedNetPay: last?.totals.netPay ?? null,
    basis: last ? `Projected from the ${pattern.cadence.toLowerCase().replace("_", "-")} pattern; amounts mirror the last run (${last.payDate}).` : "No payroll history.",
  };
}

export interface RunwayInfo {
  burn: CalcResult<DecimalString | null>;
  runway: CalcResult<number | null>;
  reserve: CalcResult<ReserveCoverage | null>;
}

export function runwayInfo(rt: LabRuntime, asOf: ISODate = rt.asOfDate): RunwayInfo {
  const position = cashPosition(rt, asOf);
  const points = [];
  if (position.known) {
    for (let i = 3; i >= 0; i--) {
      const m = addMonths(monthStart(asOf), -i);
      const end = i === 0 ? asOf : monthEnd(m);
      points.push({ month: monthKey(m), balance: cashPosition(rt, end).totalCash });
    }
  }
  // With no posted activity there is no history and no balance: every result is INSUFFICIENT_INFORMATION.
  const burn = burnRate({ monthlyCashBalances: points, months: 3, asOfDate: asOf });
  const cash = position.known ? position.totalCash : null;
  const runway = cashRunway({ cash, burnRate: burn.value, asOfDate: asOf });
  const reserve = cashReserveCoverage({ cash, minimumReserve: rt.thresholds.minimumCashReserve, asOfDate: asOf, policyStatus: rt.thresholds.minimumCashReserve === null ? "UNCONFIRMED" : rt.thresholds.status === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED" });
  return { burn, runway, reserve };
}

// ---------------------------------------------------------------------------
// Fallbacks for concurrently-built modules (clearly labelled as local)
// ---------------------------------------------------------------------------

export interface AttentionItem {
  id: string;
  severity: "RED" | "YELLOW" | "GREEN" | "INFO";
  title: string;
  detail: string;
  href?: string;
  kind: string;
}

export function localAttentionQueue(rt: LabRuntime, asOf: ISODate = rt.asOfDate): AttentionItem[] {
  const items: AttentionItem[] = [];
  const ds = rt.dataset;
  if (!hasBookData(ds)) items.push({ id: "books:empty", severity: "INFO", kind: "BOOKS", title: "No posted entries yet — cash and balances are unknown", detail: ds.bankAccounts.length || ds.cards.length ? "Enter or import bank/card transactions, then post opening balances." : "Add bank accounts and cards on Company setup, then enter or import transactions.", href: ds.bankAccounts.length || ds.cards.length ? "/transactions" : "/company?tab=accounts" });
  const pending = ds.approvals.filter((a: ApprovalRequest) => a.status === "PENDING");
  for (const a of pending.slice(0, 5)) {
    items.push({ id: `apr:${a.id}`, severity: a.risk.level === "RED" ? "RED" : "YELLOW", kind: "APPROVAL", title: `Approval pending: ${a.action.kind}`, detail: a.action.description, href: "/approvals" });
  }
  const ar = arReport(rt, asOf).value;
  for (const inv of ar.overdue.slice(0, 5)) {
    items.push({ id: `inv:${inv.id}`, severity: inv.daysPastDue > 60 ? "RED" : "YELLOW", kind: "AR_OVERDUE", title: `Invoice ${inv.number} overdue ${inv.daysPastDue} days`, detail: `${inv.counterpartyName} — open ${inv.openAmount}`, href: "/ar" });
  }
  const uncategorized = ds.transactions.filter((t: Transaction) => t.category.status === "UNCATEGORIZED");
  if (uncategorized.length) items.push({ id: "tx:uncategorized", severity: "YELLOW", kind: "BOOKKEEPING", title: `${uncategorized.length} uncategorized transactions`, detail: "Exception queue needs review.", href: "/transactions?tab=exceptions" });
  const flagged = ds.transactions.filter((t) => t.flags.includes("POSSIBLE_PERSONAL") || t.flags.includes("POSSIBLE_DUPLICATE"));
  if (flagged.length) items.push({ id: "tx:flagged", severity: "YELLOW", kind: "BOOKKEEPING", title: `${flagged.length} transactions flagged personal/duplicate`, detail: "Personal/business separation and duplicate checks.", href: "/transactions?tab=exceptions" });
  const unresolved = ds.workers.filter((w: Worker) => w.classificationStatus !== "CONFIRMED" || w.internationalReview?.status === "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED");
  for (const w of unresolved) {
    items.push({ id: `worker:${w.id}`, severity: "RED", kind: "WORKFORCE", title: `Worker classification unresolved: ${w.displayName}`, detail: "Cross-border professional review required. Not an AI decision.", href: "/payroll" });
  }
  const unknownDue = ds.taxObligations.filter((o) => o.dueDate === null);
  if (unknownDue.length) items.push({ id: "tax:unknown-due", severity: "YELLOW", kind: "TAX", title: `${unknownDue.length} tax obligations with unknown due dates`, detail: "Pending authoritative source retrieval + CPA confirmation.", href: "/tax" });
  const drafts = ds.journalEntries.filter((e) => e.status === "DRAFT" || e.status === "PENDING_APPROVAL");
  if (drafts.length) items.push({ id: "je:drafts", severity: "INFO", kind: "ACCOUNTING", title: `${drafts.length} journal entries awaiting posting`, detail: "Drafts and pending-approval entries.", href: "/accounting?tab=journal" });
  const integrity = rt.ledger.runIntegrityChecks(asOf);
  if (!integrity.passed) items.push({ id: "integrity", severity: "RED", kind: "CONTROLS", title: "Ledger integrity checks failing", detail: integrity.checks.filter((c) => !c.passed).map((c) => c.label).join("; "), href: "/accounting?tab=integrity" });
  const order = { RED: 0, YELLOW: 1, GREEN: 2, INFO: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface HealthMetric {
  key: string;
  label: string;
  value: string;
  status: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  note: string;
  calcId?: string;
}

export interface HealthScorecard {
  asOf: ISODate;
  overall: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  metrics: HealthMetric[];
  source: string;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function fmtCash(v: DecimalString): string {
  return `$${D(v).toFixed(2)}`;
}

export function localFinancialHealth(rt: LabRuntime, asOf: ISODate = rt.asOfDate): HealthScorecard {
  const ytdStart = `${asOf.slice(0, 4)}-01-01`;
  const is: IncomeStatement = rt.ledger.incomeStatement(ytdStart, asOf);
  const bs: BalanceSheet = rt.ledger.balanceSheet(asOf);
  const gm = grossMargin(is);
  const nm = netMargin(is);
  const cr = currentRatio(bs);
  const rw = runwayInfo(rt, asOf);
  const books = hasBookData(rt.dataset);
  const ar = arReport(rt, asOf).value;
  const overdueRatio = ratio(ar.overdueTotal, ar.total);
  const integrity = rt.ledger.runIntegrityChecks(asOf);
  const metrics: HealthMetric[] = [
    { key: "gross_margin", label: "Gross margin (YTD)", value: pct(gm.value), status: gm.value === null ? "UNKNOWN" : gm.value >= 0.5 ? "GREEN" : gm.value >= 0.3 ? "YELLOW" : "RED", note: gm.formula, calcId: gm.id },
    { key: "net_margin", label: "Net margin (YTD)", value: pct(nm.value), status: nm.value === null ? "UNKNOWN" : nm.value >= 0.1 ? "GREEN" : nm.value >= 0 ? "YELLOW" : "RED", note: nm.formula, calcId: nm.id },
    { key: "cash", label: "Cash", value: books ? fmtCash(bs.cash) : CASH_UNKNOWN_LABEL, status: books ? (isNeg(bs.cash) ? "RED" : "GREEN") : "UNKNOWN", note: books ? "sum of cash GL balances (posted entries)" : "no posted entries — nothing to score" },
    { key: "current_ratio", label: "Current ratio", value: !books || cr.value === null ? "—" : cr.value.toFixed(2), status: !books || cr.value === null ? "UNKNOWN" : cr.value >= 1.5 ? "GREEN" : cr.value >= 1 ? "YELLOW" : "RED", note: books ? cr.formula : "no posted entries", calcId: cr.id },
    {
      key: "runway",
      label: "Cash runway",
      value: rw.runway.value === null ? (rw.burn.value !== null && !gt(rw.burn.value, 0) ? "Cash-flow positive" : books ? "—" : CASH_UNKNOWN_LABEL) : `${rw.runway.value.toFixed(1)} months`,
      status: rw.runway.value === null ? (rw.burn.value !== null && !gt(rw.burn.value, 0) ? "GREEN" : "UNKNOWN") : rw.runway.value >= 6 ? "GREEN" : rw.runway.value >= 3 ? "YELLOW" : "RED",
      note: rw.runway.formula,
      calcId: rw.runway.id,
    },
    { key: "ar_overdue", label: "AR overdue share", value: pct(overdueRatio), status: overdueRatio === null ? "GREEN" : overdueRatio <= 0.1 ? "GREEN" : overdueRatio <= 0.3 ? "YELLOW" : "RED", note: "overdue_total / open_ar_total" },
    { key: "reserve", label: "Cash reserve policy", value: rt.thresholds.minimumCashReserve === null ? "Policy not set" : rw.reserve.value?.meetsPolicy ? "Meets policy" : "Below policy", status: rt.thresholds.minimumCashReserve === null ? "UNKNOWN" : rw.reserve.value?.meetsPolicy ? "GREEN" : "RED", note: rw.reserve.formula, calcId: rw.reserve.id },
    { key: "integrity", label: "Ledger integrity", value: integrity.passed ? "All checks pass" : `${integrity.checks.filter((c) => !c.passed).length} failing`, status: integrity.passed ? "GREEN" : "RED", note: `${integrity.checks.length} checks as of ${asOf}` },
  ];
  const rank = { RED: 0, YELLOW: 1, UNKNOWN: 2, GREEN: 3 } as const;
  const known = metrics.filter((m) => m.status !== "UNKNOWN");
  const overall = known.length === 0 ? "UNKNOWN" : known.reduce<"GREEN" | "YELLOW" | "RED">((acc, m) => (rank[m.status] < rank[acc] ? (m.status as "GREEN" | "YELLOW" | "RED") : acc), "GREEN");
  return { asOf, overall, metrics, source: "Computed locally from the ledger (lib/workflows.financialHealth not yet available)" };
}

export interface EvalSummaryLite {
  runId: string;
  ranAt: string;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
  source: string;
}

/** Latest eval summary from evals/results/latest-summary.json (fallback when the harness module is absent). */
export function latestEvalSummaryFromDisk(): EvalSummaryLite | null {
  const p = resolve(process.cwd(), "evals", "results", "latest-summary.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { summary?: Partial<EvalRunSummary> } & Partial<EvalRunSummary>;
    const sum = raw.summary ?? raw;
    if (typeof sum.passRate !== "number") return null;
    return { runId: sum.runId ?? "unknown", ranAt: sum.ranAt ?? "", passRate: sum.passRate, total: sum.total ?? 0, passed: sum.passed ?? 0, failed: sum.failed ?? 0, source: "evals/results/latest-summary.json" };
  }
  catch {
    return null;
  }
}

/** Accepts either an EvalRun ({summary, results}) or a bare EvalRunSummary. */
export function evalSummaryOf(raw: unknown): EvalSummaryLite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { summary?: Partial<EvalRunSummary> } & Partial<EvalRunSummary>;
  const sum = r.summary ?? r;
  if (typeof sum.passRate !== "number") return null;
  return { runId: sum.runId ?? "unknown", ranAt: sum.ranAt ?? "", passRate: sum.passRate, total: sum.total ?? 0, passed: sum.passed ?? 0, failed: sum.failed ?? 0, source: "evals/harness" };
}

export function labSnapshotInfo(): { path: string; exists: boolean } {
  return { path: LAB_SNAPSHOT_PATH, exists: existsSync(LAB_SNAPSHOT_PATH) };
}

/** Snapshot info for the active workspace (lab or company). */
export function workspaceSnapshotInfo(workspace: Workspace = currentWorkspace()): { workspace: Workspace; path: string; exists: boolean } {
  const path = workspace === "company" ? COMPANY_SNAPSHOT_PATH : LAB_SNAPSHOT_PATH;
  return { workspace, path, exists: existsSync(path) };
}

export function accountName(rt: LabRuntime, id: string | null | undefined): string {
  if (!id) return "—";
  const a = rt.dataset.accounts.find((x) => x.id === id);
  return a ? `${a.code} · ${a.name}` : id;
}

export function vendorName(rt: LabRuntime, id: string | null | undefined): string {
  if (!id) return "—";
  return rt.dataset.vendors.find((v) => v.id === id)?.name ?? id;
}

export function customerName(rt: LabRuntime, id: string | null | undefined): string {
  if (!id) return "—";
  return rt.dataset.customers.find((c) => c.id === id)?.name ?? id;
}

export function workerName(rt: LabRuntime, id: string | null | undefined): string {
  if (!id) return "—";
  return rt.dataset.workers.find((w) => w.id === id)?.displayName ?? id;
}

export function invoiceOpen(inv: Invoice): DecimalString {
  return sub(inv.total, inv.amountPaid);
}

export function isOutflow(v: DecimalString): boolean {
  return isNeg(v);
}

export function decimalOrNull(v: unknown): DecimalString | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return D(v as string | number).toFixed(4);
  } catch {
    return null;
  }
}
