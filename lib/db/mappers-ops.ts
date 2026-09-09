/**
 * Domain ↔ row mapping for workforce, payroll, tax, fixed assets, documents and planning.
 * Helpers come from ./mappers-helpers; ./mappers re-exports this module.
 */
import type { Prisma } from "@prisma/client";
import type * as PC from "@prisma/client";
import { money } from "@/lib/core/money";
import type {
  Assumption,
  Budget,
  BudgetLine,
  DriverAssumption,
  Document,
  FixedAsset,
  Forecast,
  ForecastLine,
  InternationalWorkerReview,
  PayrollLiability,
  PayrollLine,
  PayrollRun,
  Scenario,
  TaxObligation,
  TaxRule,
  TaxWorkpaper,
  Worker,
} from "@/lib/core/types";
import {
  compact,
  dateTimeToISO,
  dateTimeToISOOpt,
  dateToISO,
  dateToISOOpt,
  decimalToString,
  decimalToStringOpt,
  fromJson,
  fromJsonOpt,
  isoToDate,
  isoToDateOpt,
  isoToDateTime,
  isoToDateTimeOpt,
  nullable,
  optional,
  stringToDecimal,
  stringToDecimalOpt,
  toJson,
  toJsonOpt,
} from "./mappers-helpers";

// ---------------------------------------------------------------------------
// Workforce & payroll
// ---------------------------------------------------------------------------

export function toWorkerRow(w: Worker): Prisma.WorkerCreateManyInput {
  return {
    id: w.id,
    displayName: w.displayName,
    roleTitle: w.roleTitle,
    country: w.country,
    workerType: w.workerType,
    classificationStatus: w.classificationStatus,
    compType: w.compensation.type,
    compAmount: stringToDecimal(w.compensation.amount),
    compCurrency: w.compensation.currency,
    compPeriod: w.compensation.period,
    compBasis: w.compensation.basis,
    compStatus: w.compensation.status,
    compNote: nullable(w.compensation.note),
    startDate: isoToDate(w.startDate),
    endDate: isoToDateOpt(w.endDate),
    isOwner: w.isOwner,
    relatedParty: w.relatedParty,
    relatedPartyNote: nullable(w.relatedPartyNote),
    payMethod: nullable(w.payMethod),
    documentIds: w.documentIds ?? [],
    internationalReview: toJsonOpt(w.internationalReview),
    isSynthetic: w.isSynthetic,
  };
}
export function fromWorkerRow(r: PC.Worker): Worker {
  return compact({
    id: r.id,
    displayName: r.displayName,
    roleTitle: r.roleTitle,
    country: r.country,
    workerType: r.workerType,
    classificationStatus: r.classificationStatus,
    compensation: compact({
      type: r.compType,
      amount: decimalToString(r.compAmount),
      currency: r.compCurrency,
      period: r.compPeriod,
      basis: r.compBasis,
      status: r.compStatus,
      note: optional(r.compNote),
    }),
    startDate: dateToISO(r.startDate),
    endDate: dateToISOOpt(r.endDate),
    isOwner: r.isOwner,
    relatedParty: r.relatedParty,
    relatedPartyNote: optional(r.relatedPartyNote),
    payMethod: optional(r.payMethod),
    documentIds: r.documentIds,
    internationalReview: fromJsonOpt<InternationalWorkerReview>(r.internationalReview),
    isSynthetic: r.isSynthetic,
  });
}

/** Canonicalize every DecimalString inside a payroll line before it is stored as JSON. */
function canonicalPayrollLine(l: PayrollLine): PayrollLine {
  const out = { ...l };
  for (const k of Object.keys(out) as (keyof PayrollLine)[]) {
    if (k !== "workerId") (out as Record<string, string>)[k] = money(out[k]);
  }
  return out;
}

