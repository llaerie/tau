/**
 * CPA package: everything a CPA needs for a period, with FACT / CALCULATION / ASSUMPTION /
 * PROFESSIONAL JUDGMENT kept apart. Every AI-generated assumption is labelled as such.
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { accumulatedDepreciationThrough, depreciationSchedule, netBookValue, type DepreciationRow } from "@/lib/accounting/depreciation";
import { reconcileAllAccounts } from "@/lib/accounting/reconciliation";
import { hasPostedEffect } from "@/lib/accounting/statements";
import type { BalanceSheet, CashFlowStatement, IncomeStatement, TrialBalance } from "@/lib/core/contracts";
import { monthKey, nowISO, quarterOf, yearOf } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { D, add, gte, isZero, money, sub } from "@/lib/core/money";
import type { Assumption, DecimalString, FieldStatus, FixedAsset, ID, ISODate, ISODateTime, JournalEntry, PayrollLiability, PayrollTotals, TaxWorkpaper, Transaction } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import { missingDocumentAlerts, type MissingDocumentAlert } from "@/lib/documents/missing-documents";
import { arAging, type AgingReport } from "@/lib/finance/aging";
import { apAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { employerPayrollCostForRun } from "@/lib/finance/headcount";
import { receiptThresholdFor } from "@/lib/monitors/helpers";
import { buildTaxDocumentChecklist, type TaxDocumentChecklist } from "@/lib/tax/checklist";
import { buildTaxWorkpaper } from "@/lib/tax/workpapers";
import { AI_ASSUMPTION_LABEL, CalcCollector, inRange, persistCalcs } from "./shared";

export const CPA_PACKAGE_VERSION = "cpa-package:v1";

export interface GlLine {
  accountId: ID;
  accountCode: string;
  accountName: string;
  debit: DecimalString;
  credit: DecimalString;
  memo?: string;
}
export interface GlEntry {
  id: ID;
  entryNumber: number;
  date: ISODate;
  description: string;
  source: string;
  status: string;
  sourceIds: ID[];
  lines: GlLine[];
}
export interface BankReconciliationSummary {
  kind: "BANK" | "CARD";
  sourceAccountId: ID;
  name: string;
  glAccountId: ID;
  glBalance: DecimalString;
  bankBalance: DecimalString;
  difference: DecimalString;
  reconciled: boolean;
  unmatchedTransactionIds: ID[];
  unmatchedJournalEntryIds: ID[];
}
export interface PayrollQuarterTotals extends PayrollTotals {
  quarter: string;
  runCount: number;
}
export interface FixedAssetRow {
  asset: FixedAsset;
  accumulatedThroughPeriod: DecimalString;
  netBookValue: DecimalString;
  schedule: DepreciationRow[];
}
export interface LabelledAssumption extends Assumption {
  label: typeof AI_ASSUMPTION_LABEL;
  calcId: ID;
}
export interface UnresolvedQuestion {
  id: string;
  source: "CPA_QUEUE" | "OPEN_EXCEPTION" | "CONFIG_REVIEW";
  topic: string;
  question: string;
  context: string;
  urgency: string;
  relatedIds: ID[];
}
export interface TaxGuidanceTransaction {
  transactionId: ID;
  date: ISODate;
  amount: DecimalString;
  description: string;
  accountCode: string | null;
  reasons: string[];
}
export interface InternationalWorkerQuestion {
  workerId: ID;
  displayName: string;
  country: string;
  workerType: string;
  reviewStatus: string;
  openFields: string[];
  notes: string[];
}

export interface CpaPackage {
  id: ID;
  version: string;
  from: ISODate;
  to: ISODate;
  taxYear: number;
  companyName: string;
  isSyntheticData: boolean;
  generatedAt: ISODateTime;
  trialBalance: TrialBalance;
  generalLedger: { entries: GlEntry[]; count: number };
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  bankReconciliations: BankReconciliationSummary[];
  payrollReports: { runs: { id: ID; payDate: ISODate; periodStart: ISODate; periodEnd: ISODate; status: string; workerCount: number; totals: PayrollTotals; journalEntryId?: ID }[]; liabilities: PayrollLiability[]; byQuarter: PayrollQuarterTotals[]; totals: PayrollTotals; calcIds: ID[] };
  shareholderSummary: { officerCompensation: DecimalString; distributions: DecimalString; dueFromShareholder: DecimalString; dueToShareholder: DecimalString; capitalContributions: DecimalString; owners: { workerId: ID; displayName: string }[]; note: string; calcId: ID };
  fixedAssetSchedule: { assets: FixedAssetRow[]; totalCost: DecimalString; totalAccumulated: DecimalString; calcId: ID };
  arAging: AgingReport;
  apAging: AgingReport;
  significantJournalEntries: (GlEntry & { reasons: string[] })[];
  taxWorkpapers: TaxWorkpaper[];
  missingDocuments: { alerts: MissingDocumentAlert[]; checklist: TaxDocumentChecklist };
  unresolvedAccountingQuestions: UnresolvedQuestion[];
  transactionsRequiringTaxGuidance: TaxGuidanceTransaction[];
  internationalWorkerQuestions: InternationalWorkerQuestion[];
  agentGeneratedAssumptions: LabelledAssumption[];
  coverMemo: string;
  calcIds: ID[];
  sourceIds: ID[];
}

const REASONABLE_COMP_NOTE = "Officer compensation versus distributions is presented for disclosure only. Whether compensation is reasonable for the services performed is a professional judgment for the CPA; the system does not opine.";

function glEntry(e: JournalEntry, acct: Map<ID, { code: string; name: string }>): GlEntry {
  return { id: e.id, entryNumber: e.entryNumber, date: e.date, description: e.description, source: e.source, status: e.status, sourceIds: e.sourceIds, lines: e.lines.map((l) => ({ accountId: l.accountId, accountCode: acct.get(l.accountId)?.code ?? l.accountId, accountName: acct.get(l.accountId)?.name ?? l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })) };
}

function movement(entries: JournalEntry[], accountId: ID, side: "debit" | "credit" | "net"): DecimalString {
  let d = money(0);
  let c = money(0);
  for (const e of entries) for (const l of e.lines) if (l.accountId === accountId) (d = add(d, l.debit)), (c = add(c, l.credit));
  return side === "debit" ? d : side === "credit" ? c : sub(d, c);
}

export async function buildCpaPackage(rt: LabRuntime, from: ISODate, to: ISODate): Promise<CpaPackage> {
  if (from > to) throw new Error(`CPA package range is inverted: ${from} > ${to}`);
  const ds = rt.dataset;
  const calcs = new CalcCollector();
  const taxYear = yearOf(to);
  const acct = new Map(ds.accounts.map((a) => [a.id, { code: a.code, name: a.name }]));
  const posted = ds.journalEntries.filter((e) => hasPostedEffect(e) && inRange(e.date, from, to)).sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber);
  const yearEntries = ds.journalEntries.filter((e) => hasPostedEffect(e) && e.date.startsWith(`${taxYear}-`) && e.date <= to);

  // Statements
  const trialBalance = rt.ledger.trialBalance(to);
  const incomeStatement = rt.ledger.incomeStatement(from, to);
  const balanceSheet = rt.ledger.balanceSheet(to);
  const cashFlowStatement = rt.ledger.cashFlowStatement(from, to);
  const stmtCalc = calcs.add(makeCalc({ name: "cpa_package_statement_totals", value: { revenue: incomeStatement.revenue, netIncome: incomeStatement.netIncome, totalAssets: balanceSheet.totalAssets, totalLiabilities: balanceSheet.totalLiabilities, totalEquity: balanceSheet.totalEquity, closingCash: cashFlowStatement.closingCash }, unit: "OBJECT", formula: "statement totals from the double-entry ledger", inputs: { from, to, revenue: incomeStatement.revenue, netIncome: incomeStatement.netIncome, totalAssets: balanceSheet.totalAssets }, sourceIds: posted.map((e) => e.id), asOfDate: to }));

  // Bank reconciliations
  const names = new Map<string, string>([...ds.bankAccounts.map((b) => [b.id, b.name] as [string, string]), ...ds.cards.map((c) => [c.id, c.name] as [string, string])]);
  const bankReconciliations: BankReconciliationSummary[] = reconcileAllAccounts(ds, to).map((r) => ({ kind: r.kind, sourceAccountId: r.sourceAccountId, name: names.get(r.sourceAccountId) ?? r.sourceAccountId, glAccountId: r.glAccountId, glBalance: r.glBalance, bankBalance: r.bankBalance, difference: r.difference, reconciled: r.reconciled, unmatchedTransactionIds: r.unmatchedTransactions.map((t) => t.id), unmatchedJournalEntryIds: Array.from(new Set(r.unmatchedJournalLines.map((l) => l.entryId))) }));

  // Payroll
  const runs = ds.payrollRuns.filter((r) => r.status !== "DRAFT" && inRange(r.payDate, from, to)).sort((a, b) => a.payDate.localeCompare(b.payDate));
  const payrollCalcIds: ID[] = [];
  const quarters = new Map<string, PayrollQuarterTotals>();
  const zero = (): PayrollTotals => ({ gross: money(0), employeeTaxes: money(0), otherDeductions: money(0), netPay: money(0), employerTaxes: money(0), totalEmployerCost: money(0) });
  const totals = zero();
  const addTotals = (t: PayrollTotals, r: PayrollTotals) => {
    t.gross = add(t.gross, r.gross);
    t.employeeTaxes = add(t.employeeTaxes, r.employeeTaxes);
    t.otherDeductions = add(t.otherDeductions, r.otherDeductions);
    t.netPay = add(t.netPay, r.netPay);
    t.employerTaxes = add(t.employerTaxes, r.employerTaxes);
    t.totalEmployerCost = add(t.totalEmployerCost, r.totalEmployerCost);
  };
  for (const r of runs) {
    payrollCalcIds.push(calcs.add(employerPayrollCostForRun(r)).id);
    const q = `${yearOf(r.payDate)}-Q${quarterOf(r.payDate)}`;
    const cur = quarters.get(q) ?? { quarter: q, runCount: 0, ...zero() };
    addTotals(cur, r.totals);
    cur.runCount += 1;
    quarters.set(q, cur);
    addTotals(totals, r.totals);
  }
  const liabilities = ds.payrollLiabilities.filter((l) => inRange(l.accruedDate, from, to));

  // Shareholder summary
  const owners = ds.workers.filter((w) => w.isOwner).map((w) => ({ workerId: w.id, displayName: w.displayName }));
  const officerComp = movement(yearEntries, accountIdForCode(ACCT.OFFICER_COMP), "net");
  const distributions = movement(yearEntries, accountIdForCode(ACCT.DISTRIBUTIONS), "net");
  const dueFrom = rt.ledger.accountBalance(accountIdForCode(ACCT.DUE_FROM_SHAREHOLDER), to);
  const dueTo = rt.ledger.accountBalance(accountIdForCode(ACCT.DUE_TO_SHAREHOLDER), to);
  const contributions = movement(yearEntries, accountIdForCode(ACCT.CAPITAL), "credit");
  const shareholderCalc = calcs.add(makeCalc({ name: "shareholder_summary", value: { officerCompensation: officerComp, distributions, dueFromShareholder: dueFrom, dueToShareholder: dueTo, capitalContributions: contributions, taxYear }, unit: "OBJECT", formula: "officer compensation = YTD net debits to 6010; distributions = YTD net debits to 3100; due to/from = balances at period end; contributions = YTD credits to 3000", inputs: { taxYear, to, officerComp, distributions, dueFrom, dueTo, contributions }, sourceIds: yearEntries.filter((e) => e.lines.some((l) => [ACCT.OFFICER_COMP, ACCT.DISTRIBUTIONS, ACCT.DUE_FROM_SHAREHOLDER, ACCT.DUE_TO_SHAREHOLDER, ACCT.CAPITAL].map(accountIdForCode).includes(l.accountId))).map((e) => e.id), asOfDate: to, assumptions: [{ key: "reasonable_compensation", description: REASONABLE_COMP_NOTE, value: officerComp, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true }] }));

  // Fixed assets
  const period = monthKey(to);
  const assets: FixedAssetRow[] = ds.fixedAssets.map((a) => ({ asset: a, accumulatedThroughPeriod: accumulatedDepreciationThrough(a, period), netBookValue: netBookValue(a, period), schedule: depreciationSchedule(a) }));
  const totalCost = assets.reduce((acc, r) => add(acc, r.asset.cost), money(0));
  const totalAccumulated = assets.reduce((acc, r) => add(acc, r.accumulatedThroughPeriod), money(0));
  const faCalc = calcs.add(makeCalc({ name: "fixed_asset_schedule", value: { totalCost, totalAccumulated, assets: assets.map((r) => ({ id: r.asset.id, cost: r.asset.cost, accumulated: r.accumulatedThroughPeriod, nbv: r.netBookValue })) }, unit: "OBJECT", formula: "straight-line book depreciation; accumulated = sum of monthly amounts through period; NBV = cost − accumulated", inputs: { period, assetIds: ds.fixedAssets.map((a) => a.id) }, sourceIds: ds.fixedAssets.map((a) => a.id), asOfDate: to, assumptions: ds.fixedAssets.filter((a) => a.taxTreatmentStatus !== "CONFIRMED").map((a) => ({ key: `tax_depreciation:${a.id}`, description: `Tax depreciation treatment for ${a.name} is ${a.taxTreatmentStatus}; book uses straight-line.`, value: null, status: a.taxTreatmentStatus as FieldStatus, requiresProfessionalReview: true })) }));

  // Aging
  const ar = calcs.add(arAging(ds.invoices, to, ds.customers));
  const ap = calcs.add(apAging(ds.bills, to, ds.vendors));

  // Significant entries
  const restricted = new Set(ds.accounts.filter((a) => a.restricted).map((a) => a.id));
  const significantJournalEntries = posted
    .map((e) => {
      const reasons: string[] = [];
      const total = e.lines.reduce((acc, l) => add(acc, l.debit), money(0));
      if (gte(total, rt.thresholds.redAmount)) reasons.push(`amount ${total} ≥ red amount ${rt.thresholds.redAmount}`);
      if (e.lines.some((l) => restricted.has(l.accountId))) reasons.push("touches a restricted account");
      if (["CORRECTING", "ADJUSTING", "REVERSAL"].includes(e.source)) reasons.push(`source ${e.source}`);
      return reasons.length ? { ...glEntry(e, acct), reasons } : null;
    })
    .filter((x): x is GlEntry & { reasons: string[] } => x !== null);

  // Transactions requiring tax guidance
  const mealsId = accountIdForCode(ACCT.MEALS);
  const fixedAssetIds = new Set(ds.accounts.filter((a) => a.subtype === "FIXED_ASSET").map((a) => a.id));
  const relatedCustomers = new Set(ds.customers.filter((c) => c.relatedParty).map((c) => c.id));
  const taxGuidance: TaxGuidanceTransaction[] = [];
  for (const t of ds.transactions.filter((x: Transaction) => inRange(x.date, from, to)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const reasons: string[] = [];
    if (t.flags.includes("POSSIBLE_PERSONAL")) reasons.push("possible personal expense");
    if (t.category.accountId === mealsId) reasons.push("meal: deductible portion is a tax-rule lookup + CPA confirmation");
    if (/home office|residential|apartment|rent .*home/i.test(`${t.merchantNormalized ?? ""} ${t.descriptionRaw}`)) reasons.push("home-office-like expense");
    if (t.category.accountId && fixedAssetIds.has(t.category.accountId)) reasons.push("capitalized asset purchase: tax depreciation election needed");
    if (D(t.amount).gt(0) && (t.flags.includes("RELATED_PARTY") || (t.counterpartyRef?.type === "CUSTOMER" && relatedCustomers.has(t.counterpartyRef.id)))) reasons.push("related-party receipt");
    if (reasons.length) taxGuidance.push({ transactionId: t.id, date: t.date, amount: t.amount, description: t.descriptionRaw, accountCode: t.category.accountId ? (acct.get(t.category.accountId)?.code ?? null) : null, reasons });
  }

  // International workers
  const internationalWorkerQuestions: InternationalWorkerQuestion[] = ds.workers
    .filter((w) => w.country !== "US" && w.internationalReview?.status !== "REVIEWED")
    .map((w) => ({ workerId: w.id, displayName: w.displayName, country: w.country, workerType: w.workerType, reviewStatus: w.internationalReview?.status ?? "NO_REVIEW_RECORD", openFields: (w.internationalReview?.fields ?? []).filter((f) => f.status !== "CONFIRMED").map((f) => f.label), notes: w.internationalReview?.notes ?? [] }));
  // The agent layer may hand us a partial runtime (no CPA queue / policies): degrade gracefully.
  const cpaQueue = rt.cpaQueue as LabRuntime["cpaQueue"] | undefined;
  const policies = rt.policies ?? ds.policies;
  for (const q of internationalWorkerQuestions) cpaQueue?.addUnique({ topic: "international_worker_classification", question: `How should ${q.displayName} (${q.country}) be classified and documented?`, context: `Worker type ${q.workerType}; review ${q.reviewStatus}; ${q.openFields.length} open fact(s).`, sourceIds: [q.workerId], urgency: "HIGH", createdBy: CPA_PACKAGE_VERSION, at: `${to}T00:00:00.000Z` });

  // Missing documents & unresolved questions
  const alerts = missingDocumentAlerts(ds, { receiptThreshold: receiptThresholdFor(ds.configFields, policies) });
  const checklist = buildTaxDocumentChecklist(ds, taxYear);
  const questions: UnresolvedQuestion[] = [];
  const integrity = rt.ledger.runIntegrityChecks(to);
  for (const c of integrity.checks.filter((x) => !x.passed)) questions.push({ id: `exc_integrity_${c.key}`, source: "OPEN_EXCEPTION", topic: "ledger_integrity", question: `Resolve integrity failure: ${c.label}`, context: c.details ?? "", urgency: c.severity === "ERROR" ? "BLOCKING" : "MEDIUM", relatedIds: [] });
  const uncategorized = ds.transactions.filter((t) => inRange(t.date, from, to) && (t.category.status === "UNCATEGORIZED" || t.category.accountId === null) && !t.flags.includes("TRANSFER"));
  if (uncategorized.length) questions.push({ id: "exc_uncategorized", source: "OPEN_EXCEPTION", topic: "categorization", question: `${uncategorized.length} transaction(s) remain uncategorized; owner must confirm their business purpose.`, context: uncategorized.slice(0, 10).map((t) => `${t.date} ${t.descriptionRaw} ${t.amount}`).join("; "), urgency: "HIGH", relatedIds: uncategorized.map((t) => t.id) });
  const suspense = rt.ledger.accountBalance(accountIdForCode(ACCT.SUSPENSE), to);
  if (!isZero(suspense)) questions.push({ id: "exc_suspense", source: "OPEN_EXCEPTION", topic: "suspense", question: `Suspense balance ${suspense} must be cleared.`, context: `Account ${ACCT.SUSPENSE} at ${to}`, urgency: "BLOCKING", relatedIds: [accountIdForCode(ACCT.SUSPENSE)] });
  for (const r of bankReconciliations.filter((x) => !x.reconciled)) questions.push({ id: `exc_rec_${r.sourceAccountId}`, source: "OPEN_EXCEPTION", topic: "reconciliation", question: `${r.name} is not reconciled (difference ${r.difference}).`, context: `${r.unmatchedTransactionIds.length} unmatched transaction(s), ${r.unmatchedJournalEntryIds.length} unmatched entr(ies).`, urgency: "HIGH", relatedIds: [r.sourceAccountId] });
  for (const f of ds.configFields.filter((x) => x.status === "PROFESSIONAL_REVIEW_REQUIRED")) questions.push({ id: `cfg_${f.key}`, source: "CONFIG_REVIEW", topic: f.section, question: `${f.label}: professional review required.`, context: f.note ?? "", urgency: "MEDIUM", relatedIds: [f.key] });
  for (const q of cpaQueue?.listOpen() ?? []) questions.push({ id: q.id, source: "CPA_QUEUE", topic: q.topic, question: q.question, context: q.context, urgency: q.urgency, relatedIds: q.sourceIds });

  // Assumptions (from every calc in this package) — labelled
  const agentGeneratedAssumptions: LabelledAssumption[] = calcs.assumptions.filter((a) => a.status !== "CONFIRMED").map((a) => ({ ...a, label: AI_ASSUMPTION_LABEL }));

  // Tax workpapers
  const profile = ds.profile;
  const createdAt = `${to}T00:00:00.000Z`;
  const entityFacts = [
    { label: "Entity type", value: profile.entityType.value, sourceIds: profile.entityType.sourceIds ?? [] },
    { label: "Federal tax election", value: profile.taxElection.value, sourceIds: profile.taxElection.sourceIds ?? [] },
    { label: "State", value: profile.state.value, sourceIds: profile.state.sourceIds ?? [] },
    { label: "Fiscal year end", value: profile.fiscalYearEnd.value, sourceIds: profile.fiscalYearEnd.sourceIds ?? [] },
    { label: "Accounting method (books)", value: profile.accountingMethod.value, sourceIds: profile.accountingMethod.sourceIds ?? [] },
  ];
  const profileAssumptions: Assumption[] = [profile.entityType, profile.taxElection, profile.state, profile.fiscalYearEnd, profile.accountingMethod].filter((f) => f.status !== "CONFIRMED").map((f) => ({ key: f.key, description: `${f.label} is ${f.status}${f.note ? `: ${f.note}` : ""}`, value: f.value, status: f.status, requiresProfessionalReview: true }));
  const judgment = [REASONABLE_COMP_NOTE, "Related-party revenue and compensation: treatment and disclosure are professional judgments.", "International worker classification and withholding are decided by the CPA / attorney, never by the system.", "Tax depreciation method and any expensing election for fixed assets.", "Tax accounting method (cash vs accrual) must be confirmed against prior returns."];
  const federal = buildTaxWorkpaper({ title: `Tax year ${taxYear} S corporation summary (federal)`, taxYear, jurisdiction: "FEDERAL", facts: [...entityFacts, { label: `Revenue ${from}..${to}`, value: incomeStatement.revenue, sourceIds: [stmtCalc.id] }, { label: `Net income ${from}..${to}`, value: incomeStatement.netIncome, sourceIds: [stmtCalc.id] }, { label: `Officer compensation YTD ${taxYear}`, value: officerComp, sourceIds: [shareholderCalc.id] }, { label: `Distributions YTD ${taxYear}`, value: distributions, sourceIds: [shareholderCalc.id] }, { label: "Payroll gross in range", value: totals.gross, sourceIds: payrollCalcIds }], calculations: [stmtCalc, shareholderCalc, faCalc], assumptions: [...profileAssumptions, ...agentGeneratedAssumptions.map(({ label: _l, calcId: _c, ...a }) => a)], professionalJudgmentItems: judgment, createdBy: CPA_PACKAGE_VERSION, createdAt });
  const california = buildTaxWorkpaper({ title: `Tax year ${taxYear} California S corporation return and franchise tax`, taxYear, jurisdiction: "CALIFORNIA", facts: entityFacts, calculations: [stmtCalc], assumptions: [{ key: "ca_franchise_tax_amount", description: "California franchise / entity tax amount and due date come only from a usable TaxRule; none is confirmed.", value: null, status: "UNCONFIRMED", requiresProfessionalReview: true }], professionalJudgmentItems: ["California apportionment / franchise tax computation is confirmed by the CPA."], createdBy: CPA_PACKAGE_VERSION, createdAt });

  const id = deterministicId("cpapkg", profile.id, from, to);
  const coverMemo = [
    `CPA package for ${profile.displayName} — ${from} to ${to}${profile.isSynthetic ? " — SYNTHETIC LAB DATA (no real company records)" : ""}.`,
    `Prepared by the Tau AI CFO system (${CPA_PACKAGE_VERSION}). Every number comes from the double-entry ledger or a deterministic calculation with a calc id; the language model is never the calculator.`,
    `FACTS: ${posted.length} posted journal entries; revenue ${incomeStatement.revenue}; net income ${incomeStatement.netIncome}; cash ${balanceSheet.cash}; ${bankReconciliations.filter((r) => r.reconciled).length}/${bankReconciliations.length} accounts reconciled.`,
    `CALCULATIONS: ${calcs.ids.length} calculation(s) referenced (ids in calcIds).`,
    `ASSUMPTIONS: ${agentGeneratedAssumptions.length} AI-generated assumption(s) are listed under "${AI_ASSUMPTION_LABEL}" and have not been reviewed by a professional.`,
    `PROFESSIONAL JUDGMENT: ${judgment.length} item(s) require your decision, including reasonable compensation, related-party treatment and international worker classification. ${questions.length} open question(s) and ${alerts.length} missing-document alert(s) are listed.`,
    "Nothing in this package has been filed, signed or paid; the system cannot do so.",
  ].join("\n\n");

  const pkg: CpaPackage = {
    id,
    version: CPA_PACKAGE_VERSION,
    from,
    to,
    taxYear,
    companyName: profile.displayName,
    isSyntheticData: profile.isSynthetic,
    generatedAt: nowISO(),
    trialBalance,
    generalLedger: { entries: posted.map((e) => glEntry(e, acct)), count: posted.length },
    incomeStatement,
    balanceSheet,
    cashFlowStatement,
    bankReconciliations,
    payrollReports: { runs: runs.map((r) => ({ id: r.id, payDate: r.payDate, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, workerCount: r.lines.length, totals: r.totals, journalEntryId: r.journalEntryId })), liabilities, byQuarter: [...quarters.values()].sort((a, b) => a.quarter.localeCompare(b.quarter)), totals, calcIds: payrollCalcIds },
    shareholderSummary: { officerCompensation: officerComp, distributions, dueFromShareholder: dueFrom, dueToShareholder: dueTo, capitalContributions: contributions, owners, note: REASONABLE_COMP_NOTE, calcId: shareholderCalc.id },
    fixedAssetSchedule: { assets, totalCost, totalAccumulated, calcId: faCalc.id },
    arAging: ar.value,
    apAging: ap.value,
    significantJournalEntries,
    taxWorkpapers: [federal, california],
    missingDocuments: { alerts, checklist },
    unresolvedAccountingQuestions: questions,
    transactionsRequiringTaxGuidance: taxGuidance,
    internationalWorkerQuestions,
    agentGeneratedAssumptions,
    coverMemo,
    calcIds: calcs.ids,
    sourceIds: calcs.sourceIds,
  };
  await persistCalcs(rt, calcs.calcs);
  await rt.store.upsertMany("taxWorkpapers", [federal, california]);
  return pkg;
}
