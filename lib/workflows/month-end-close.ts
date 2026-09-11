/**
 * 21-step month-end close. Steps 1–13 live in close-steps.ts; this file runs steps 14–21
 * (integrity, statements, controller and auditor reviews, exception gate, lock, management
 * report, CPA package), orchestrates the checklist and records the audit event.
 *
 * The period is locked ONLY when `opts.lock` is set, an APPROVED LOCK_PERIOD approval is
 * supplied and no ERROR-level exception remains. Otherwise the result carries `needsApproval`
 * with a ProposedAction the approval engine can route.
 */
import { Ledger } from "@/lib/accounting/ledger";
import { findPeriodById } from "@/lib/accounting/periods";
import { addMonths, monthEnd, monthKey, monthStart, nowISO, yearOf } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { D, money, mul, ratio, sub } from "@/lib/core/money";
import type { Actor, CalcResult, CompanyDataset, ID, ISODate, ProposedAction } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import { apAging, arAging } from "@/lib/finance/aging";
import { currentRatio, quickRatio, workingCapital } from "@/lib/finance/cash";
import { grossMargin, netMargin, operatingMargin } from "@/lib/finance/margins";
import { budgetVariance } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { approvedBudgetFor, cashPosition } from "@/lib/monitors/helpers";
import { STEP_FUNCTIONS_1_TO_13, finishStep } from "./close-steps";
import { CLOSE_STEPS, MONTH_END_CLOSE_VERSION, err, isBlockingException, warn, type CloseContext, type CloseOptions, type CloseResult, type CloseStep, type ManagementReport } from "./close-types";
import { buildCpaPackage } from "./cpa-package";
import { CalcCollector, persistCalcs, statementTotalsCalc, statementsFor, type StatementBundle } from "./shared";

export * from "./close-types";

function skipped(step: number): CloseStep {
  return finishStep(step, ["Skipped by request (opts.skipSteps)."], [], { status: "SKIPPED" });
}

// 14 --------------------------------------------------------------------------
function stepLedgerIntegrity(ctx: CloseContext): CloseStep {
  const report = ctx.rt.ledger.runIntegrityChecks(ctx.end);
  const details = report.checks.map((c) => `${c.passed ? "ok " : "FAIL"} ${c.key}: ${c.label}${c.details ? ` — ${c.details}` : ""}`);
  const exceptions = report.checks.filter((c) => !c.passed).map((c) => (c.severity === "ERROR" ? err(`Integrity ${c.key}: ${c.details ?? c.label}`) : warn(`Integrity ${c.key}: ${c.details ?? c.label}`)));
  return finishStep(14, details, exceptions);
}

// 15 --------------------------------------------------------------------------
function stepPreliminaryStatements(ctx: CloseContext): { step: CloseStep; statements: StatementBundle } {
  const s = statementsFor(ctx.rt.ledger, ctx.start, ctx.end);
  const calc = ctx.calcs.add(statementTotalsCalc(`preliminary_statements_${ctx.periodId}`, s));
  const details = [
    `Revenue ${s.incomeStatement.revenue}; operating expenses ${s.incomeStatement.operatingExpenses}; net income ${s.incomeStatement.netIncome}.`,
    `Total assets ${s.balanceSheet.totalAssets}; liabilities ${s.balanceSheet.totalLiabilities}; equity ${s.balanceSheet.totalEquity}; cash ${s.balanceSheet.cash}.`,
    `Cash flow: operating ${s.cashFlowStatement.operating}, investing ${s.cashFlowStatement.investing}, financing ${s.cashFlowStatement.financing}; closing cash ${s.cashFlowStatement.closingCash}.`,
  ];
  const exceptions: string[] = [];
  if (!s.trialBalance.balanced) exceptions.push(err(`Trial balance does not balance: debits ${s.trialBalance.totalDebits} vs credits ${s.trialBalance.totalCredits}.`));
  if (!s.balanceSheet.balanced) exceptions.push(err(`Balance sheet out of balance by ${s.balanceSheet.difference}.`));
  if (!s.cashFlowStatement.reconciled) exceptions.push(err(`Cash flow statement does not reconcile (difference ${s.cashFlowStatement.difference}).`));
  return { step: finishStep(15, details, exceptions, { calcIds: [calc.id] }), statements: s };
}

