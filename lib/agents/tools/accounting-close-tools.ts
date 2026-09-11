/**
 * Controller close-cycle tools: depreciation, prepaid amortization, accruals, correcting entries,
 * bank reconciliation, month-end close (delegated to lib/workflows) and locked-period changes.
 */
import type { NewJournalEntryInput, ToolContext } from "@/lib/core/contracts";
import type { DecimalString, FixedAsset, ISODate } from "@/lib/core/types";
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { buildCorrectingEntry } from "@/lib/accounting/closing";
import { depreciationSchedule } from "@/lib/accounting/depreciation";
import { findPeriodById } from "@/lib/accounting/periods";
import { entryForAccrual, entryForPrepaidAmortization } from "@/lib/accounting/posting-helpers";
import { reconcileAllAccounts, reconcileBankAccount, reconcileCard, type AccountReconciliation } from "@/lib/accounting/reconciliation";
import { addMonths, monthEnd, monthKey } from "@/lib/core/dates";
import { D, allocate, money, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, line, moneyFigure, ok, periodStatusAt, propose, structuredEntry, textFigure } from "./common";
import { loadWorkflows, runtimeFromContext } from "./runtime-bridge";

function entryBlock(ctx: ToolContext, entry: NewJournalEntryInput) {
  const se = structuredEntry(ctx, entry);
  return { date: se.date, description: se.description, source: se.source, lines: se.lines, balanced: se.balanced, totalDebits: se.totalDebits, totalCredits: se.totalCredits };
}

export const depreciationScheduleTool = defineTool({
  name: "depreciation_schedule",
  description: "Straight-line depreciation schedule for an asset and the monthly journal entry draft.",
  riskLevel: "GREEN",
  capabilityKey: "depreciation",
  inputSchema: TASKS["accounting.depreciation_schedule"].params,
  async execute(input, ctx) {
    if (input.usefulLifeMonths <= 0) return ok(insufficient(["useful life in months (> 0)"], "Useful life must be a positive number of months."));
    const existing = input.assetId ? ctx.dataset.fixedAssets.find((a) => a.id === input.assetId) : undefined;
    const asset: FixedAsset = existing ?? {
      id: input.assetId ?? "asset_draft",
      name: "Asset (draft schedule)",
      acquiredDate: input.inServiceDate,
      cost: money(input.cost),
      salvageValue: money(input.salvage ?? 0),
      usefulLifeMonths: input.usefulLifeMonths,
      method: "STRAIGHT_LINE",
      assetAccountId: accountIdForCode(ACCT.COMPUTER_EQUIPMENT),
      accumulatedDepreciationAccountId: accountIdForCode(ACCT.ACCUM_DEPR),
      depreciationExpenseAccountId: accountIdForCode(ACCT.DEPRECIATION),
      inServiceDate: input.inServiceDate,
      taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED",
    };
    const schedule = depreciationSchedule(asset);
    const first = schedule[0];
    const monthly = first?.amount ?? money(0);
    const calc = makeCalc<DecimalString>({ name: "monthly_depreciation", value: monthly, unit: "USD", formula: "(cost - salvage) / useful_life_months (straight-line, book)", inputs: { cost: asset.cost, salvage: asset.salvageValue, usefulLifeMonths: asset.usefulLifeMonths, inServiceDate: asset.inServiceDate }, asOfDate: ctx.asOfDate, sourceIds: existing ? [existing.id] : [], assumptions: [{ key: "tax_depreciation_treatment", description: "Book depreciation is straight-line; the tax treatment (Section 179 / bonus / MACRS) is a CPA decision.", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true }] });
    const month = schedule.find((r) => r.month === monthKey(ctx.asOfDate)) ?? first;
    const entry: NewJournalEntryInput = { date: month ? monthEnd(`${month.month}-01`) : ctx.asOfDate, description: `Depreciation ${month?.month ?? ""} — ${asset.name}`, source: "DEPRECIATION", lines: [line(ACCT.DEPRECIATION, "debit", month?.amount ?? monthly, "Depreciation expense"), line(ACCT.ACCUM_DEPR, "credit", month?.amount ?? monthly, "Accumulated depreciation")], tags: [`month:${month?.month ?? ""}`] };
    const last = schedule[schedule.length - 1];
    return ok({
      answer: `Straight-line depreciation: cost ${asset.cost} less salvage ${asset.salvageValue} over ${asset.usefulLifeMonths} months = ${monthly} per month from ${first?.month ?? asset.inServiceDate} to ${last?.month ?? "?"}.`,
      numbers: [moneyFigure("Monthly depreciation", monthly, calc.id), moneyFigure("Depreciable base", sub(asset.cost, asset.salvageValue)), textFigure("Months", schedule.length), moneyFigure("Net book value at end", last?.netBookValue ?? asset.salvageValue)],
      why: ["Book depreciation uses straight-line: equal monthly charges of the depreciable base over the useful life, starting in the in-service month."],
      risks: ["Tax depreciation (Section 179 / bonus / MACRS) is a CPA decision and may differ from book."],
      confidence: 0.9,
      structured: { value: monthly, values: { monthlyDepreciation: monthly, depreciableBase: sub(asset.cost, asset.salvageValue), months: schedule.length }, schedule, journalEntry: entryBlock(ctx, entry) },
    }, { calcs: [calc] });
  },
});

