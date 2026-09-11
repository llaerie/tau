/**
 * Month-end close steps 1–13 (data, reconciliations, subledgers, payroll, accruals, prepaids,
 * fixed assets, shareholder and personal/business review). Every step is read-only except for
 * DRAFT journal entries created through `Ledger.createEntry` — nothing is ever posted here.
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { buildDepreciationEntry, depreciationEntryExists, accumulatedDepreciationThrough } from "@/lib/accounting/depreciation";
import { entryForAccrual } from "@/lib/accounting/posting-helpers";
import { apReconciliation, arReconciliation, reconcileBankAccount, reconcileCard } from "@/lib/accounting/reconciliation";
import { hasPostedEffect } from "@/lib/accounting/statements";
import type { NewJournalEntryInput } from "@/lib/core/contracts";
import { addDays, daysBetween, addMonths } from "@/lib/core/dates";
import { D, abs, add, div, isZero, money, sub, within } from "@/lib/core/money";
import type { ID, JournalEntry, Transaction } from "@/lib/core/types";
import { matchReceiptsToTransactions } from "@/lib/documents/linking";
import { apAging, arAging } from "@/lib/finance/aging";
import { employerPayrollCostForRun, payrollReconciliation } from "@/lib/finance/headcount";
import { isSpendOutflow, median, merchantKey } from "@/lib/monitors/helpers";
import { closeItemTag, closeTag, entriesWithTags, inRange } from "./shared";
import { CLOSE_STEPS, err, warn, type CloseContext, type CloseStep, type CloseStepStatus } from "./close-types";

export type StepFn = (ctx: CloseContext) => CloseStep;

function spec(step: number) {
  return CLOSE_STEPS[step - 1];
}

export function finishStep(step: number, details: string[], exceptions: string[], extra: Partial<CloseStep> = {}): CloseStep {
  const s = spec(step);
  const status: CloseStepStatus = extra.status ?? (exceptions.some((e) => e.startsWith("ERROR:")) ? "FAILED" : exceptions.length ? "WARNING" : "PASSED");
  return { step: s.step, key: s.key, title: s.title, status, details, exceptions, calcIds: [], ...extra };
}

/**
 * Create a DRAFT entry once per close step/item: if a non-void entry already carries the same
 * close tags it is reused. Returns the entry id or null (with an exception) when the ledger refuses.
 */
export function draftEntry(ctx: CloseContext, stepKey: string, itemKey: string, input: NewJournalEntryInput, exceptions: string[], details: string[]): ID | null {
  const tags = [closeTag(ctx.periodId, stepKey), closeItemTag(itemKey)];
  const existing = entriesWithTags(ctx.rt.dataset, tags)[0];
  if (existing) {
    details.push(`Draft already exists: #${existing.entryNumber} ${existing.description} (${existing.status}).`);
    if (!ctx.draftedEntryIds.includes(existing.id)) ctx.draftedEntryIds.push(existing.id);
    return existing.id;
  }
  try {
    const entry = ctx.rt.ledger.createEntry({ ...input, post: false, tags: [...(input.tags ?? []), ...tags, "ai-drafted"] }, ctx.actor);
    ctx.draftedEntryIds.push(entry.id);
    details.push(`Drafted #${entry.entryNumber} ${entry.description} (DRAFT — not posted; requires review).`);
    return entry.id;
  } catch (e) {
    exceptions.push(warn(`Could not draft ${input.description}: ${e instanceof Error ? e.message : String(e)}`));
    return null;
  }
}

/** Register already-existing unposted entries (DRAFT / PENDING_APPROVAL) as this run's drafts. */
function rememberDrafts(ctx: CloseContext, entries: JournalEntry[]): ID[] {
  const ids = entries.filter((e) => e.status === "DRAFT" || e.status === "PENDING_APPROVAL").map((e) => e.id);
  for (const id of ids) if (!ctx.draftedEntryIds.includes(id)) ctx.draftedEntryIds.push(id);
  return ids;
}