// 16 --------------------------------------------------------------------------
function stepControllerReview(ctx: CloseContext, s: StatementBundle): CloseStep {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const priorStart = monthStart(addMonths(ctx.start, -3));
  const priorEnd = monthEnd(addMonths(ctx.start, -1));
  const prior = ctx.rt.ledger.incomeStatement(priorStart, priorEnd);
  const priorMonths = 3;
  const avgRevenue = money(D(prior.revenue).div(priorMonths));
  const avgOpex = money(D(prior.operatingExpenses).div(priorMonths));
  const rev = s.incomeStatement.revenue;
  if (D(avgRevenue).gt(0)) {
    const dev = ratio(sub(rev, avgRevenue), avgRevenue);
    details.push(`Revenue ${rev} vs trailing 3-month average ${avgRevenue} (${dev === null ? "n/a" : `${(dev * 100).toFixed(1)}%`}).`);
    if (dev !== null && Math.abs(dev) > 0.5) exceptions.push(warn(`Revenue ${rev} deviates ${(dev * 100).toFixed(1)}% from the trailing 3-month average ${avgRevenue} (±50% sanity band).`));
  } else details.push(`No trailing revenue history to compare (prior 3 months revenue ${prior.revenue}).`);
  if (D(avgOpex).gt(0) && D(s.incomeStatement.operatingExpenses).gt(mul(avgOpex, 1.5))) exceptions.push(warn(`Operating expenses ${s.incomeStatement.operatingExpenses} exceed 1.5× the trailing average ${avgOpex}.`));
  for (const a of ds.accounts.filter((x) => x.subtype === "CASH")) {
    const bal = ctx.rt.ledger.accountBalance(a.id, ctx.end);
    if (D(bal).lt(0)) exceptions.push(warn(`Cash account ${a.code} ${a.name} is negative (${bal}).`));
  }
  const cardAccts = ds.accounts.filter((x) => x.subtype === "CREDIT_CARD");
  for (const a of cardAccts) {
    const bal = ctx.rt.ledger.accountBalance(a.id, ctx.end);
    if (D(bal).lt(0)) exceptions.push(warn(`Card liability ${a.code} has a debit balance (${bal}); overpayment or mis-posting.`));
  }
  const ar = ctx.rt.ledger.accountBalance(ds.accounts.find((x) => x.subtype === "ACCOUNTS_RECEIVABLE")?.id ?? "acct_1100", ctx.end);
  if (D(rev).gt(0) && D(ar).gt(mul(rev, 3))) exceptions.push(warn(`AR balance ${ar} exceeds 3× monthly revenue ${rev}; collections lagging.`));
  if (D(s.incomeStatement.netIncome).lt(0)) details.push(`Net loss ${s.incomeStatement.netIncome} for the period.`);
  if (D(s.incomeStatement.revenue).isZero()) exceptions.push(warn("No revenue recorded in the period."));
  details.push(`${exceptions.length} sanity finding(s).`);
  return finishStep(16, details, exceptions);
}

// 17 --------------------------------------------------------------------------
export interface IndependentRecomputation {
  ledger: Ledger;
  statements: StatementBundle;
  /** The fresh ledger works on a deep copy: mutating it can never touch the live dataset. */
  isolated: boolean;
}

/** Recompute the period's statements on a structuredClone of the dataset with a brand-new Ledger. */
export function independentRecomputation(dataset: CompanyDataset, start: ISODate, end: ISODate): IndependentRecomputation {
  const clone = structuredClone(dataset);
  const ledger = new Ledger(clone);
  return { ledger, statements: statementsFor(ledger, start, end), isolated: ledger.dataset !== dataset && ledger.dataset.journalEntries !== dataset.journalEntries };
}