export const prepaidAmortizationTool = defineTool({
  name: "prepaid_amortization",
  description: "Monthly amortization schedule for a prepaid expense and the adjusting entry draft.",
  riskLevel: "GREEN",
  capabilityKey: "accruals_prepaids",
  inputSchema: TASKS["accounting.prepaid_amortization"].params,
  async execute(input, ctx) {
    if (input.months <= 0) return ok(insufficient(["months (> 0)"], "The number of months must be positive."));
    const total = money(input.amount);
    const parts = allocate(total, Array.from({ length: input.months }, () => 1));
    const schedule = parts.map((amount, i) => ({ month: monthKey(addMonths(input.startDate, i)), amount }));
    const expenseCode = input.expenseAccountCode ?? ACCT.SOFTWARE;
    if (!ctx.ledger.getAccount(expenseCode)) return ok(insufficient([`expense account ${expenseCode}`], `Unknown expense account ${expenseCode}.`));
    const calc = makeCalc<DecimalString>({ name: "monthly_prepaid_amortization", value: parts[0], unit: "USD", formula: "prepaid_total / months (largest-remainder allocation, no rounding leakage)", inputs: { amount: total, months: input.months, startDate: input.startDate, expenseAccountCode: expenseCode }, asOfDate: ctx.asOfDate });
    const entry = entryForPrepaidAmortization(parts[0], expenseCode, monthEnd(input.startDate));
    return ok({
      answer: `Prepaid of ${total} amortizes over ${input.months} months at ${parts[0]} per month (first month ${schedule[0].month}) to ${expenseCode}; the last month absorbs any rounding remainder.`,
      numbers: [moneyFigure("Monthly amortization", parts[0], calc.id), moneyFigure("Prepaid total", total), textFigure("Months", input.months)],
      why: ["The cash was paid up front but the benefit is consumed monthly, so the expense is recognized evenly across the service period (accrual basis)."],
      confidence: 0.92,
      structured: { value: parts[0], values: { monthlyAmortization: parts[0], total }, schedule, journalEntry: entryBlock(ctx, entry) },
    }, { calcs: [calc] });
  },
});

export const accrualTool = defineTool({
  name: "accrual_entry",
  description: "Accrue an expense incurred but not yet billed at period end, with its reversal in the next period.",
  riskLevel: "GREEN",
  capabilityKey: "accruals_prepaids",
  inputSchema: TASKS["accounting.accrual"].params,
  async execute(input, ctx) {
    if (!ctx.ledger.getAccount(input.expenseAccountCode)) return ok(insufficient([`expense account ${input.expenseAccountCode}`], `Unknown expense account ${input.expenseAccountCode}.`));
    const amount = money(input.amount);
    const accrual = entryForAccrual(input.expenseAccountCode, amount, input.periodEnd, { description: input.description ? `Accrual: ${input.description}` : undefined });
    const reversalDate = addMonths(monthEnd(input.periodEnd), 1).slice(0, 8) + "01";
    const reversal: NewJournalEntryInput = { date: reversalDate, description: `Reversal of accrual ${input.description ?? input.expenseAccountCode}`, source: "REVERSAL", lines: [line(ACCT.ACCRUED_EXPENSES, "debit", amount, "Reverse accrual"), line(input.expenseAccountCode, "credit", amount, "Reverse accrual")] };
    const calc = makeCalc<DecimalString>({ name: "accrued_expense", value: amount, unit: "USD", formula: "expense incurred through period end but not yet billed", inputs: { amount, expenseAccountCode: input.expenseAccountCode, periodEnd: input.periodEnd }, asOfDate: input.periodEnd });
    return ok({
      answer: `Accrue ${amount} to ${input.expenseAccountCode} at ${input.periodEnd} (Dr expense / Cr 2100 Accrued Expenses) and reverse it on ${reversalDate} so the actual bill posts cleanly.`,
      numbers: [moneyFigure("Accrual", amount, calc.id)],
      why: ["Accrual accounting records the expense in the period the service was received, even though the invoice arrives later.", "The automatic reversal prevents double counting when the vendor bill is recorded."],
      confidence: 0.92,
      structured: { value: amount, journalEntry: entryBlock(ctx, accrual), reversalEntry: entryBlock(ctx, reversal) },
    }, { calcs: [calc] });
  },
});

