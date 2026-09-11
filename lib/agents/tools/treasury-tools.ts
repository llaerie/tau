/**
 * Treasury tools: cash position, 13-week forecast (dataset-derived flows), delayed receipt and
 * stress scenarios, burn/runway from monthly cash balances, reserve coverage against the policy
 * (unknown policy → INSUFFICIENT_INFORMATION) and working capital.
 */
import type { ToolContext } from "@/lib/core/contracts";
import type { DecimalString } from "@/lib/core/types";
import { monthEnd, monthKey } from "@/lib/core/dates";
import { D, money } from "@/lib/core/money";
import { burnRate, cashReserveCoverage, cashRunway, currentRatio, quickRatio, workingCapital } from "@/lib/finance/cash";
import { makeCalc } from "@/lib/finance/calc-result";
import { buildThirteenWeekForecast, delayedReceiptScenario, flowsFromDataset, stressTest, type ScheduledFlow, type ThirteenWeekForecast, type ThirteenWeekInput } from "@/lib/forecasting/thirteen-week";
import type { FlowCategory } from "@/lib/forecasting/drivers";
import { MATERIALITY_CONFIG_KEYS } from "@/lib/risk/materiality";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { figure, insufficient, moneyFigure, monthsBefore, ok, textFigure, toDec } from "./common";

export function ledgerCash(ctx: ToolContext, asOf: string): { total: DecimalString; byAccount: { accountId: string; code: string; name: string; balance: DecimalString }[] } {
  const cashAccounts = ctx.dataset.accounts.filter((a) => a.subtype === "CASH" && a.isActive);
  const byAccount = cashAccounts.map((a) => ({ accountId: a.id, code: a.code, name: a.name, balance: ctx.ledger.accountBalance(a.id, asOf) }));
  const total = byAccount.reduce((acc, b) => acc.plus(D(b.balance)), D(0)).toFixed(4);
  return { total, byAccount };
}

export function monthlyCashBalances(ctx: ToolContext, asOf: string, months: number) {
  return monthsBefore(asOf, months + 1).map((m) => ({ month: m, balance: ledgerCash(ctx, monthEnd(`${m}-01`) <= asOf ? monthEnd(`${m}-01`) : asOf).total }));
}

export const cashPositionTool = defineTool({
  name: "cash_position",
  description: "Cash position across bank accounts from the ledger as of a date.",
  riskLevel: "GREEN",
  capabilityKey: "liquidity_monitoring",
  inputSchema: TASKS["cash.position"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    if (!ctx.dataset.bankAccounts.length && ctx.dataset.accounts.every((a) => a.subtype !== "CASH")) return ok(insufficient(["bank accounts"], "No bank accounts or cash accounts are configured, so the cash position is unknown."));
    const cash = ledgerCash(ctx, asOf);
    const calc = makeCalc<DecimalString>({ name: "cash_position", value: cash.total, unit: "USD", formula: "sum(cash account balances) from posted journal entries", inputs: { asOf, accounts: cash.byAccount }, asOfDate: asOf, sourceIds: cash.byAccount.map((b) => b.accountId) });
    const card = ctx.dataset.accounts.find((a) => a.subtype === "CREDIT_CARD");
    const cardBalance = card ? ctx.ledger.accountBalance(card.id, asOf) : null;
    return ok({
      answer: `Cash as of ${asOf}: ${cash.total} across ${cash.byAccount.length} account(s) (${cash.byAccount.map((b) => `${b.name} ${b.balance}`).join("; ")})${cardBalance ? `; card balance owed ${cardBalance}` : ""}.`,
      numbers: [figure("Total cash", calc), ...cash.byAccount.map((b) => moneyFigure(b.name, b.balance)), ...(cardBalance ? [moneyFigure("Credit card owed", cardBalance)] : [])],
      why: ["Balances are ledger balances from posted entries; unreconciled bank activity is not included until categorized."],
      confidence: 0.9,
      structured: { value: cash.total, values: { totalCash: cash.total, cardOwed: cardBalance }, byAccount: cash.byAccount },
    }, { calcs: [calc] });
  },
});