function stepInternalAuditorReview(ctx: CloseContext, s: StatementBundle): CloseStep {
  const { ledger: fresh, statements: r, isolated } = independentRecomputation(ctx.rt.dataset, ctx.start, ctx.end);
  const clone = fresh.dataset;
  if (!isolated) return finishStep(17, ["Auditor ledger is NOT isolated from the live dataset."], [err("Internal auditor recomputation could not be isolated.")]);
  const calc = ctx.calcs.add(statementTotalsCalc(`auditor_recomputation_${ctx.periodId}`, r));
  const compare: [string, string, string][] = [
    ["revenue", s.incomeStatement.revenue, r.incomeStatement.revenue],
    ["netIncome", s.incomeStatement.netIncome, r.incomeStatement.netIncome],
    ["totalAssets", s.balanceSheet.totalAssets, r.balanceSheet.totalAssets],
    ["totalLiabilities", s.balanceSheet.totalLiabilities, r.balanceSheet.totalLiabilities],
    ["totalEquity", s.balanceSheet.totalEquity, r.balanceSheet.totalEquity],
    ["closingCash", s.cashFlowStatement.closingCash, r.cashFlowStatement.closingCash],
    ["trialBalanceDebits", s.trialBalance.totalDebits, r.trialBalance.totalDebits],
  ];
  const details = [`Independent recomputation on an isolated copy of the dataset (${clone.journalEntries.length} entries) with a fresh ledger instance.`];
  const exceptions: string[] = [];
  for (const [label, a, b] of compare) {
    const same = D(a).eq(D(b));
    details.push(`${same ? "match" : "MISMATCH"} ${label}: controller ${a} vs auditor ${b}`);
    if (!same) exceptions.push(err(`Auditor recomputation differs for ${label}: ${a} vs ${b}.`));
  }
  const integrity = fresh.runIntegrityChecks(ctx.end);
  for (const c of integrity.checks.filter((x) => !x.passed && x.severity === "ERROR")) exceptions.push(err(`Auditor integrity ${c.key}: ${c.details ?? c.label}`));
  return finishStep(17, details, exceptions, { calcIds: [calc.id] });
}

// 18 --------------------------------------------------------------------------
function stepResolveExceptions(steps: CloseStep[]): CloseStep {
  const all = steps.flatMap((s) => s.exceptions.map((e) => `[step ${s.step} ${s.key}] ${e}`));
  const blocking = all.filter((e) => isBlockingException(e.replace(/^\[[^\]]+\]\s*/, "")));
  const details = all.length ? all : ["No open exceptions."];
  const exceptions = blocking.length ? [err(`Close blocked by ${blocking.length} ERROR-level exception(s); resolve them before locking.`)] : all.length ? [warn(`${all.length} warning(s) remain open; they do not block the lock but should be reviewed.`)] : [];
  return finishStep(18, details, exceptions);
}

// 19 --------------------------------------------------------------------------
function lockAction(ctx: CloseContext, blocking: boolean): ProposedAction {
  return {
    id: deterministicId("pa", "LOCK_PERIOD", ctx.rt.dataset.profile.id, ctx.periodId),
    kind: "LOCK_PERIOD",
    agent: "controller",
    description: `Lock accounting period ${ctx.periodId}`,
    targetIds: [ctx.periodId],
    payload: { periodId: ctx.periodId, periodEnd: ctx.end, blockingExceptions: blocking },
    reason: "Month-end close checklist completed; locking prevents further postings without an UNLOCK_PERIOD approval.",
    financialImpact: "None — control action; prior-period figures become final.",
    sourceDocumentIds: [],
    confidence: 1,
    reversible: true,
    rollbackPlan: "UNLOCK_PERIOD (RED) with owner approval and a documented reason.",
    createdAt: nowISO(),
    context: { periodStatus: ctx.period.status },
  };
}