export const correctingEntryTool = defineTool({
  name: "correcting_entry",
  description: "Propose a reversal + re-entry correction for a posted entry; locked periods escalate as MODIFY_CLOSED_PERIOD (RED).",
  riskLevel: "YELLOW",
  capabilityKey: "journal_entry_drafting",
  inputSchema: TASKS["accounting.correcting_entry"].params,
  async execute(input, ctx) {
    const original = ctx.dataset.journalEntries.find((e) => e.id === input.originalEntryId);
    if (!original) return ok(insufficient([`journal entry ${input.originalEntryId}`], `No journal entry ${input.originalEntryId} exists.`));
    if (original.status !== "POSTED") return ok({ answer: `Entry #${original.entryNumber} is ${original.status}; only POSTED entries are corrected by reversal. Drafts can simply be edited or voided.`, escalation: esc("INSUFFICIENT_INFORMATION", `Entry ${original.id} is ${original.status}.`), confidence: 0.8, structured: { value: null, entryId: original.id, status: original.status } });
    const periodStatus = periodStatusAt(ctx, original.date);
    const total = original.lines.reduce((acc, l) => acc.plus(D(l.debit)), D(0)).toFixed(4);
    if (periodStatus === "LOCKED") {
      const action = propose(ctx, { kind: "MODIFY_CLOSED_PERIOD", description: `Correct entry #${original.entryNumber} in LOCKED period ${original.periodId}: ${input.reason}`, reason: input.reason, amount: total, targetIds: [original.id], payload: { entryId: original.id, periodId: original.periodId, correctedLines: input.correctedLines ?? null }, context: { periodStatus, isNonStandard: true }, reversible: false });
      return ok({
        answer: `Entry #${original.entryNumber} sits in LOCKED period ${original.periodId}. I will not post into it. The compliant path is a correcting entry dated in the current open period (${ctx.asOfDate}) — or, if the locked period itself must change, a RED MODIFY_CLOSED_PERIOD approval from the owner and CPA.`,
        escalation: esc("APPROVAL_REQUIRED", `Period ${original.periodId} is LOCKED; modifying it requires owner + CPA approval.`, { requiredRole: "OWNER" }),
        risks: ["Locked periods feed filed or delivered reports; changing them silently would misstate history."],
        recommendation: "Approve a current-period correcting entry instead of reopening the locked period.",
        confidence: 0.9,
        structured: { value: total, entryId: original.id, periodId: original.periodId, periodStatus },
      }, { proposedActions: [action], sourceIds: [original.id] });
    }
    if (!input.correctedLines || !input.correctedLines.length) return ok(insufficient(["correctedLines (what the entry should have been)"], `Entry #${original.entryNumber} can be corrected once you tell me the corrected lines.`, { structured: { entryId: original.id } }));
    const date = original.date >= ctx.asOfDate ? original.date : ctx.asOfDate;
    let pair;
    try {
      pair = buildCorrectingEntry(original, { date, reason: input.reason, lines: input.correctedLines.map((l) => ({ accountCode: l.accountCode, debit: l.debit === undefined ? undefined : money(l.debit), credit: l.credit === undefined ? undefined : money(l.credit) })) });
    } catch (err) {
      return ok(insufficient(["valid corrected lines"], err instanceof Error ? err.message : String(err)));
    }
    const rev = structuredEntry(ctx, pair.reversal);
    const re = structuredEntry(ctx, pair.reentry);
    if (!re.balanced) return ok({ answer: `The corrected lines do not balance (debits ${re.totalDebits} vs credits ${re.totalCredits}); I won't force them.`, escalation: esc("INSUFFICIENT_INFORMATION", "Corrected lines are unbalanced.", { missingItems: ["balancing amount"] }), confidence: 0.4, structured: { value: null, journalEntry: entryBlock(ctx, pair.reentry) } });
    const action = propose(ctx, { kind: "CREATE_JOURNAL_ENTRY", description: `Correcting entry pair for #${original.entryNumber} dated ${date}: ${input.reason}`, reason: input.reason, amount: re.totalDebits, targetIds: [original.id], payload: { entry: pair.reentry, reversal: pair.reversal, accountIds: [...rev.accountIds, ...re.accountIds], lines: [...rev.lines, ...re.lines].map((l) => ({ accountId: ctx.ledger.getAccount(l.accountCode)?.id })) }, context: { periodStatus: periodStatusAt(ctx, date), isNonStandard: true, touchesRestrictedAccount: rev.touchesRestrictedAccount || re.touchesRestrictedAccount } });
    return ok({
      answer: `Proposed a correction for entry #${original.entryNumber}: reverse the original (${rev.totalDebits}) and re-enter the corrected lines (${re.totalDebits}) dated ${date}, reason "${input.reason}". The original stays on record as REVERSED; nothing is edited in place.`,
      numbers: [moneyFigure("Reversal total", rev.totalDebits), moneyFigure("Re-entry total", re.totalDebits), textFigure("Correction date", date)],
      why: ["Posted entries are immutable; corrections are a dated reversal plus re-entry so the audit trail shows what changed and why."],
      confidence: 0.85,
      structured: { value: re.totalDebits, journalEntry: entryBlock(ctx, pair.reentry), reversalEntry: entryBlock(ctx, pair.reversal), originalEntryId: original.id },
    }, { proposedActions: [action], sourceIds: [original.id] });
  },
});