const periodTx = (ctx: CloseContext): Transaction[] => ctx.rt.dataset.transactions.filter((t) => inRange(t.date, ctx.start, ctx.end));
const periodEntries = (ctx: CloseContext): JournalEntry[] => ctx.rt.dataset.journalEntries.filter((e) => e.status !== "VOID" && inRange(e.date, ctx.start, ctx.end));

// 1 ---------------------------------------------------------------------------
export const stepBankCardDataImported: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const sources = [...ds.bankAccounts.map((b) => ({ id: b.id, name: b.name, kind: "BANK" as const })), ...ds.cards.map((c) => ({ id: c.id, name: c.name, kind: "CARD" as const }))];
  if (!sources.length) exceptions.push(err("No bank accounts or cards are configured; nothing to import."));
  for (const s of sources) {
    const txs = ds.transactions.filter((t) => t.sourceAccountId === s.id && t.date <= ctx.end).sort((a, b) => a.date.localeCompare(b.date));
    const inPeriod = txs.filter((t) => t.date >= ctx.start);
    const last = txs[txs.length - 1];
    if (!inPeriod.length) exceptions.push(warn(`${s.name}: no transactions imported for ${ctx.periodId}.`));
    else if (last && daysBetween(last.date, ctx.end) > 7) exceptions.push(warn(`${s.name}: last imported transaction is ${last.date}; confirm the import covers through ${ctx.end}.`));
    details.push(`${s.name}: ${inPeriod.length} transaction(s) in period; last ${last?.date ?? "none"}.`);
    const stmtKind = s.kind === "BANK" ? "BANK_STATEMENT" : "CARD_STATEMENT";
    const single = s.kind === "BANK" ? ds.bankAccounts.length === 1 : ds.cards.length === 1;
    const stmt = ds.documents.find((d) => d.kind === stmtKind && (d.date.startsWith(ctx.month) || d.tags.includes(`period:${ctx.periodId}`)) && (d.extracted?.accountId === s.id || d.extracted?.cardId === s.id || d.tags.includes(`account:${s.id}`) || d.tags.includes(`card:${s.id}`) || single));
    if (stmt) details.push(`${s.name}: statement on file (${stmt.id}).`);
    else exceptions.push(warn(`${s.name}: no ${stmtKind.toLowerCase().replace("_", " ")} on file for ${ctx.periodId}.`));
  }
  return finishStep(1, details, exceptions);
};

// 2 / 3 ------------------------------------------------------------------------
function reconcileStep(step: 2 | 3, ctx: CloseContext): CloseStep {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const targets = step === 2 ? ds.bankAccounts.map((b) => ({ id: b.id, name: b.name })) : ds.cards.map((c) => ({ id: c.id, name: c.name }));
  if (!targets.length) details.push(step === 2 ? "No bank accounts configured." : "No cards configured.");
  for (const t of targets) {
    const rec = step === 2 ? reconcileBankAccount(ds, t.id, ctx.end) : reconcileCard(ds, t.id, ctx.end);
    details.push(`${t.name}: GL ${rec.glBalance} vs statement-side ${rec.bankBalance}, difference ${rec.difference}; unmatched transactions ${rec.unmatchedTransactions.length}, unmatched journal lines ${rec.unmatchedJournalLines.length}.`);
    if (!rec.reconciled) exceptions.push(err(`${t.name} not reconciled at ${ctx.end}: difference ${rec.difference}, ${rec.unmatchedTransactions.length} unmatched transaction(s), ${rec.unmatchedJournalLines.length} unmatched journal line(s).`));
  }
  return finishStep(step, details, exceptions);
}
export const stepReconcileCash: StepFn = (ctx) => reconcileStep(2, ctx);
export const stepReconcileCards: StepFn = (ctx) => reconcileStep(3, ctx);