function flowsFromParams(list: { date: string; amount: string | number; label: string; category?: string }[] | undefined, prefix: string): ScheduledFlow[] {
  return (list ?? []).map((f, i) => ({ id: `${prefix}_${i + 1}`, label: f.label, date: f.date, amount: money(f.amount), category: (f.category as FlowCategory | undefined) ?? "OTHER", confidence: "EXPECTED", sourceIds: [] }));
}

export function thirteenWeekInput(ctx: ToolContext, p: { asOf?: string; openingCash?: string | number; receipts?: { date: string; amount: string | number; label: string; category?: string }[]; disbursements?: { date: string; amount: string | number; label: string; category?: string }[]; minimumCash?: string | number }): { input: ThirteenWeekInput; notes: string[] } {
  const asOf = p.asOf ?? ctx.asOfDate;
  const explicit = (p.receipts && p.receipts.length) || (p.disbursements && p.disbursements.length);
  const derived = explicit ? null : flowsFromDataset(ctx.dataset, asOf);
  const openingCash = toDec(p.openingCash) ?? ledgerCash(ctx, asOf).total;
  const minimumCash = toDec(p.minimumCash) ?? ctx.thresholds.minimumCashReserve;
  const input: ThirteenWeekInput = {
    asOfDate: asOf,
    openingCash,
    receipts: derived ? derived.receipts : flowsFromParams(p.receipts, "rcpt"),
    disbursements: derived ? derived.disbursements : flowsFromParams(p.disbursements, "disb"),
    minimumCash,
    assumptions: derived ? derived.assumptions : [],
  };
  const notes = derived ? derived.notes : ["Flows supplied explicitly by the requester."];
  if (minimumCash === null) notes.push("Minimum cash reserve policy is unknown (null); weeks below minimum cannot be evaluated.");
  return { input, notes };
}

function forecastPresentation(f: ThirteenWeekForecast, label: string) {
  return {
    numbers: [moneyFigure("Opening cash", f.openingCash), moneyFigure("Total receipts", f.totalReceipts), moneyFigure("Total disbursements", f.totalDisbursements), moneyFigure("Ending cash", f.endingCash, f.calc.id), moneyFigure(`Lowest cash (week ${f.lowestCashWeek}, ${f.lowestCashWeekStart})`, f.lowestCash), textFigure("Weeks below minimum", f.weeksBelowMinimum === null ? "UNKNOWN (no reserve policy)" : f.weeksBelowMinimum)],
    structured: {
      value: f.endingCash,
      values: { openingCash: f.openingCash, totalReceipts: f.totalReceipts, totalDisbursements: f.totalDisbursements, endingCash: f.endingCash, lowestCash: f.lowestCash, lowestCashWeek: f.lowestCashWeek, weeksBelowMinimum: f.weeksBelowMinimum, firstWeekBelowMinimum: f.firstWeekBelowMinimum, minimumCash: f.minimumCash },
      [label]: { weeks: f.weeks, rows: f.rows.map((r) => ({ weekIndex: r.weekIndex, weekStart: r.weekStart, weekEnd: r.weekEnd, openingCash: r.openingCash, receipts: r.receipts, disbursements: r.disbursements, net: r.net, closingCash: r.closingCash, belowMinimum: r.belowMinimum })), excludedFlows: f.excludedFlows.length },
    },
  };
}