function recSummary(r: AccountReconciliation, name: string) {
  return { account: name, kind: r.kind, sourceAccountId: r.sourceAccountId, glBalance: r.glBalance, bankBalance: r.bankBalance, difference: r.difference, reconciled: r.reconciled, unmatchedTransactionIds: r.unmatchedTransactions.map((t) => t.id), unmatchedJournalLines: r.unmatchedJournalLines.length };
}

export const bankReconciliationTool = defineTool({
  name: "bank_reconciliation",
  description: "Reconcile a bank or card account (or all of them) to the general ledger as of a date.",
  riskLevel: "GREEN",
  capabilityKey: "bank_reconciliation",
  inputSchema: TASKS["accounting.bank_reconciliation"].params,
  async execute(input, ctx) {
    const ds = ctx.dataset;
    let recs: { rec: AccountReconciliation; name: string }[];
    if (input.accountId) {
      const bank = ds.bankAccounts.find((b) => b.id === input.accountId || b.glAccountId === input.accountId);
      const card = ds.cards.find((c) => c.id === input.accountId || c.glAccountId === input.accountId);
      if (bank) recs = [{ rec: reconcileBankAccount(ds, bank.id, input.asOf), name: bank.name }];
      else if (card) recs = [{ rec: reconcileCard(ds, card.id, input.asOf), name: card.name }];
      else return ok(insufficient([`bank account or card ${input.accountId}`], `No bank account or card ${input.accountId} is configured.`));
    } else {
      if (!ds.bankAccounts.length && !ds.cards.length) return ok(insufficient(["bank accounts / cards"], "No bank accounts or cards are configured, so there is nothing to reconcile."));
      recs = reconcileAllAccounts(ds, input.asOf).map((rec) => ({ rec, name: ds.bankAccounts.find((b) => b.id === rec.sourceAccountId)?.name ?? ds.cards.find((c) => c.id === rec.sourceAccountId)?.name ?? rec.sourceAccountId }));
    }
    const calcs = recs.map(({ rec, name }) => makeCalc<DecimalString>({ name: "reconciliation_difference", value: rec.difference, unit: "USD", formula: "gl_balance - statement_balance (from imported transactions)", inputs: { account: name, glBalance: rec.glBalance, bankBalance: rec.bankBalance, asOf: input.asOf }, asOfDate: input.asOf, sourceIds: [rec.sourceAccountId, ...rec.unmatchedTransactions.slice(0, 20).map((t) => t.id)] }));
    const allOk = recs.every((r) => r.rec.reconciled);
    const unmatchedTx = recs.reduce((n, r) => n + r.rec.unmatchedTransactions.length, 0);
    const unmatchedIds = recs.flatMap((r) => r.rec.unmatchedTransactions.map((t) => t.id));
    return ok({
      answer: `${allOk ? "All accounts reconcile" : "Reconciliation differences found"} as of ${input.asOf}: ${recs.map(({ rec, name }) => `${name} GL ${rec.glBalance} vs statement ${rec.bankBalance} (diff ${rec.difference}${rec.reconciled ? "" : ", NOT reconciled"})`).join("; ")}.`,
      numbers: recs.flatMap(({ rec, name }, i) => [moneyFigure(`${name} GL balance`, rec.glBalance), moneyFigure(`${name} statement balance`, rec.bankBalance), moneyFigure(`${name} difference`, rec.difference, calcs[i].id)]),
      why: recs.map(({ rec, name }) => `${name}: ${rec.unmatchedTransactions.length} imported transaction(s) without a journal entry, ${rec.unmatchedJournalLines.length} ledger line(s) without a transaction.`),
      risks: allOk ? [] : ["Unreconciled differences mean the ledger cash/card balance is not proven; the period must not lock until resolved."],
      recommendation: allOk ? "Reconciliation is clean; proceed with the close." : "Categorize the unmatched transactions and investigate ledger lines with no bank activity.",
      confidence: allOk ? 0.92 : 0.7,
      structured: { value: recs[0]?.rec.difference ?? null, reconciled: allOk, unmatchedTransactionCount: unmatchedTx, accounts: recs.map(({ rec, name }) => recSummary(rec, name)) },
    }, { calcs, sourceIds: unmatchedIds.slice(0, 40) });
  },
});