export function toPayrollRunRow(p: PayrollRun): Prisma.PayrollRunCreateManyInput {
  const rec = p.reconciliation
    ? compact({
        ...p.reconciliation,
        varianceAmount: p.reconciliation.varianceAmount === undefined ? undefined : money(p.reconciliation.varianceAmount),
      })
    : undefined;
  return {
    id: p.id,
    periodStart: isoToDate(p.periodStart),
    periodEnd: isoToDate(p.periodEnd),
    payDate: isoToDate(p.payDate),
    currency: p.currency,
    providerRef: nullable(p.providerRef),
    status: p.status,
    lines: toJson(p.lines.map(canonicalPayrollLine)),
    totalGross: stringToDecimal(p.totals.gross),
    totalEmployeeTaxes: stringToDecimal(p.totals.employeeTaxes),
    totalOtherDeductions: stringToDecimal(p.totals.otherDeductions),
    totalNetPay: stringToDecimal(p.totals.netPay),
    totalEmployerTaxes: stringToDecimal(p.totals.employerTaxes),
    totalEmployerCost: stringToDecimal(p.totals.totalEmployerCost),
    journalEntryId: nullable(p.journalEntryId),
    netPayTransactionIds: p.netPayTransactionIds ?? [],
    rateAssumptionSetId: nullable(p.rateAssumptionSetId),
    reconciliation: toJsonOpt(rec),
  };
}
export function fromPayrollRunRow(r: PC.PayrollRun): PayrollRun {
  return compact({
    id: r.id,
    periodStart: dateToISO(r.periodStart),
    periodEnd: dateToISO(r.periodEnd),
    payDate: dateToISO(r.payDate),
    currency: r.currency,
    providerRef: optional(r.providerRef),
    status: r.status,
    lines: fromJson<PayrollLine[]>(r.lines),
    totals: {
      gross: decimalToString(r.totalGross),
      employeeTaxes: decimalToString(r.totalEmployeeTaxes),
      otherDeductions: decimalToString(r.totalOtherDeductions),
      netPay: decimalToString(r.totalNetPay),
      employerTaxes: decimalToString(r.totalEmployerTaxes),
      totalEmployerCost: decimalToString(r.totalEmployerCost),
    },
    journalEntryId: optional(r.journalEntryId),
    netPayTransactionIds: r.netPayTransactionIds,
    rateAssumptionSetId: optional(r.rateAssumptionSetId),
    reconciliation: fromJsonOpt<PayrollRun["reconciliation"]>(r.reconciliation),
  });
}