export const thirteenWeekTool = defineTool({
  name: "thirteen_week_cash",
  description: "13-week cash flow forecast from open invoices, bills, payroll pattern, recurring vendors and tax obligations (or explicit flows).",
  riskLevel: "GREEN",
  capabilityKey: "thirteen_week_cash",
  inputSchema: TASKS["cash.thirteen_week"].params,
  async execute(input, ctx) {
    const { input: twi, notes } = thirteenWeekInput(ctx, input);
    const f = buildThirteenWeekForecast(twi);
    const p = forecastPresentation(f, "forecast");
    const risks: string[] = [];
    if (f.weeksBelowMinimum && f.weeksBelowMinimum > 0) risks.push(`Cash falls below the minimum reserve in ${f.weeksBelowMinimum} week(s), first in week ${f.firstWeekBelowMinimum}.`);
    if (D(f.lowestCash).lt(0)) risks.push(`Cash goes negative (lowest ${f.lowestCash} in week ${f.lowestCashWeek}).`);
    if (f.excludedFlows.length) risks.push(`${f.excludedFlows.length} flow(s) fall outside the ${f.weeks}-week horizon and are excluded.`);
    return ok({
      answer: `Starting from ${f.openingCash} on ${f.asOfDate}, the ${f.weeks}-week forecast expects ${f.totalReceipts} in and ${f.totalDisbursements} out, ending at ${f.endingCash}; the low point is ${f.lowestCash} in week ${f.lowestCashWeek} (${f.lowestCashWeekStart}).`,
      why: [...notes, ...f.assumptions.slice(0, 6).map((a) => `[${a.status}] ${a.description}`)],
      risks,
      recommendation: risks.length ? "Review receipts timing (collections) and discretionary disbursements before the low week." : "Liquidity looks adequate across the horizon; refresh weekly.",
      educationKey: "thirteen_week_cash",
      confidence: twi.assumptions.some((a) => a.status !== "CONFIRMED") ? 0.7 : 0.85,
      ...p,
    }, { calcs: [f.calc], assumptions: f.assumptions });
  },
});

export const delayedReceiptTool = defineTool({
  name: "delayed_receipt_scenario",
  description: "What happens to the 13-week cash forecast if a customer pays N days late.",
  riskLevel: "GREEN",
  capabilityKey: "thirteen_week_cash",
  inputSchema: TASKS["cash.delayed_receipt"].params,
  async execute(input, ctx) {
    const { input: twi, notes } = thirteenWeekInput(ctx, input);
    if (!twi.receipts.length) return ok(insufficient(["expected receipts (open invoices or recurring revenue)"], "There are no expected receipts to delay; the forecast has no inflows."));
    const base = buildThirteenWeekForecast(twi);
    const ids = input.receiptLabel ? twi.receipts.filter((r) => r.label.toLowerCase().includes(input.receiptLabel!.toLowerCase())).map((r) => r.id) : "ALL";
    if (ids !== "ALL" && !ids.length) return ok(insufficient([`receipt matching "${input.receiptLabel}"`], `No expected receipt matches "${input.receiptLabel}".`));
    const scenario = delayedReceiptScenario(twi, input.delayDays, ids);
    const delta = D(scenario.lowestCash).minus(D(base.lowestCash)).toFixed(4);
    const p = forecastPresentation(scenario, "scenario");
    return ok({
      answer: `If ${ids === "ALL" ? "all expected receipts" : `${ids.length} receipt(s)`} arrive ${input.delayDays} days late, the low point moves from ${base.lowestCash} (week ${base.lowestCashWeek}) to ${scenario.lowestCash} (week ${scenario.lowestCashWeek}), a change of ${delta}; ending cash ${scenario.endingCash} vs ${base.endingCash} base.`,
      why: [...notes, `Receipts shifted by ${input.delayDays} days; flows pushed beyond the horizon are excluded (${scenario.excludedFlows.length}).`],
      risks: D(scenario.lowestCash).lt(0) ? [`Cash goes negative under the delay (lowest ${scenario.lowestCash}).`] : scenario.weeksBelowMinimum ? [`${scenario.weeksBelowMinimum} week(s) below the reserve under the delay.`] : [],
      confidence: 0.75,
      ...p,
      structured: { ...p.structured, values: { ...p.structured.values, baseLowestCash: base.lowestCash, baseEndingCash: base.endingCash, lowestCashDelta: delta, delayDays: input.delayDays } },
    }, { calcs: [base.calc, scenario.calc], assumptions: scenario.assumptions });
  },
});