// 4 ---------------------------------------------------------------------------
export const stepResolveUncategorized: StepFn = (ctx) => {
  const details: string[] = [];
  const exceptions: string[] = [];
  const open = periodTx(ctx).filter((t) => !t.flags.includes("TRANSFER") && !t.transferPairId && (t.category.status === "UNCATEGORIZED" || t.category.accountId === null || t.flags.includes("UNCATEGORIZED")));
  for (const t of open) exceptions.push(err(`Uncategorized transaction ${t.id} ${t.date} ${t.descriptionRaw} ${t.amount}: owner must confirm the category (cannot be auto-resolved).`));
  const suspenseAcct = ctx.rt.ledger.getAccount(ACCT.SUSPENSE);
  const suspense = suspenseAcct ? ctx.rt.ledger.accountBalance(suspenseAcct.id, ctx.end) : money(0);
  if (!isZero(suspense)) exceptions.push(err(`Suspense account ${ACCT.SUSPENSE} balance is ${suspense} at ${ctx.end}; must be zero before lock.`));
  details.push(`${open.length} uncategorized transaction(s) in period; suspense balance ${suspense}.`);
  return finishStep(4, details, exceptions);
};

// 5 ---------------------------------------------------------------------------
export const stepMatchInvoicesReceipts: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const txIds = new Set(periodTx(ctx).map((t) => t.id));
  const proposals = matchReceiptsToTransactions(ds).filter((p) => txIds.has(p.transactionId));
  const auto = proposals.filter((p) => p.autoLinkEligible);
  details.push(`${proposals.length} receipt↔transaction link proposal(s) for the period (${auto.length} auto-link eligible, ${proposals.length - auto.length} need review). Links are proposals only.`);
  const unlinkedDocs = ds.documents.filter((d) => (d.kind === "RECEIPT" || d.kind === "VENDOR_BILL") && inRange(d.date, ctx.start, ctx.end) && d.linkedTransactionIds.length === 0 && !proposals.some((p) => p.documentId === d.id));
  if (unlinkedDocs.length) exceptions.push(warn(`${unlinkedDocs.length} receipt/bill document(s) dated in period have no matching transaction: ${unlinkedDocs.slice(0, 5).map((d) => d.id).join(", ")}.`));
  const payments = ds.payments.filter((p) => p.direction === "IN" && inRange(p.date, ctx.start, ctx.end));
  for (const p of payments) {
    for (const app of p.applications.filter((a) => a.targetType === "INVOICE")) {
      const inv = ds.invoices.find((i) => i.id === app.targetId);
      if (!inv) exceptions.push(warn(`Payment ${p.id} applies to unknown invoice ${app.targetId}.`));
      else if (!inv.paymentIds.includes(p.id)) exceptions.push(warn(`Payment ${p.id} applied to invoice ${inv.number} but the invoice does not reference it.`));
    }
    if (!p.transactionId) exceptions.push(warn(`Payment ${p.id} (${p.amount}) is not linked to a bank transaction.`));
  }
  details.push(`${payments.length} customer payment(s) recorded in period.`);
  return finishStep(5, details, exceptions);
};

// 6 / 7 -----------------------------------------------------------------------
export const stepReviewAr: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const aging = ctx.calcs.add(arAging(ds.invoices, ctx.end, ds.customers));
  const rec = arReconciliation(ds, ctx.end);
  details.push(`AR open ${aging.value.total}; overdue ${aging.value.overdueTotal} (${aging.value.overdue.length} invoice(s)). GL ${rec.glBalance} vs subledger ${rec.subledgerBalance}.`);
  if (!rec.reconciled) exceptions.push(warn(`AR subledger differs from GL by ${rec.difference}.`));
  for (const i of aging.value.overdue) if (i.daysPastDue > 60) exceptions.push(warn(`Invoice ${i.number} (${i.counterpartyName}) is ${i.daysPastDue} days overdue: ${i.openAmount}.`));
  return finishStep(6, details, exceptions, { calcIds: [aging.id] });
};