function stepLockPeriod(ctx: CloseContext, opts: CloseOptions, gateClean: boolean): { step: CloseStep; locked: boolean; needsApproval?: CloseResult["needsApproval"] } {
  if (!opts.lock) return { step: finishStep(19, ["Lock not requested (opts.lock is false); period left in its current status."], [], { status: "SKIPPED" }), locked: false };
  if (ctx.period.status === "LOCKED") return { step: finishStep(19, [`Period ${ctx.periodId} is already LOCKED (approval ${ctx.period.lockApprovalId ?? "unknown"}).`], []), locked: true };
  if (!gateClean) return { step: finishStep(19, ["Lock refused: step 18 reports ERROR-level exceptions."], [err(`Cannot lock ${ctx.periodId} while blocking exceptions remain.`)]), locked: false };
  const action = lockAction(ctx, false);
  const risk = ctx.rt.risk.assess(action, { thresholds: ctx.rt.thresholds });
  const approval = opts.approvalId ? ctx.rt.dataset.approvals.find((a) => a.id === opts.approvalId) : undefined;
  const valid = !!approval && approval.status === "APPROVED" && approval.action.kind === "LOCK_PERIOD" && (approval.action.targetIds.includes(ctx.periodId) || approval.action.payload?.periodId === ctx.periodId);
  if (!valid) {
    const reason = !opts.approvalId ? "No approvalId supplied." : !approval ? `Approval ${opts.approvalId} not found in the dataset.` : approval.status !== "APPROVED" ? `Approval ${opts.approvalId} is ${approval.status}.` : approval.action.kind !== "LOCK_PERIOD" ? `Approval ${opts.approvalId} is for ${approval.action.kind}, not LOCK_PERIOD.` : `Approval ${opts.approvalId} targets a different period.`;
    return {
      step: finishStep(19, [`${reason} LOCK_PERIOD is ${risk.level}; approvers: ${risk.requiredApproverRoles.join(", ") || "none"}.`], [], { status: "NEEDS_APPROVAL" }),
      locked: false,
      needsApproval: { action, risk, reason },
    };
  }
  try {
    const p = ctx.rt.ledger.lockPeriod(ctx.periodId, ctx.actor, approval!.id);
    return { step: finishStep(19, [`Period ${ctx.periodId} LOCKED at ${p.lockedAt} by ${p.lockedBy} with approval ${approval!.id}.`], []), locked: true };
  } catch (e) {
    return { step: finishStep(19, ["Ledger refused the lock."], [err(`lockPeriod failed: ${e instanceof Error ? e.message : String(e)}`)]), locked: false };
  }
}