export const stressTestTool = defineTool({
  name: "cash_stress_test",
  description: "Cash stress test: haircut receipts and/or add a one-off disbursement to the 13-week forecast.",
  riskLevel: "GREEN",
  capabilityKey: "scenario_analysis",
  inputSchema: TASKS["cash.stress_test"].params,
  async execute(input, ctx) {
    const { input: twi, notes } = thirteenWeekInput(ctx, input);
    const base = buildThirteenWeekForecast(twi);
    const extra = toDec(input.extraDisbursement);
    const scenario = stressTest(twi, { receiptHaircut: input.receiptHaircut, extraDisbursement: extra ? { amount: extra, label: "Stress: extra disbursement" } : undefined });
    const delta = D(scenario.lowestCash).minus(D(base.lowestCash)).toFixed(4);
    const p = forecastPresentation(scenario, "scenario");
    return ok({
      answer: `Stress case (${input.receiptHaircut ? `receipts −${(input.receiptHaircut * 100).toFixed(0)}%` : "no haircut"}${extra ? `, extra ${extra} out` : ""}): lowest cash ${scenario.lowestCash} in week ${scenario.lowestCashWeek} versus ${base.lowestCash} base (${delta}); ending cash ${scenario.endingCash}.`,
      why: notes,
      risks: D(scenario.lowestCash).lt(0) ? [`Cash goes negative under stress (lowest ${scenario.lowestCash}).`] : [],
      confidence: 0.75,
      ...p,
      structured: { ...p.structured, values: { ...p.structured.values, baseLowestCash: base.lowestCash, baseEndingCash: base.endingCash, lowestCashDelta: delta } },
    }, { calcs: [base.calc, scenario.calc], assumptions: scenario.assumptions });
  },
});

export const runwayTool = defineTool({
  name: "cash_runway",
  description: "Burn rate (trailing months of cash change) and runway in months.",
  riskLevel: "GREEN",
  capabilityKey: "liquidity_monitoring",
  inputSchema: TASKS["cash.runway"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const months = input.months ?? 3;
    const cash = toDec(input.cash) ?? ledgerCash(ctx, asOf).total;
    const calcs = [];
    let burn: DecimalString | null = toDec(input.monthlyBurn);
    if (burn === null) {
      const balances = monthlyCashBalances(ctx, asOf, months);
      const hasHistory = ctx.dataset.journalEntries.some((e) => e.status === "POSTED" && e.date < `${balances[0].month}-01`) || balances.some((b) => !D(b.balance).isZero());
      if (!hasHistory) return ok(insufficient(["monthly cash history (at least two month-end balances)"], "I can't compute a burn rate: there is no posted ledger history to derive monthly cash changes, and no burn rate was supplied."));
      const b = burnRate({ monthlyCashBalances: balances, months, asOfDate: asOf, sourceIds: balances.map((x) => `cash:${x.month}`) });
      calcs.push(b);
      burn = b.value;
      if (burn === null) return ok(insufficient(b.assumptions.map((a) => a.description), "Burn rate could not be computed from history."), { calcs });
    }
    const runway = cashRunway({ cash, burnRate: burn, asOfDate: asOf });
    calcs.push(runway);
    const positive = D(burn).lte(0);
    return ok({
      answer: positive ? `Over the trailing ${months} month(s) the company generated cash (net burn ${burn}); runway is unbounded at the current trend. Cash is ${cash}.` : `Cash ${cash} ÷ average monthly burn ${burn} = ${runway.value === null ? "UNKNOWN" : `${runway.value.toFixed(1)} months`} of runway (trailing ${months} months).`,
      numbers: [moneyFigure("Cash", cash), moneyFigure("Monthly burn", burn, calcs[0]?.id), figure("Runway", runway)],
      why: ["Burn = average monthly decrease in ledger cash over the trailing window; runway = cash ÷ burn. Lumpy items (tax payments, annual prepaids) distort short windows."],
      risks: runway.value !== null && runway.value < 6 ? ["Runway under six months — treat as a liquidity warning."] : [],
      educationKey: "cash_runway",
      confidence: 0.8,
      structured: { value: runway.value, values: { cash, monthlyBurn: burn, runwayMonths: runway.value, windowMonths: months } },
    }, { calcs });
  },
});