export const stepReviewAp: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const aging = ctx.calcs.add(apAging(ds.bills, ctx.end, ds.vendors));
  const rec = apReconciliation(ds, ctx.end);
  details.push(`AP open ${aging.value.total}; overdue ${aging.value.overdueTotal} (${aging.value.overdue.length} bill(s)). GL ${rec.glBalance} vs subledger ${rec.subledgerBalance}.`);
  if (!rec.reconciled) exceptions.push(warn(`AP subledger differs from GL by ${rec.difference}.`));
  const flagged = ds.bills.filter((b) => (b.status === "DUPLICATE" || b.status === "DISPUTED") && inRange(b.billDate, ctx.start, ctx.end));
  for (const b of flagged) exceptions.push(warn(`Bill ${b.number} is ${b.status} (${b.total}).`));
  return finishStep(7, details, exceptions, { calcIds: [aging.id] });
};

// 8 ---------------------------------------------------------------------------
export const stepReconcilePayroll: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const calcIds: ID[] = [];
  const runs = ds.payrollRuns.filter((r) => inRange(r.payDate, ctx.start, ctx.end) && r.status !== "DRAFT");
  if (!runs.length) details.push("No payroll runs paid in the period.");
  for (const run of runs) {
    const cost = ctx.calcs.add(employerPayrollCostForRun(run));
    calcIds.push(cost.id);
    for (const d of cost.value.discrepancies) exceptions.push(warn(`Run ${run.payDate}: ${d}`));
    const netTxs = run.netPayTransactionIds.map((id) => ds.transactions.find((t) => t.id === id)).filter((t): t is Transaction => Boolean(t));
    const liabilityTxIds = ds.payrollLiabilities.filter((l) => l.payrollRunId === run.id && l.paidTransactionId).map((l) => l.paidTransactionId as ID);
    const liabTxs = liabilityTxIds.map((id) => ds.transactions.find((t) => t.id === id)).filter((t): t is Transaction => Boolean(t));
    const rec = ctx.calcs.add(payrollReconciliation(run, netTxs, liabTxs));
    calcIds.push(rec.id);
    if (!run.journalEntryId) exceptions.push(err(`Payroll run ${run.payDate} (${run.id}) has no journal entry recorded.`));
    if (!netTxs.length) exceptions.push(warn(`Payroll run ${run.payDate}: no net pay bank transactions linked; net pay ${run.totals.netPay} unreconciled.`));
    else if (!rec.value.netPay.matched) exceptions.push(warn(`Payroll run ${run.payDate}: net pay variance ${rec.value.netPay.variance} (bank ${rec.value.netPay.actual} vs register ${rec.value.netPay.expected}).`));
    details.push(`Run ${run.payDate}: gross ${cost.value.gross}, employer taxes ${cost.value.employerTaxes}, net ${cost.value.netPay}; reconciliation ${rec.value.status}; ${rec.value.liabilities.note}`);
  }
  const unknownLiab = ds.payrollLiabilities.filter((l) => l.status === "UNKNOWN" && inRange(l.accruedDate, ctx.start, ctx.end));
  if (unknownLiab.length) exceptions.push(warn(`${unknownLiab.length} payroll liabilit(ies) accrued in period have UNKNOWN status.`));
  return finishStep(8, details, exceptions, { calcIds });
};