// 20 --------------------------------------------------------------------------
function stepManagementReport(ctx: CloseContext, s: StatementBundle): { step: CloseStep; report: ManagementReport } {
  const ds = ctx.rt.dataset;
  const is = s.incomeStatement;
  const bs = s.balanceSheet;
  const meta = { asOfDate: ctx.end };
  const ratios = { grossMargin: grossMargin(is, meta), operatingMargin: operatingMargin(is, meta), netMargin: netMargin(is, meta), currentRatio: currentRatio(bs), quickRatio: quickRatio(bs), workingCapital: workingCapital(bs) };
  for (const c of Object.values(ratios) as CalcResult[]) ctx.calcs.add(c);
  const cash = ctx.calcs.add(cashPosition(ds, ctx.rt.ledger, ctx.end).calc);
  const ar = ctx.calcs.add(arAging(ds.invoices, ctx.end, ds.customers));
  const ap = ctx.calcs.add(apAging(ds.bills, ctx.end, ds.vendors));
  const budget = approvedBudgetFor(ds, yearOf(ctx.end));
  let variances: ManagementReport["variances"] = { flagged: [], note: "No APPROVED budget for the fiscal year." };
  if (budget) {
    const bv = ctx.calcs.add(budgetVariance(actualsByAccountMonth(ds, ctx.start, ctx.end), budget, { accounts: ds.accounts, materialityRatio: ctx.rt.thresholds.varianceRatio, months: [monthKey(ctx.end)], asOfDate: ctx.end }));
    variances = { budgetId: budget.id, flagged: bv.value.flagged.map((r) => ({ accountCode: r.accountCode, accountName: r.accountName, month: r.month, actual: r.actual, budget: r.budget, variance: r.variance, favorable: r.favorable })), calcId: bv.id };
  }
  const report: ManagementReport = {
    periodId: ctx.periodId,
    from: ctx.start,
    to: ctx.end,
    statements: { revenue: is.revenue, costOfRevenue: is.costOfRevenue, grossProfit: is.grossProfit, operatingExpenses: is.operatingExpenses, netIncome: is.netIncome, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, cash: bs.cash, closingCash: s.cashFlowStatement.closingCash },
    ratios: Object.fromEntries(Object.entries(ratios).map(([k, c]) => [k, { value: c.value as number | string | null, calcId: c.id, formula: c.formula }])),
    variances,
    cashPosition: { total: cash.value.total, calcId: cash.id },
    arOverdue: { total: ar.value.overdueTotal, count: ar.value.overdue.length, calcId: ar.id },
    apOpen: { total: ap.value.total, count: ap.value.items.length, calcId: ap.id },
    calcIds: [...Object.values(ratios).map((c) => c.id), cash.id, ar.id, ap.id, ...(variances.calcId ? [variances.calcId] : [])],
  };
  const details = [`Net income ${is.netIncome}; gross margin ${ratios.grossMargin.value ?? "n/a"}; current ratio ${ratios.currentRatio.value ?? "n/a"}; cash ${cash.value.total ?? "UNKNOWN (no posted entries)"}; AR overdue ${ar.value.overdueTotal}; ${variances.flagged.length} flagged budget variance(s).`];
  return { step: finishStep(20, details, [], { calcIds: report.calcIds }), report };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runMonthEndClose(rt: LabRuntime, periodId: string, actor: Actor, opts: CloseOptions = {}): Promise<CloseResult> {
  if (!/^\d{4}-\d{2}$/.test(periodId)) throw new Error(`Invalid period id ${periodId}; expected YYYY-MM`);
  const start = `${periodId}-01`;
  const end = monthEnd(start);
  const period = findPeriodById(rt.dataset, periodId) ?? rt.ledger.ensurePeriod(start);
  const statusBefore = period.status;
  const ctx: CloseContext = { rt, periodId, period, start, end, month: periodId, actor, calcs: new CalcCollector(), helperLedger: new Ledger(rt.dataset), draftedEntryIds: [] };
  const skip = new Set(opts.skipSteps ?? []);
  const isSkipped = (n: number) => skip.has(CLOSE_STEPS[n - 1].key);
  const steps: CloseStep[] = [];

  STEP_FUNCTIONS_1_TO_13.forEach((fn, i) => steps.push(isSkipped(i + 1) ? skipped(i + 1) : fn(ctx)));
  steps.push(isSkipped(14) ? skipped(14) : stepLedgerIntegrity(ctx));
  const statements = statementsFor(rt.ledger, start, end);
  if (isSkipped(15)) steps.push(skipped(15));
  else steps.push(stepPreliminaryStatements(ctx).step);
  steps.push(isSkipped(16) ? skipped(16) : stepControllerReview(ctx, statements));
  steps.push(isSkipped(17) ? skipped(17) : stepInternalAuditorReview(ctx, statements));
  const gate = isSkipped(18) ? skipped(18) : stepResolveExceptions(steps);
  steps.push(gate);
  const gateClean = gate.status !== "SKIPPED" && !gate.exceptions.some(isBlockingException);
  const lock = isSkipped(19) ? { step: skipped(19), locked: false as const } : stepLockPeriod(ctx, opts, gateClean);
  steps.push(lock.step);
  let managementReport: ManagementReport | null = null;
  if (isSkipped(20)) steps.push(skipped(20));
  else {
    const r = stepManagementReport(ctx, statements);
    steps.push(r.step);
    managementReport = r.report;
  }
  let cpaPackageId: ID | undefined;
  if (isSkipped(21)) steps.push(skipped(21));
  else {
    try {
      const pkg = await buildCpaPackage(rt, start, end);
      cpaPackageId = pkg.id;
      ctx.calcs.addAll(rt.dataset.calculations.filter((c) => pkg.calcIds.includes(c.id)));
      steps.push(finishStep(21, [`CPA package ${pkg.id}: ${pkg.generalLedger.entries.length} GL entries, ${pkg.significantJournalEntries.length} significant entries, ${pkg.unresolvedAccountingQuestions.length} open question(s), ${pkg.agentGeneratedAssumptions.length} AI-generated assumption(s) labelled for review.`], [], { calcIds: pkg.calcIds }));
    } catch (e) {
      steps.push(finishStep(21, ["CPA package could not be built."], [warn(`buildCpaPackage failed: ${e instanceof Error ? e.message : String(e)}`)]));
    }
  }

  const exceptions = steps.flatMap((s) => s.exceptions);
  const blockers = exceptions.filter(isBlockingException);
  const statusAfter = (findPeriodById(rt.dataset, periodId) ?? period).status;
  const calcIds = ctx.calcs.ids;
  await persistCalcs(rt, ctx.calcs.calcs);
  const audit = await rt.audit.record({
    actor,
    agent: "controller",
    workflowVersion: MONTH_END_CLOSE_VERSION,
    eventType: "MONTH_END_CLOSE_RUN",
    calculationIds: calcIds,
    approvalIds: opts.approvalId ? [opts.approvalId] : [],
    proposedActionId: lock.needsApproval?.action.id,
    finalAction: lock.locked ? `LOCK_PERIOD executed for ${periodId}` : lock.needsApproval ? `LOCK_PERIOD proposed for ${periodId} (awaiting approval)` : `Close checklist run for ${periodId} (no lock)`,
    explanation: [`Month-end close ${periodId}: ${steps.filter((s) => s.status === "PASSED").length} passed, ${steps.filter((s) => s.status === "WARNING").length} warnings, ${steps.filter((s) => s.status === "FAILED").length} failed, ${steps.filter((s) => s.status === "SKIPPED").length} skipped, ${steps.filter((s) => s.status === "NEEDS_APPROVAL").length} awaiting approval.`, `${ctx.draftedEntryIds.length} DRAFT entr(ies) created (never posted automatically).`, `${exceptions.filter(isBlockingException).length} blocking exception(s).`].join("\n"),
    beforeState: { periodId, status: statusBefore },
    afterState: { periodId, status: statusAfter, locked: lock.locked, steps: Object.fromEntries(steps.map((s) => [s.key, s.status])), exceptions: exceptions.length, draftedEntryIds: ctx.draftedEntryIds, cpaPackageId },
  });

  return {
    periodId,
    periodStart: start,
    periodEnd: end,
    statusBefore,
    statusAfter,
    steps,
    exceptions,
    blockers,
    passed: gateClean,
    checklist: steps,
    locked: lock.locked,
    needsApproval: lock.needsApproval,
    statements: isSkipped(15) ? null : { incomeStatement: statements.incomeStatement, balanceSheet: statements.balanceSheet, cashFlowStatement: statements.cashFlowStatement },
    managementReport,
    cpaPackageId,
    auditEventId: audit.id,
    draftedEntryIds: [...ctx.draftedEntryIds],
    calcIds,
    generatedAt: audit.timestamp,
  };
}