export const reserveCoverageTool = defineTool({
  name: "cash_reserve_coverage",
  description: "Cash versus the minimum reserve policy; unknown policy → INSUFFICIENT_INFORMATION (never a default).",
  riskLevel: "GREEN",
  capabilityKey: "liquidity_monitoring",
  inputSchema: TASKS["cash.reserve_coverage"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const cash = ledgerCash(ctx, asOf).total;
    const minimum = toDec(input.minimumCash) ?? ctx.thresholds.minimumCashReserve;
    const calc = cashReserveCoverage({ cash, minimumReserve: minimum, asOfDate: asOf, policyStatus: input.minimumCash ? "UNCONFIRMED" : ctx.thresholds.status === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED" });
    if (calc.value === null) {
      return ok({
        ...insufficient(["minimum cash reserve policy"], `Cash is ${cash}, but the minimum cash reserve policy has not been set, so coverage cannot be judged. I won't assume a reserve.`, { numbers: [moneyFigure("Cash", cash)] }),
        escalation: { type: "INSUFFICIENT_INFORMATION", message: "Minimum cash reserve policy is unknown (materiality.minimumCashReserve is null).", missingItems: ["minimum cash reserve policy"], relatedConfigKeys: [MATERIALITY_CONFIG_KEYS.minimumCashReserve], requiredRole: "OWNER" },
        structured: { value: null, values: { cash, minimumReserve: null }, missing: ["minimum cash reserve policy"] },
      }, { calcs: [calc] });
    }
    const v = calc.value;
    return ok({
      answer: `Cash ${v.cash} against a minimum reserve of ${v.minimumReserve}: ${v.meetsPolicy ? "policy met" : "SHORTFALL"} with surplus ${v.surplus} (coverage ${v.coverageRatio === null ? "n/a" : `${v.coverageRatio.toFixed(2)}x`}).`,
      numbers: [moneyFigure("Cash", v.cash), moneyFigure("Minimum reserve", v.minimumReserve), moneyFigure("Surplus / (shortfall)", v.surplus, calc.id), textFigure("Coverage ratio", v.coverageRatio === null ? "n/a" : v.coverageRatio.toFixed(2))],
      risks: v.meetsPolicy ? [] : ["Cash is below the reserve policy; discretionary spending and distributions should pause."],
      confidence: input.minimumCash || ctx.thresholds.status !== "CONFIRMED" ? 0.7 : 0.9,
      structured: { value: v.surplus, values: { cash: v.cash, minimumReserve: v.minimumReserve, surplus: v.surplus, coverageRatio: v.coverageRatio, meetsPolicy: v.meetsPolicy } },
    }, { calcs: [calc] });
  },
});

export const workingCapitalTool = defineTool({
  name: "working_capital",
  description: "Working capital, current ratio and quick ratio from the balance sheet or explicit inputs.",
  riskLevel: "GREEN",
  capabilityKey: "liquidity_monitoring",
  inputSchema: TASKS["cash.working_capital"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const explicit = input.currentAssets !== undefined || input.currentLiabilities !== undefined;
    const liq = explicit ? { currentAssets: toDec(input.currentAssets), currentLiabilities: toDec(input.currentLiabilities), cash: toDec(input.cash), accountsReceivable: toDec(input.receivables), asOfDate: asOf } : ctx.ledger.balanceSheet(asOf);
    const wc = workingCapital(liq);
    const cr = currentRatio(liq);
    const qr = quickRatio(liq);
    if (wc.value === null) return ok(insufficient(wc.assumptions.map((a) => a.description), "Working capital needs current assets and current liabilities."), { calcs: [wc, cr, qr] });
    return ok({
      answer: `Working capital as of ${asOf} is ${wc.value} (current ratio ${cr.value === null ? "n/a" : cr.value.toFixed(2)}, quick ratio ${qr.value === null ? "n/a" : qr.value.toFixed(2)}).`,
      numbers: [figure("Working capital", wc), figure("Current ratio", cr), figure("Quick ratio", qr)],
      why: ["Working capital = current assets − current liabilities; current ratio = CA ÷ CL; quick ratio = (cash + receivables) ÷ CL."],
      risks: D(wc.value).lt(0) ? ["Negative working capital: short-term obligations exceed short-term assets."] : [],
      educationKey: "working_capital",
      confidence: 0.9,
      structured: { value: wc.value, values: { workingCapital: wc.value, currentRatio: cr.value, quickRatio: qr.value } },
    }, { calcs: [wc, cr, qr] });
  },
});

export function currentMonth(ctx: ToolContext): string {
  return monthKey(ctx.asOfDate);
}

export const treasuryTools = [cashPositionTool, thirteenWeekTool, delayedReceiptTool, stressTestTool, runwayTool, reserveCoverageTool, workingCapitalTool];