// 9 ---------------------------------------------------------------------------
export const stepReviewAccruals: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const proposedEntries: NewJournalEntryInput[] = [];
  const drafted: ID[] = [];
  const acct = new Map(ds.accounts.map((a) => [a.id, a]));
  const lookbackStart = addMonths(ctx.end, -15);
  const groups = new Map<string, Transaction[]>();
  for (const t of ds.transactions) {
    if (!isSpendOutflow(t) || t.date < lookbackStart || t.date > ctx.end) continue;
    const arr = groups.get(merchantKey(t)) ?? [];
    arr.push(t);
    groups.set(merchantKey(t), arr);
  }
  let patterns = 0;
  for (const [merchant, txs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) continue;
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    if (!gaps.every((g) => g >= 75 && g <= 110)) continue;
    const amounts = sorted.map((t) => abs(t.amount));
    const med = median(amounts);
    if (!amounts.every((a) => within(a, med, D(med).times(0.25)))) continue;
    patterns++;
    const last = sorted[sorted.length - 1];
    const nextExpected = addDays(last.date, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
    if (!(last.date < ctx.start && nextExpected > ctx.end)) {
      details.push(`Quarterly pattern ${merchant} (~${med}): charged ${last.date}; next expected ${nextExpected}; no accrual needed this period.`);
      continue;
    }
    const expense = last.category.accountId ? acct.get(last.category.accountId) : undefined;
    if (!expense || expense.type !== "EXPENSE") {
      exceptions.push(warn(`Quarterly fee pattern for ${merchant} (~${med}) has no approved expense account; accrual not drafted.`));
      continue;
    }
    const monthly = money(div(med, 3));
    const input = entryForAccrual(expense.code, monthly, ctx.end, { description: `Accrual: 1/3 of quarterly ${merchant} fee (~${med}) for ${ctx.periodId}`, memo: "AI-GENERATED PROPOSAL — estimate from a recurring quarterly pattern; confirm amount before posting.", sourceIds: sorted.map((t) => t.id), tags: ["proposal"] });
    proposedEntries.push(input);
    const id = draftEntry(ctx, "review_accruals", `accrual:${merchant}`, input, exceptions, details);
    if (id) drafted.push(id);
  }
  const accrued = ctx.rt.ledger.accountBalance(accountIdForCode(ACCT.ACCRUED_EXPENSES), ctx.end);
  details.push(`${patterns} recurring quarterly fee pattern(s) found; accrued expenses balance ${accrued} at ${ctx.end}.`);
  return finishStep(9, details, exceptions, { proposedEntries, draftedEntryIds: drafted });
};

