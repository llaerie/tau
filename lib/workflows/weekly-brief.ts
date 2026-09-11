/**
 * Weekly CFO brief: every number is produced by deterministic code and carries a calc id; unknown
 * policy values (cash reserve, tax due dates) are reported as unknown, never guessed.
 */
import { addDays, daysBetween, fmtDate, monthKey, monthStart, nowISO, yearOf } from "@/lib/core/dates";
import { D, add, fmtMoney, money, sub } from "@/lib/core/money";
import type { DecimalString, ID, ISODate, ISODateTime, RiskLevel, Role } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import { missingDocumentAlerts } from "@/lib/documents/missing-documents";
import { arAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { budgetVariance, type VarianceRow } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { buildDefaultDrivers, detectPayrollCadence, projectPayDates } from "@/lib/forecasting/drivers";
import { rollingForecast } from "@/lib/forecasting/forecast";
import { unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { PENDING_DUE_DATE_NOTE } from "@/lib/tax/calendar";
import { SEVERITY_RANK, approvedBudgetFor, buildMonitorContext, cashPosition, receiptThresholdFor, runMonitorsInContext, taxObligationsFor, thirteenWeekFor, type AttentionItem, type CashAccountBalance } from "@/lib/monitors";
import { CalcCollector, expensesByAccount, persistCalcs, revenueReceived, wordCount, type ExpenseRow } from "./shared";

export const WEEKLY_BRIEF_VERSION = "weekly-brief:v1";
export const EXECUTIVE_SUMMARY_MAX_WORDS = 250;

export interface WeeklyBrief {
  version: string;
  asOf: ISODate;
  generatedAt: ISODateTime;
  companyName: string;
  isSyntheticData: boolean;
  cashToday: { accounts: CashAccountBalance[]; total: DecimalString; calcId: ID };
  thirteenWeekLowestCash: { amount: DecimalString; weekStart: ISODate; weekIndex: number; endingCash: DecimalString; minimumCash: DecimalString | null; weeksBelowMinimum: number | null; calcId: ID };
  revenueReceived: { trailing7Days: DecimalString; monthToDate: DecimalString; calcIds: ID[] };
  revenueExpected: { next30Days: DecimalString; overdueTotal: DecimalString; invoices: { id: ID; number: string; customerName: string; dueDate: ISODate; openAmount: DecimalString; daysPastDue: number }[]; calcId: ID };
  expenses: { week: { total: DecimalString; byAccount: ExpenseRow[] }; monthToDate: { total: DecimalString; byAccount: ExpenseRow[] }; calcIds: ID[] };
  payrollUpcoming: { cadence: string; nextPayDates: { date: ISODate; projectedNetPay: DecimalString; projectedTaxDeposits: DecimalString; projectedTotalEmployerCost: DecimalString }[]; lastRunId?: ID; calcId?: ID; note?: string };
  billsUpcoming: { total: DecimalString; bills: { id: ID; number: string; vendorName: string; dueDate: ISODate; openAmount: DecimalString; status: string }[]; calcId: ID };
  taxObligations: { known: { id: ID; kind: string; title: string; jurisdiction: string; dueDate: ISODate; amount: DecimalString | null; daysUntilDue: number }[]; pending: { id: ID; kind: string; title: string; note: string }[] };
  budgetVsActual: { budgetId?: ID; month: string; topVariances: VarianceRow[]; netVariance?: DecimalString; calcId?: ID; note?: string };
  forecastChanges: { activeForecastId?: ID; freshForecastId?: ID; activeForecastNet?: DecimalString; freshForecastNet?: DecimalString; change?: DecimalString; note: string; calcId?: ID };
  topAnomalies: AttentionItem[];
  topDecisions: { approvalId: ID; kind: string; description: string; riskLevel: RiskLevel; requestedApproverRoles: Role[]; requestedAt: ISODateTime; amount?: DecimalString }[];
  missingInformation: { setupItems: { key: string; label: string; whoCanAnswer: Role; status: string }[]; missingDocuments: { id: string; kind: string; severity: string; message: string }[] };
  recommendedActions: { title: string; task?: { kind: string; params?: Record<string, unknown> }; relatedIds: ID[] }[];
  executiveSummary: string;
  attentionQueue: { total: number; critical: number; warning: number; info: number };
  calcIds: ID[];
  sourceIds: ID[];
}

export async function buildWeeklyBrief(rt: LabRuntime, asOf: ISODate = rt.asOfDate): Promise<WeeklyBrief> {
  const ds = rt.dataset;
  const calcs = new CalcCollector();
  const mtdStart = monthStart(asOf);
  const weekStartDate = addDays(asOf, -6);

  // Cash & 13-week
  const tw = thirteenWeekFor(ds, rt.ledger, rt.thresholds, asOf);
  calcs.add(tw.cash.calc);
  calcs.add(tw.forecast.calc);
  const fc = tw.forecast;

  // Revenue received
  const rev7 = calcs.add(revenueReceived(ds, weekStartDate, asOf, "trailing_7_days").calc);
  const revMtd = calcs.add(revenueReceived(ds, mtdStart, asOf, "month_to_date").calc);

  // Revenue expected (open invoices due within 30 days, plus overdue)
  const aging = calcs.add(arAging(ds.invoices, asOf, ds.customers));
  const horizon = addDays(asOf, 30);
  const expectedInvoices = aging.value.items.filter((i) => i.dueDate <= horizon);
  const next30 = expectedInvoices.reduce((acc, i) => add(acc, i.openAmount), money(0));

  // Expenses
  const expWeek = expensesByAccount(ds, weekStartDate, asOf, "week");
  const expMtd = expensesByAccount(ds, mtdStart, asOf, "month_to_date");
  calcs.add(expWeek.calc);
  calcs.add(expMtd.calc);

  // Payroll upcoming (14 days)
  const pattern = detectPayrollCadence(ds.payrollRuns);
  const lastRun = [...ds.payrollRuns].filter((r) => r.status !== "DRAFT").sort((a, b) => a.payDate.localeCompare(b.payDate)).pop();
  let payrollUpcoming: WeeklyBrief["payrollUpcoming"];
  if (lastRun && pattern.cadence !== "UNKNOWN") {
    const dates = projectPayDates(pattern, addDays(asOf, -1), addDays(asOf, 45));
    const taxes = add(lastRun.totals.employeeTaxes, lastRun.totals.employerTaxes);
    const calc = calcs.add(
      makeCalc({
        name: "payroll_upcoming_projection",
        value: { dates, netPay: lastRun.totals.netPay, taxDeposits: taxes, totalEmployerCost: lastRun.totals.totalEmployerCost },
        unit: "USD",
        formula: "next pay dates from detected cadence; amounts = last run totals",
        inputs: { lastRunId: lastRun.id, cadence: pattern.cadence, dates },
        sourceIds: [lastRun.id],
        asOfDate: asOf,
        assumptions: [{ key: "payroll_projection", description: "Next payroll assumed equal to the last run.", value: lastRun.totals.totalEmployerCost, status: "UNCONFIRMED" }],
      }),
    );
    payrollUpcoming = { cadence: pattern.cadence, nextPayDates: dates.map((date) => ({ date, projectedNetPay: lastRun.totals.netPay, projectedTaxDeposits: taxes, projectedTotalEmployerCost: lastRun.totals.totalEmployerCost })), lastRunId: lastRun.id, calcId: calc.id };
  } else {
    payrollUpcoming = { cadence: "UNKNOWN", nextPayDates: [], note: ds.payrollRuns.length ? "Fewer than two non-draft payroll runs; cadence unknown." : "No payroll history in the dataset." };
  }

  // Bills upcoming (30 days, incl. overdue)
  const vendorName = new Map(ds.vendors.map((v) => [v.id, v.name]));
  const openBills = ds.bills
    .filter((b) => ["RECEIVED", "APPROVED", "SCHEDULED"].includes(b.status) && D(sub(b.total, b.amountPaid)).gt(0) && b.dueDate <= horizon)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const billsTotal = openBills.reduce((acc, b) => add(acc, sub(b.total, b.amountPaid)), money(0));
  const billsCalc = calcs.add(makeCalc({ name: "bills_due_30_days", value: billsTotal, unit: "USD", formula: "sum(open amount of RECEIVED/APPROVED/SCHEDULED bills due within 30 days)", inputs: { asOf, billIds: openBills.map((b) => b.id) }, sourceIds: openBills.map((b) => b.id), asOfDate: asOf }));

  // Tax obligations next 60 days
  const taxHorizon = addDays(asOf, 60);
  const obligations = taxObligationsFor(ds, rt.taxRules, asOf).filter((o) => ["UPCOMING", "DUE", "UNKNOWN"].includes(o.status));
  const known = obligations
    .filter((o) => o.dueDate !== null && (o.dueDate as ISODate) <= taxHorizon)
    .map((o) => ({ id: o.id, kind: o.kind, title: o.title, jurisdiction: o.jurisdiction, dueDate: o.dueDate as ISODate, amount: o.amount, daysUntilDue: daysBetween(asOf, o.dueDate as ISODate) }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const pending = obligations.filter((o) => o.dueDate === null).map((o) => ({ id: o.id, kind: o.kind, title: o.title, note: PENDING_DUE_DATE_NOTE }));

  // Budget vs actual (MTD)
  const month = monthKey(asOf);
  const budget = approvedBudgetFor(ds, yearOf(asOf));
  let budgetVsActual: WeeklyBrief["budgetVsActual"];
  if (budget) {
    const actuals = actualsByAccountMonth(ds, mtdStart, asOf);
    const bv = calcs.add(budgetVariance(actuals, budget, { accounts: ds.accounts, materialityRatio: rt.thresholds.varianceRatio, months: [month], asOfDate: asOf }));
    const top = [...bv.value.rows].sort((a, b) => D(b.variance).abs().cmp(D(a.variance).abs()) || a.accountId.localeCompare(b.accountId)).slice(0, 5);
    budgetVsActual = { budgetId: budget.id, month, topVariances: top, netVariance: bv.value.summary.netVariance, calcId: bv.id, note: "Month-to-date actuals against a full-month budget; the month is partial." };
  } else budgetVsActual = { month, topVariances: [], note: "No APPROVED budget for this fiscal year; variance not computed." };

  // Forecast changes
  const active = ds.forecasts.find((f) => f.status === "ACTIVE");
  let forecastChanges: WeeklyBrief["forecastChanges"];
  if (active) {
    const drivers = buildDefaultDrivers(ds, asOf).drivers;
    const fresh = rollingForecast(ds, asOf, active.horizonMonths, drivers, { accounts: ds.accounts });
    calcs.add(fresh.calcs[0]);
    const type = new Map(ds.accounts.map((a) => [a.id, a.type]));
    const months = new Set(active.lines.filter((l) => l.basis === "FORECAST").map((l) => l.month));
    const net = (lines: typeof active.lines) => lines.filter((l) => l.basis === "FORECAST" && months.has(l.month)).reduce((acc, l) => (type.get(l.accountId) === "REVENUE" ? add(acc, l.amount) : type.get(l.accountId) === "EXPENSE" ? sub(acc, l.amount) : acc), money(0));
    const activeNet = net(active.lines);
    const freshNet = net(fresh.forecast.lines);
    const change = sub(freshNet, activeNet);
    const calc = calcs.add(makeCalc({ name: "forecast_change_vs_active", value: { activeNet, freshNet, change }, unit: "USD", formula: "change = fresh forecast net − active forecast net over the active forecast's months", inputs: { activeForecastId: active.id, freshForecastId: fresh.forecast.id, activeNet, freshNet }, sourceIds: [active.id, fresh.forecast.id], asOfDate: asOf }));
    forecastChanges = { activeForecastId: active.id, freshForecastId: fresh.forecast.id, activeForecastNet: activeNet, freshForecastNet: freshNet, change, calcId: calc.id, note: D(change).isZero() ? "Fresh drivers match the active forecast." : `Fresh driver-based forecast net differs from the active forecast by ${change} over ${months.size} month(s).` };
  } else forecastChanges = { note: "No ACTIVE forecast; nothing to compare. Build a rolling forecast to enable forecast-change tracking." };

  // Attention queue & decisions
  const monitorCtx = buildMonitorContext(rt, asOf);
  const queue = runMonitorsInContext(monitorCtx);
  calcs.addAll(queue.calcs);
  const topAnomalies = queue.items.filter((i) => i.severity !== "INFO").slice(0, 3);
  const anomalies = topAnomalies.length ? topAnomalies : queue.items.slice(0, 3);
  const rank: Record<RiskLevel, number> = { RED: 3, YELLOW: 2, GREEN: 1 };
  const topDecisions = rt.approvals
    .pending()
    .sort((a, b) => rank[b.risk.level] - rank[a.risk.level] || a.requestedAt.localeCompare(b.requestedAt))
    .slice(0, 3)
    .map((a) => ({ approvalId: a.id, kind: a.action.kind, description: a.action.description, riskLevel: a.risk.level, requestedApproverRoles: a.requestedApproverRoles, requestedAt: a.requestedAt, amount: a.action.amount?.amount }));

  // Missing information
  const setupItems = unknownsRegistry(rt.bible)
    .filter((u) => u.status !== "CONFIRMED")
    .map((u) => ({ key: u.key, label: u.label, whoCanAnswer: u.whoCanAnswer, status: u.status }));
  const missingDocs = missingDocumentAlerts(ds, { receiptThreshold: receiptThresholdFor(ds.configFields, rt.policies) }).map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, message: a.message }));

  // Recommended actions
  const recommendedActions: WeeklyBrief["recommendedActions"] = [];
  for (const item of queue.items.filter((i) => i.severity !== "INFO").slice(0, 5)) recommendedActions.push({ title: item.title, task: item.suggestedTask, relatedIds: item.relatedIds });
  for (const d of topDecisions) recommendedActions.push({ title: `Decide pending ${d.riskLevel} approval: ${d.description}`, relatedIds: [d.approvalId] });
  if (rt.thresholds.minimumCashReserve === null) recommendedActions.push({ title: "Set the minimum cash reserve policy so cash alerts can be judged against it", task: { kind: "cfo.config_status", params: {} }, relatedIds: ["materiality.minimumCashReserve"] });
  if (setupItems.length) recommendedActions.push({ title: `Answer ${setupItems.length} finance-setup question(s) (${[...new Set(setupItems.map((s) => s.whoCanAnswer))].join(", ")})`, task: { kind: "cfo.config_status", params: {} }, relatedIds: setupItems.slice(0, 5).map((s) => s.key) });

  const counts = { total: queue.items.length, critical: queue.items.filter((i) => i.severity === "CRITICAL").length, warning: queue.items.filter((i) => i.severity === "WARNING").length, info: queue.items.filter((i) => i.severity === "INFO").length };

  const brief: WeeklyBrief = {
    version: WEEKLY_BRIEF_VERSION,
    asOf,
    generatedAt: nowISO(),
    companyName: ds.profile.displayName,
    isSyntheticData: ds.profile.isSynthetic,
    cashToday: { accounts: tw.cash.accounts, total: tw.cash.total, calcId: tw.cash.calc.id },
    thirteenWeekLowestCash: { amount: fc.lowestCash, weekStart: fc.lowestCashWeekStart, weekIndex: fc.lowestCashWeek, endingCash: fc.endingCash, minimumCash: fc.minimumCash, weeksBelowMinimum: fc.weeksBelowMinimum, calcId: fc.calc.id },
    revenueReceived: { trailing7Days: rev7.value, monthToDate: revMtd.value, calcIds: [rev7.id, revMtd.id] },
    revenueExpected: { next30Days: next30, overdueTotal: aging.value.overdueTotal, invoices: expectedInvoices.map((i) => ({ id: i.id, number: i.number, customerName: i.counterpartyName, dueDate: i.dueDate, openAmount: i.openAmount, daysPastDue: i.daysPastDue })), calcId: aging.id },
    expenses: { week: { total: expWeek.total, byAccount: expWeek.byAccount }, monthToDate: { total: expMtd.total, byAccount: expMtd.byAccount }, calcIds: [expWeek.calc.id, expMtd.calc.id] },
    payrollUpcoming,
    billsUpcoming: { total: billsTotal, bills: openBills.map((b) => ({ id: b.id, number: b.number, vendorName: vendorName.get(b.vendorId) ?? b.vendorId, dueDate: b.dueDate, openAmount: sub(b.total, b.amountPaid), status: b.status })), calcId: billsCalc.id },
    taxObligations: { known, pending },
    budgetVsActual,
    forecastChanges,
    topAnomalies: anomalies,
    topDecisions,
    missingInformation: { setupItems, missingDocuments: missingDocs },
    recommendedActions,
    executiveSummary: "",
    attentionQueue: counts,
    calcIds: [],
    sourceIds: [],
  };
  brief.executiveSummary = executiveSummary(brief, rt.thresholds.minimumCashReserve);
  brief.calcIds = calcs.ids;
  brief.sourceIds = calcs.sourceIds;
  await persistCalcs(rt, calcs.calcs);
  return brief;
}

function executiveSummary(b: WeeklyBrief, reserve: DecimalString | null): string {
  const s: string[] = [];
  s.push(`${b.isSyntheticData ? "SYNTHETIC DATA. " : ""}Weekly brief for ${b.companyName} as of ${fmtDate(b.asOf)}.`);
  s.push(`Cash today is ${fmtMoney(b.cashToday.total)} across ${b.cashToday.accounts.length} account(s).`);
  const low = b.thirteenWeekLowestCash;
  if (reserve === null) s.push(`The 13-week forecast bottoms at ${fmtMoney(low.amount)} in the week of ${fmtDate(low.weekStart)}; no cash reserve policy is set, so that cannot be judged against a target.`);
  else s.push(`The 13-week forecast bottoms at ${fmtMoney(low.amount)} in the week of ${fmtDate(low.weekStart)}, ${D(low.amount).lt(D(reserve)) ? "below" : "above"} the ${fmtMoney(reserve)} reserve.`);
  s.push(`Revenue received: ${fmtMoney(b.revenueReceived.trailing7Days)} in the last 7 days and ${fmtMoney(b.revenueReceived.monthToDate)} month-to-date.`);
  s.push(`${fmtMoney(b.revenueExpected.next30Days)} of open invoices is due within 30 days${D(b.revenueExpected.overdueTotal).gt(0) ? `, of which ${fmtMoney(b.revenueExpected.overdueTotal)} is already overdue` : ""}.`);
  const topExp = b.expenses.monthToDate.byAccount[0];
  s.push(`Spending was ${fmtMoney(b.expenses.week.total)} this week and ${fmtMoney(b.expenses.monthToDate.total)} month-to-date${topExp ? `, led by ${topExp.name}` : ""}.`);
  const pay = b.payrollUpcoming.nextPayDates[0];
  if (pay && daysBetween(b.asOf, pay.date) <= 14) s.push(`Next payroll is ${fmtDate(pay.date)}, about ${fmtMoney(pay.projectedTotalEmployerCost)} all-in based on the last run.`);
  else if (pay) s.push(`No payroll falls in the next two weeks; the next run is ${fmtDate(pay.date)}, about ${fmtMoney(pay.projectedTotalEmployerCost)} all-in based on the last run.`);
  else s.push(b.payrollUpcoming.cadence === "UNKNOWN" ? "No payroll date could be projected (cadence unknown)." : "No payroll date falls within the next 45 days.");
  if (b.billsUpcoming.bills.length) s.push(`${b.billsUpcoming.bills.length} bill(s) totalling ${fmtMoney(b.billsUpcoming.total)} fall due within 30 days.`);
  s.push(`Tax: ${b.taxObligations.known.length} obligation(s) due within 60 days; ${b.taxObligations.pending.length} due date(s) are pending authoritative sources and CPA confirmation.`);
  if (b.budgetVsActual.topVariances[0]) {
    const v = b.budgetVsActual.topVariances[0];
    s.push(`Largest budget variance so far this month: ${v.accountName ?? v.accountId} at ${fmtMoney(v.actual)} vs ${fmtMoney(v.budget)} budgeted.`);
  }
  s.push(`Attention queue: ${b.attentionQueue.critical} critical and ${b.attentionQueue.warning} warning item(s)${b.topAnomalies.length ? ` — top: ${b.topAnomalies.map((a) => a.title).join("; ")}` : ""}.`);
  s.push(`${b.topDecisions.length} decision(s) await approval and ${b.missingInformation.setupItems.length} finance-setup item(s) remain unconfirmed.`);
  let text = s.join(" ");
  while (wordCount(text) > EXECUTIVE_SUMMARY_MAX_WORDS && s.length > 4) {
    s.splice(s.length - 3, 1);
    text = s.join(" ");
  }
  return text;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function renderWeeklyBriefMarkdown(b: WeeklyBrief): string {
  const L: string[] = [];
  L.push(`# Weekly CFO Brief — ${b.companyName} — as of ${b.asOf}`);
  if (b.isSyntheticData) L.push("", "> **SYNTHETIC DATA** — this brief is generated from the Phase One lab company; no real money or filings.");
  L.push("", "## Executive summary", "", b.executiveSummary);
  L.push("", "## Cash today", "", `| Account | Balance |`, `|---|---:|`);
  for (const a of b.cashToday.accounts) L.push(`| ${a.name} | ${fmtMoney(a.balance)} |`);
  L.push(`| **Total** | **${fmtMoney(b.cashToday.total)}** |`, "", `13-week lowest cash: **${fmtMoney(b.thirteenWeekLowestCash.amount)}** (week of ${b.thirteenWeekLowestCash.weekStart}); ending cash ${fmtMoney(b.thirteenWeekLowestCash.endingCash)}; minimum reserve ${b.thirteenWeekLowestCash.minimumCash === null ? "NOT SET" : fmtMoney(b.thirteenWeekLowestCash.minimumCash)}.`);
  L.push("", "## Revenue", "", `- Received last 7 days: ${fmtMoney(b.revenueReceived.trailing7Days)}`, `- Received month-to-date: ${fmtMoney(b.revenueReceived.monthToDate)}`, `- Expected next 30 days (open invoices): ${fmtMoney(b.revenueExpected.next30Days)} (overdue ${fmtMoney(b.revenueExpected.overdueTotal)})`);
  for (const i of b.revenueExpected.invoices) L.push(`  - ${i.number} ${i.customerName}: ${fmtMoney(i.openAmount)} due ${i.dueDate}${i.daysPastDue > 0 ? ` (${i.daysPastDue} days overdue)` : ""}`);
  L.push("", "## Expenses", "", `- This week: ${fmtMoney(b.expenses.week.total)}`);
  for (const r of b.expenses.week.byAccount) L.push(`  - ${r.code} ${r.name}: ${fmtMoney(r.amount)}`);
  L.push(`- Month-to-date: ${fmtMoney(b.expenses.monthToDate.total)}`);
  for (const r of b.expenses.monthToDate.byAccount) L.push(`  - ${r.code} ${r.name}: ${fmtMoney(r.amount)}`);
  L.push("", "## Payroll upcoming", "");
  if (b.payrollUpcoming.nextPayDates.length) for (const p of b.payrollUpcoming.nextPayDates) L.push(`- ${p.date}: net pay ${fmtMoney(p.projectedNetPay)}, tax deposits ${fmtMoney(p.projectedTaxDeposits)}, total employer cost ${fmtMoney(p.projectedTotalEmployerCost)} (${b.payrollUpcoming.cadence})`);
  else L.push(`- ${b.payrollUpcoming.note ?? "None within 14 days."}`);
  L.push("", "## Bills upcoming", "");
  if (b.billsUpcoming.bills.length) for (const x of b.billsUpcoming.bills) L.push(`- ${x.number} ${x.vendorName}: ${fmtMoney(x.openAmount)} due ${x.dueDate} (${x.status})`);
  else L.push("- No open bills due within 30 days.");
  L.push("", "## Tax obligations (next 60 days)", "");
  if (b.taxObligations.known.length) for (const t of b.taxObligations.known) L.push(`- ${t.dueDate}: ${t.title} — amount ${t.amount === null ? "UNKNOWN" : fmtMoney(t.amount)}`);
  else L.push("- No obligations with confirmed due dates in the next 60 days.");
  if (b.taxObligations.pending.length) {
    L.push("", `Pending (${b.taxObligations.pending.length}) — ${PENDING_DUE_DATE_NOTE}:`);
    for (const t of b.taxObligations.pending) L.push(`- ${t.title}`);
  }
  L.push("", `## Budget vs actual (${b.budgetVsActual.month})`, "");
  if (b.budgetVsActual.topVariances.length) for (const v of b.budgetVsActual.topVariances) L.push(`- ${v.accountCode ?? ""} ${v.accountName ?? v.accountId}: actual ${fmtMoney(v.actual)} vs budget ${fmtMoney(v.budget)} (${fmtMoney(v.variance)}${v.favorable === null ? "" : v.favorable ? ", favorable" : ", unfavorable"})`);
  else L.push(`- ${b.budgetVsActual.note ?? "No variances."}`);
  L.push("", "## Forecast changes", "", `- ${b.forecastChanges.note}`);
  L.push("", "## Top anomalies", "");
  if (b.topAnomalies.length) for (const a of b.topAnomalies) L.push(`- **${a.severity}** ${a.title} — ${a.detail}`);
  else L.push("- None.");
  L.push("", "## Top decisions", "");
  if (b.topDecisions.length) for (const d of b.topDecisions) L.push(`- [${d.riskLevel}] ${d.description} (approvers: ${d.requestedApproverRoles.join(", ")})`);
  else L.push("- No pending approvals.");
  L.push("", "## Missing information", "");
  for (const s of b.missingInformation.setupItems) L.push(`- ${s.label} — ${s.whoCanAnswer} (${s.status})`);
  for (const d of b.missingInformation.missingDocuments) L.push(`- [${d.severity}] ${d.message}`);
  if (!b.missingInformation.setupItems.length && !b.missingInformation.missingDocuments.length) L.push("- Nothing outstanding.");
  L.push("", "## Recommended actions", "");
  for (const r of b.recommendedActions) L.push(`- ${r.title}${r.task ? ` (${r.task.kind})` : ""}`);
  L.push("", `_Generated ${b.generatedAt}; ${b.calcIds.length} calculations; attention queue ${b.attentionQueue.total} item(s) (${b.attentionQueue.critical} critical). Severity rank: ${Object.keys(SEVERITY_RANK).join(" > ")}._`);
  return L.join("\n");
}