export function toPayrollLiabilityRow(l: PayrollLiability): Prisma.PayrollLiabilityCreateManyInput {
  return {
    id: l.id,
    payrollRunId: l.payrollRunId,
    kind: l.kind,
    amount: stringToDecimal(l.amount),
    currency: l.currency,
    accruedDate: isoToDate(l.accruedDate),
    dueDate: isoToDateOpt(l.dueDate),
    status: l.status,
    paidTransactionId: nullable(l.paidTransactionId),
    glAccountId: l.glAccountId,
    dueDateSourceRuleId: nullable(l.dueDateSourceRuleId),
  };
}
export function fromPayrollLiabilityRow(r: PC.PayrollLiability): PayrollLiability {
  return compact({
    id: r.id,
    payrollRunId: r.payrollRunId,
    kind: r.kind,
    amount: decimalToString(r.amount),
    currency: r.currency,
    accruedDate: dateToISO(r.accruedDate),
    dueDate: r.dueDate === null ? null : dateToISO(r.dueDate),
    status: r.status,
    paidTransactionId: optional(r.paidTransactionId),
    glAccountId: r.glAccountId,
    dueDateSourceRuleId: optional(r.dueDateSourceRuleId),
  });
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export function toTaxObligationRow(t: TaxObligation): Prisma.TaxObligationCreateManyInput {
  return {
    id: t.id,
    jurisdiction: t.jurisdiction,
    kind: t.kind,
    title: t.title,
    description: t.description,
    taxYear: t.taxYear,
    periodLabel: nullable(t.periodLabel),
    dueDate: isoToDateOpt(t.dueDate),
    amount: stringToDecimalOpt(t.amount),
    currency: t.currency,
    status: t.status,
    ruleSourceId: nullable(t.ruleSourceId),
    requiresCpaReview: t.requiresCpaReview,
    documentIds: t.documentIds ?? [],
    workpaperId: nullable(t.workpaperId),
    notes: t.notes ?? [],
  };
}
export function fromTaxObligationRow(r: PC.TaxObligation): TaxObligation {
  return compact({
    id: r.id,
    jurisdiction: r.jurisdiction,
    kind: r.kind,
    title: r.title,
    description: r.description,
    taxYear: r.taxYear,
    periodLabel: optional(r.periodLabel),
    dueDate: r.dueDate === null ? null : dateToISO(r.dueDate),
    amount: r.amount === null ? null : decimalToString(r.amount),
    currency: r.currency,
    status: r.status,
    ruleSourceId: optional(r.ruleSourceId),
    requiresCpaReview: r.requiresCpaReview,
    documentIds: r.documentIds,
    workpaperId: optional(r.workpaperId),
    notes: r.notes,
  });
}

export function toTaxRuleRow(t: TaxRule): Prisma.TaxRuleCreateManyInput {
  return {
    id: t.id,
    jurisdiction: t.jurisdiction,
    taxYear: t.taxYear,
    key: t.key,
    title: t.title,
    normalizedRule: t.normalizedRule,
    parameters: toJsonOpt(t.parameters),
    sourceId: t.sourceId,
    status: t.status,
    confidence: t.confidence,
    effectiveDate: isoToDateOpt(t.effectiveDate),
    reviewBy: isoToDate(t.reviewBy),
    approvedBy: nullable(t.approvedBy),
  };
}
export function fromTaxRuleRow(r: PC.TaxRule): TaxRule {
  return compact({
    id: r.id,
    jurisdiction: r.jurisdiction,
    taxYear: r.taxYear,
    key: r.key,
    title: r.title,
    normalizedRule: r.normalizedRule,
    parameters: fromJsonOpt<TaxRule["parameters"]>(r.parameters),
    sourceId: r.sourceId,
    status: r.status,
    confidence: r.confidence,
    effectiveDate: dateToISOOpt(r.effectiveDate),
    reviewBy: dateToISO(r.reviewBy),
    approvedBy: optional(r.approvedBy),
  });
}

export function toTaxWorkpaperRow(w: TaxWorkpaper): Prisma.TaxWorkpaperCreateManyInput {
  return {
    id: w.id,
    title: w.title,
    taxYear: w.taxYear,
    jurisdiction: w.jurisdiction,
    obligationId: nullable(w.obligationId),
    facts: toJson(w.facts),
    calculations: w.calculations ?? [],
    assumptions: toJson(w.assumptions),
    professionalJudgmentItems: w.professionalJudgmentItems ?? [],
    confidence: w.confidence,
    cpaReviewRequired: w.cpaReviewRequired,
    cpaReviewStatus: w.cpaReviewStatus,
    createdAt: isoToDateTime(w.createdAt),
    createdBy: w.createdBy,
  };
}
export function fromTaxWorkpaperRow(r: PC.TaxWorkpaper): TaxWorkpaper {
  return compact({
    id: r.id,
    title: r.title,
    taxYear: r.taxYear,
    jurisdiction: r.jurisdiction,
    obligationId: optional(r.obligationId),
    facts: fromJson<TaxWorkpaper["facts"]>(r.facts),
    calculations: r.calculations,
    assumptions: fromJson<Assumption[]>(r.assumptions),
    professionalJudgmentItems: r.professionalJudgmentItems,
    confidence: r.confidence,
    cpaReviewRequired: r.cpaReviewRequired,
    cpaReviewStatus: r.cpaReviewStatus,
    createdAt: dateTimeToISO(r.createdAt),
    createdBy: r.createdBy,
  });
}

// ---------------------------------------------------------------------------
// Fixed assets & documents
// ---------------------------------------------------------------------------

export function toFixedAssetRow(a: FixedAsset): Prisma.FixedAssetCreateManyInput {
  return {
    id: a.id,
    name: a.name,
    acquiredDate: isoToDate(a.acquiredDate),
    cost: stringToDecimal(a.cost),
    salvageValue: stringToDecimal(a.salvageValue),
    usefulLifeMonths: a.usefulLifeMonths,
    method: a.method,
    assetAccountId: a.assetAccountId,
    accumulatedDepreciationAccountId: a.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: a.depreciationExpenseAccountId,
    inServiceDate: isoToDate(a.inServiceDate),
    disposedDate: isoToDateOpt(a.disposedDate),
    sourceTransactionId: nullable(a.sourceTransactionId),
    documentId: nullable(a.documentId),
    taxTreatmentStatus: a.taxTreatmentStatus,
  };
}
export function fromFixedAssetRow(r: PC.FixedAsset): FixedAsset {
  return compact({
    id: r.id,
    name: r.name,
    acquiredDate: dateToISO(r.acquiredDate),
    cost: decimalToString(r.cost),
    salvageValue: decimalToString(r.salvageValue),
    usefulLifeMonths: r.usefulLifeMonths,
    method: r.method,
    assetAccountId: r.assetAccountId,
    accumulatedDepreciationAccountId: r.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: r.depreciationExpenseAccountId,
    inServiceDate: dateToISO(r.inServiceDate),
    disposedDate: dateToISOOpt(r.disposedDate),
    sourceTransactionId: optional(r.sourceTransactionId),
    documentId: optional(r.documentId),
    taxTreatmentStatus: r.taxTreatmentStatus,
  });
}

export function toDocumentRow(d: Document): Prisma.DocumentCreateManyInput {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    date: isoToDate(d.date),
    vendorId: nullable(d.vendorId),
    customerId: nullable(d.customerId),
    workerId: nullable(d.workerId),
    amount: stringToDecimalOpt(d.amount),
    currency: nullable(d.currency),
    linkedTransactionIds: d.linkedTransactionIds ?? [],
    linkedJournalEntryIds: d.linkedJournalEntryIds ?? [],
    storagePath: d.storagePath,
    mimeType: d.mimeType,
    extracted: toJsonOpt(d.extracted),
    classificationConfidence: d.classificationConfidence,
    retentionPolicyKey: d.retention.policyKey,
    retainUntil: isoToDateOpt(d.retention.retainUntil),
    isSynthetic: d.isSynthetic,
    tags: d.tags ?? [],
    uploadedAt: isoToDateTime(d.uploadedAt),
  };
}
export function fromDocumentRow(r: PC.Document): Document {
  return compact({
    id: r.id,
    kind: r.kind,
    title: r.title,
    date: dateToISO(r.date),
    vendorId: optional(r.vendorId),
    customerId: optional(r.customerId),
    workerId: optional(r.workerId),
    amount: decimalToStringOpt(r.amount),
    currency: optional(r.currency),
    linkedTransactionIds: r.linkedTransactionIds,
    linkedJournalEntryIds: r.linkedJournalEntryIds,
    storagePath: r.storagePath,
    mimeType: r.mimeType,
    extracted: fromJsonOpt<Record<string, unknown>>(r.extracted),
    classificationConfidence: r.classificationConfidence,
    retention: { policyKey: r.retentionPolicyKey, retainUntil: r.retainUntil === null ? null : dateToISO(r.retainUntil) },
    isSynthetic: r.isSynthetic,
    tags: r.tags,
    uploadedAt: dateTimeToISO(r.uploadedAt),
  });
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function toBudgetRow(b: Budget): Prisma.BudgetCreateManyInput {
  return {
    id: b.id,
    name: b.name,
    fiscalYear: b.fiscalYear,
    version: b.version,
    status: b.status,
    lines: toJson(b.lines.map((l) => compact({ ...l, amount: money(l.amount) }))),
    assumptions: toJson(b.assumptions),
    approvedBy: nullable(b.approvedBy),
    approvedAt: isoToDateTimeOpt(b.approvedAt),
    createdAt: isoToDateTime(b.createdAt),
  };
}
export function fromBudgetRow(r: PC.Budget): Budget {
  return compact({
    id: r.id,
    name: r.name,
    fiscalYear: r.fiscalYear,
    version: r.version,
    status: r.status,
    lines: fromJson<BudgetLine[]>(r.lines),
    assumptions: fromJson<Assumption[]>(r.assumptions),
    approvedBy: optional(r.approvedBy),
    approvedAt: dateTimeToISOOpt(r.approvedAt),
    createdAt: dateTimeToISO(r.createdAt),
  });
}

export function toForecastRow(f: Forecast): Prisma.ForecastCreateManyInput {
  return {
    id: f.id,
    name: f.name,
    asOfDate: isoToDate(f.asOfDate),
    horizonMonths: f.horizonMonths,
    drivers: toJson(f.drivers),
    lines: toJson(f.lines.map((l) => compact({ ...l, amount: money(l.amount) }))),
    status: f.status,
    version: f.version,
    createdAt: isoToDateTime(f.createdAt),
    createdBy: f.createdBy,
    calcIds: f.calcIds ?? [],
  };
}
export function fromForecastRow(r: PC.Forecast): Forecast {
  return compact({
    id: r.id,
    name: r.name,
    asOfDate: dateToISO(r.asOfDate),
    horizonMonths: r.horizonMonths,
    drivers: fromJson<Record<string, DriverAssumption>>(r.drivers),
    lines: fromJson<ForecastLine[]>(r.lines),
    status: r.status,
    version: r.version,
    createdAt: dateTimeToISO(r.createdAt),
    createdBy: r.createdBy,
    calcIds: r.calcIds,
  });
}

export function toScenarioRow(s: Scenario): Prisma.ScenarioCreateManyInput {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    baseForecastId: s.baseForecastId,
    driverOverrides: toJson(s.driverOverrides),
    events: toJson(s.events.map((e) => ({ ...e, amount: money(e.amount) }))),
    createdAt: isoToDateTime(s.createdAt),
    createdBy: s.createdBy,
  };
}
export function fromScenarioRow(r: PC.Scenario): Scenario {
  return compact({
    id: r.id,
    name: r.name,
    description: r.description,
    baseForecastId: r.baseForecastId,
    driverOverrides: fromJson<Scenario["driverOverrides"]>(r.driverOverrides),
    events: fromJson<Scenario["events"]>(r.events),
    createdAt: dateTimeToISO(r.createdAt),
    createdBy: r.createdBy,
  });
}