// 10 --------------------------------------------------------------------------
export const stepReviewPrepaids: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const proposedEntries: NewJournalEntryInput[] = [];
  const prepaidId = accountIdForCode(ACCT.PREPAID);
  const balance = ctx.rt.ledger.accountBalance(prepaidId, ctx.end);
  details.push(`Prepaid expenses balance ${balance} at ${ctx.end}.`);
  if (isZero(balance) || D(balance).lt(0)) {
    if (D(balance).lt(0)) exceptions.push(warn(`Prepaid balance is negative (${balance}); amortization exceeds cost.`));
    return finishStep(10, details, exceptions);
  }
  const existing = ds.journalEntries.filter((e) => e.status !== "VOID" && inRange(e.date, ctx.start, ctx.end) && (e.tags ?? []).includes("prepaid-amortization"));
  if (existing.length) {
    details.push(`Amortization already recorded this period: ${existing.map((e) => `#${e.entryNumber} (${e.status})`).join(", ")}.`);
    return finishStep(10, details, exceptions, { draftedEntryIds: rememberDrafts(ctx, existing) });
  }
  // Repeat the most recent posted amortization pattern, else derive from the origin entry's schedule tags.
  const prior = ds.journalEntries.filter((e) => hasPostedEffect(e) && e.date < ctx.start && (e.tags ?? []).includes("prepaid-amortization")).sort((a, b) => b.date.localeCompare(a.date))[0];
  let input: NewJournalEntryInput | null = null;
  if (prior) {
    input = { date: ctx.end, description: `Prepaid amortization ${ctx.periodId} (repeats #${prior.entryNumber})`, source: "ADJUSTING", lines: prior.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })), sourceIds: [prior.id, ...prior.sourceIds], tags: ["prepaid-amortization"] };
    details.push(`Schedule derived from prior amortization #${prior.entryNumber} dated ${prior.date}.`);
  } else {
    const origin = ds.journalEntries.filter((e) => hasPostedEffect(e) && e.date <= ctx.end && e.lines.some((l) => l.accountId === prepaidId && D(l.debit).gt(0))).sort((a, b) => b.date.localeCompare(a.date))[0];
    const months = origin ? Number((origin.tags ?? []).find((t) => t.startsWith("amortize-months:"))?.slice("amortize-months:".length)) : NaN;
    const toCode = origin ? (origin.tags ?? []).find((t) => t.startsWith("amortize-to:"))?.slice("amortize-to:".length) : undefined;
    if (origin && Number.isFinite(months) && months > 0 && toCode && ctx.rt.ledger.getAccount(toCode)) {
      const cost = origin.lines.filter((l) => l.accountId === prepaidId).reduce((acc, l) => add(acc, l.debit), money(0));
      const monthly = money(div(cost, months));
      input = { date: ctx.end, description: `Prepaid amortization ${ctx.periodId}: ${origin.description}`, source: "ADJUSTING", lines: [{ accountCode: toCode, debit: monthly }, { accountId: prepaidId, credit: monthly }], sourceIds: [origin.id, ...origin.sourceIds], tags: ["prepaid-amortization"] };
      details.push(`Schedule derived from origin #${origin.entryNumber}: ${cost} over ${months} months to ${toCode}.`);
    }
  }
  if (!input) {
    exceptions.push(warn(`Prepaid balance ${balance} has no amortization schedule (no prior amortization entry and no amortize-months/amortize-to tags); amortization not drafted — the system does not invent a schedule.`));
    return finishStep(10, details, exceptions);
  }
  proposedEntries.push(input);
  const draftedId = draftEntry(ctx, "review_prepaids", `amortization:${ctx.month}`, input, exceptions, details);
  return finishStep(10, details, exceptions, { proposedEntries, draftedEntryIds: draftedId ? [draftedId] : [] });
};

// 11 --------------------------------------------------------------------------
export const stepReviewFixedAssets: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const proposedEntries: NewJournalEntryInput[] = [];
  for (const a of ds.fixedAssets) details.push(`${a.name}: cost ${a.cost}, accumulated through ${ctx.month} ${accumulatedDepreciationThrough(a, ctx.month)}, tax treatment ${a.taxTreatmentStatus}.`);
  const assetAccountIds = new Set(ds.accounts.filter((a) => a.subtype === "FIXED_ASSET").map((a) => a.id));
  const registered = new Set(ds.fixedAssets.map((a) => a.sourceTransactionId).filter(Boolean));
  for (const e of periodEntries(ctx)) {
    if (!hasPostedEffect(e) || !e.lines.some((l) => assetAccountIds.has(l.accountId) && D(l.debit).gt(0))) continue;
    if (!e.sourceIds.some((s) => registered.has(s)) && !ds.fixedAssets.some((a) => a.documentId && e.sourceIds.includes(a.documentId))) exceptions.push(warn(`Capitalized purchase #${e.entryNumber} ${e.description} has no fixed-asset register entry.`));
  }
  if (!ds.fixedAssets.length) {
    details.push("No fixed assets on the register.");
    return finishStep(11, details, exceptions);
  }
  if (depreciationEntryExists(ctx.helperLedger, ctx.month)) {
    const existing = ds.journalEntries.filter((e) => e.source === "DEPRECIATION" && e.status !== "VOID" && (e.tags ?? []).includes(`month:${ctx.month}`));
    details.push(`Depreciation entry for ${ctx.month} already exists: ${existing.map((e) => `#${e.entryNumber} (${e.status})`).join(", ")}.`);
    return finishStep(11, details, exceptions, { draftedEntryIds: rememberDrafts(ctx, existing) });
  }
  const input = buildDepreciationEntry(ctx.helperLedger, ctx.month);
  if (!input) {
    details.push(`No asset depreciates in ${ctx.month}.`);
    return finishStep(11, details, exceptions);
  }
  proposedEntries.push(input);
  const draftedId = draftEntry(ctx, "review_fixed_assets", `depreciation:${ctx.month}`, input, exceptions, details);
  return finishStep(11, details, exceptions, { proposedEntries, draftedEntryIds: draftedId ? [draftedId] : [] });
};