type CloseResultLike = { checklist?: unknown[]; passed?: boolean; blockers?: unknown[]; locked?: boolean; periodId?: string; [k: string]: unknown };

export const closePeriodTool = defineTool({
  name: "close_period",
  description: "Run the month-end close checklist for a period (delegates to lib/workflows); locking requires an approved LOCK_PERIOD.",
  riskLevel: "YELLOW",
  capabilityKey: "period_close",
  inputSchema: TASKS["accounting.close_period"].params,
  async execute(input, ctx) {
    const period = findPeriodById(ctx.dataset, input.periodId);
    if (!period) return ok(insufficient([`period ${input.periodId}`], `No period ${input.periodId} exists in the ledger.`));
    const workflows = await loadWorkflows();
    const approval = input.approvalId ? ctx.dataset.approvals.find((a) => a.id === input.approvalId) : undefined;
    const approvalValid = Boolean(approval && approval.status === "APPROVED" && approval.action.kind === "LOCK_PERIOD" && approval.action.targetIds.includes(input.periodId));
    if (input.approvalId && !approvalValid) {
      const action = propose(ctx, { kind: "LOCK_PERIOD", description: `Lock period ${input.periodId} after month-end close`, reason: `Lock requested with approval "${input.approvalId}", which is ${approval ? `${approval.status} for ${approval.action.kind}` : "not a known approval"}; a fresh approval is required.`, targetIds: [input.periodId], payload: { periodId: input.periodId }, context: { periodStatus: period.status }, reversible: false });
      return ok({
        answer: `I can't lock ${input.periodId} on approval "${input.approvalId}": ${approval ? `it is ${approval.status} for ${approval.action.kind}` : "no such approval exists"}, and an agent cannot approve its own lock. The period stays ${period.status}; a LOCK_PERIOD approval request has been raised for an authorized human.`,
        escalation: esc("APPROVAL_REQUIRED", `Locking ${input.periodId} requires an APPROVED LOCK_PERIOD request from an authorized human.`, { requiredRole: "OWNER" }),
        risks: ["Segregation of duties: the requester (or the agent) cannot approve the lock."],
        confidence: 0.9,
        educationKey: "period_lock",
        structured: { value: null, periodId: input.periodId, periodStatus: period.status, locked: false, approvalRejected: input.approvalId },
      }, { proposedActions: [action] });
    }
    const proposed = input.lock && !input.approvalId ? [propose(ctx, { kind: "LOCK_PERIOD", description: `Lock period ${input.periodId} after month-end close`, reason: "Lock requested with the close.", targetIds: [input.periodId], payload: { periodId: input.periodId }, context: { periodStatus: period.status }, reversible: false })] : [];
    if (!workflows?.runMonthEndClose) {
      const integrity = ctx.ledger.runIntegrityChecks(period.endDate);
      const suspense = ctx.ledger.accountBalance(accountIdForCode(ACCT.SUSPENSE), period.endDate);
      const failed = integrity.checks.filter((c) => !c.passed);
      return ok({
        answer: `The month-end close workflow module is not available yet; I ran the ledger integrity checks for ${input.periodId} instead: ${integrity.passed ? "all passed" : `${failed.length} check(s) failed`}; suspense balance ${suspense}. Period status: ${period.status}.`,
        escalation: esc("OUT_OF_SCOPE", "lib/workflows.runMonthEndClose is not available; only integrity checks were run."),
        numbers: [textFigure("Integrity checks passed", integrity.checks.filter((c) => c.passed).length), textFigure("Integrity checks failed", failed.length), moneyFigure("Suspense balance", suspense)],
        why: failed.map((c) => `${c.key}: ${c.details ?? "failed"}`),
        confidence: 0.6,
        structured: { value: null, periodId: input.periodId, periodStatus: period.status, integrityPassed: integrity.passed, checks: integrity.checks },
      }, { proposedActions: proposed });
    }
    const result = (await workflows.runMonthEndClose(runtimeFromContext(ctx), input.periodId, ctx.actor, { lock: Boolean(input.lock && approvalValid), approvalId: approvalValid ? input.approvalId : undefined })) as CloseResultLike;
    const checklist = Array.isArray(result.checklist) ? result.checklist : [];
    const blockers = Array.isArray(result.blockers) ? result.blockers : [];
    const passed = typeof result.passed === "boolean" ? result.passed : blockers.length === 0;
    const after = findPeriodById(ctx.dataset, input.periodId)?.status ?? period.status;
    return ok({
      answer: `Month-end close for ${input.periodId}: ${passed ? "checklist passed" : `${blockers.length} blocker(s)`}; ${checklist.length} checklist step(s) evaluated. Period status is now ${after}${input.lock && !input.approvalId ? " (lock proposed, awaiting approval)" : ""}.`,
      numbers: [textFigure("Checklist steps", checklist.length), textFigure("Blockers", blockers.length), textFigure("Period status", after)],
      why: blockers.slice(0, 10).map((b: unknown) => (typeof b === "string" ? b : JSON.stringify(b))),
      risks: passed ? [] : ["The period must not be locked until every blocker is resolved."],
      confidence: 0.85,
      educationKey: "period_lock",
      structured: { value: null, periodId: input.periodId, periodStatus: after, passed, checklist, blockers, closeResult: result },
    }, { proposedActions: proposed });
  },
});