// 12 --------------------------------------------------------------------------
export const SHAREHOLDER_ACCOUNT_CODES = [ACCT.DISTRIBUTIONS, ACCT.OFFICER_COMP, ACCT.DUE_FROM_SHAREHOLDER, ACCT.DUE_TO_SHAREHOLDER] as const;

export const stepReviewShareholderTransactions: StepFn = (ctx) => {
  const ds = ctx.rt.dataset;
  const details: string[] = [];
  const exceptions: string[] = [];
  const codes = new Map(SHAREHOLDER_ACCOUNT_CODES.map((c) => [accountIdForCode(c), c]));
  const totals = new Map<string, { debit: string; credit: string; entries: number }>();
  for (const e of periodEntries(ctx)) {
    if (!hasPostedEffect(e)) continue;
    for (const l of e.lines) {
      const code = codes.get(l.accountId);
      if (!code) continue;
      const cur = totals.get(code) ?? { debit: money(0), credit: money(0), entries: 0 };
      totals.set(code, { debit: add(cur.debit, l.debit), credit: add(cur.credit, l.credit), entries: cur.entries + 1 });
      details.push(`#${e.entryNumber} ${e.date} ${e.description}: ${code} Dr ${l.debit} / Cr ${l.credit}`);
    }
  }
  for (const [code, t] of totals) {
    details.push(`Account ${code}: debits ${t.debit}, credits ${t.credit} across ${t.entries} line(s).`);
    if ((code === ACCT.DUE_FROM_SHAREHOLDER || code === ACCT.DUE_TO_SHAREHOLDER) && !isZero(sub(t.debit, t.credit))) exceptions.push(warn(`Due to/from shareholder activity in ${code} (${sub(t.debit, t.credit)} net) requires CPA review (basis, loan terms, imputed interest).`));
  }
  if (!totals.size) details.push("No shareholder activity (3100 / 6010 / 1260 / 2500) in the period.");
  details.push("Officer compensation vs distributions is disclosed to the CPA; reasonable compensation is a professional judgment.");
  return finishStep(12, details, exceptions);
};

// 13 --------------------------------------------------------------------------
export const stepReviewPersonalBusiness: StepFn = (ctx) => {
  const details: string[] = [];
  const exceptions: string[] = [];
  const holding = accountIdForCode(ACCT.PERSONAL_REVIEW);
  const flagged = periodTx(ctx).filter((t) => t.flags.includes("POSSIBLE_PERSONAL") || t.category.accountId === holding);
  for (const t of flagged) exceptions.push(warn(`Possible personal charge ${t.id} ${t.date} ${t.descriptionRaw} ${t.amount}: owner must confirm business purpose or treat as shareholder draw.`));
  details.push(`${flagged.length} transaction(s) flagged for personal/business review in period.`);
  return finishStep(13, details, exceptions);
};

export const STEP_FUNCTIONS_1_TO_13: readonly StepFn[] = [
  stepBankCardDataImported,
  stepReconcileCash,
  stepReconcileCards,
  stepResolveUncategorized,
  stepMatchInvoicesReceipts,
  stepReviewAr,
  stepReviewAp,
  stepReconcilePayroll,
  stepReviewAccruals,
  stepReviewPrepaids,
  stepReviewFixedAssets,
  stepReviewShareholderTransactions,
  stepReviewPersonalBusiness,
];