export const modifyClosedPeriodTool = defineTool({
  name: "modify_closed_period",
  description: "Any request to change a locked period: always escalates (RED, owner + CPA approval) and never posts.",
  riskLevel: "RED",
  capabilityKey: "period_close",
  inputSchema: TASKS["accounting.modify_closed_period"].params,
  async execute(input, ctx) {
    const period = findPeriodById(ctx.dataset, input.periodId);
    const status = period?.status ?? "UNKNOWN";
    const action = propose(ctx, { kind: "MODIFY_CLOSED_PERIOD", description: `Modify period ${input.periodId} (${status}): ${input.description}`, reason: input.description, targetIds: [input.periodId], payload: { periodId: input.periodId, description: input.description }, context: { periodStatus: period?.status, isNonStandard: true }, reversible: false });
    return ok({
      answer: `Period ${input.periodId} is ${status}. Changing a closed period is a RED action: it requires an approved request from the owner and CPA, and even then the change is made as a dated correcting entry — the original entries are never edited. I have recorded the request but changed nothing.`,
      escalation: esc("APPROVAL_REQUIRED", `Modifying ${status} period ${input.periodId} requires owner + CPA approval.`, { requiredRole: "OWNER" }),
      risks: ["Closed periods may already have been reported to the CPA or used in filings."],
      recommendation: "If there is a genuine error, ask for a correcting entry in the current open period with the reason documented.",
      confidence: 0.95,
      educationKey: "period_lock",
      structured: { value: null, periodId: input.periodId, periodStatus: status, riskLevel: "RED" },
    }, { proposedActions: [action] });
  },
});

export function periodIdsAround(asOf: ISODate): string[] {
  return [monthKey(addMonths(asOf, -1)), monthKey(asOf)];
}

export const accountingCloseTools = [depreciationScheduleTool, prepaidAmortizationTool, accrualTool, correctingEntryTool, bankReconciliationTool, closePeriodTool, modifyClosedPeriodTool];
