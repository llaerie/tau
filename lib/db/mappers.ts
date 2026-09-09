/**
 * Domain ↔ Prisma row mapping.
 *
 * Scalar rules live in mappers-helpers.ts (exact decimals, UTC dates, undefined ↔ NULL).
 * This file holds the profile, configuration, ledger, banking and AR/AP mappers.
 * Workforce/tax/assets/planning live in mappers-ops.ts; governance/knowledge/eval in
 * mappers-governance.ts. Everything is re-exported from here.
 */
import type { Prisma } from "@prisma/client";
import type * as PC from "@prisma/client";
import { money } from "@/lib/core/money";
import type {
  Account,
  AgentName,
  BankAccount,
  Bill,
  Card,
  CompanyProfile,
  ConfigField,
  Customer,
  ID,
  Invoice,
  InvoiceLine,
  JournalEntry,
  JournalLine,
  PaymentApplication,
  Payment,
  Period,
  Transaction,
  TransactionCategory,
  Vendor,
} from "@/lib/core/types";

import {
  compact,
  dateTimeToISO,
  dateTimeToISOOpt,
  dateToISO,
  dateToISOOpt,
  decimalToString,
  entityRefFromRow,
  fromJson,
  fromJsonOpt,
  isoToDate,
  isoToDateOpt,
  isoToDateTime,
  isoToDateTimeOpt,
  nullable,
  optional,
  stringToDecimal,
  toJson,
  toJsonOpt,
} from "./mappers-helpers";

export * from "./mappers-helpers";
export * from "./mappers-ops";
export * from "./mappers-governance";

// ---------------------------------------------------------------------------
// Company profile & config fields
// ---------------------------------------------------------------------------

export function toCompanyProfileRow(p: CompanyProfile): Prisma.CompanyProfileCreateManyInput {
  return {
    id: p.id,
    displayName: p.displayName,
    isSynthetic: p.isSynthetic,
    entityType: toJson(p.entityType),
    taxElection: toJson(p.taxElection),
    state: toJson(p.state),
    fiscalYearEnd: toJson(p.fiscalYearEnd),
    accountingMethod: toJson(p.accountingMethod),
    functionalCurrency: p.functionalCurrency,
    asOfDate: isoToDate(p.asOfDate),
  };
}
export function fromCompanyProfileRow(r: PC.CompanyProfile): CompanyProfile {
  return {
    id: r.id,
    displayName: r.displayName,
    isSynthetic: r.isSynthetic,
    entityType: fromJson<ConfigField<string>>(r.entityType),
    taxElection: fromJson<ConfigField<string>>(r.taxElection),
    state: fromJson<ConfigField<string>>(r.state),
    fiscalYearEnd: fromJson<ConfigField<string>>(r.fiscalYearEnd),
    accountingMethod: fromJson<ConfigField<"CASH" | "ACCRUAL">>(r.accountingMethod),
    functionalCurrency: r.functionalCurrency,
    asOfDate: dateToISO(r.asOfDate),
  };
}

export function configFieldRowId(f: Pick<ConfigField, "section" | "key">): { section: string; key: string } {
  return { section: f.section, key: f.key };
}
export function toConfigFieldRow(f: ConfigField): Prisma.ConfigFieldCreateManyInput {
  return {
    section: f.section,
    key: f.key,
    label: f.label,
    value: toJsonOpt(f.value),
    status: f.status,
    note: nullable(f.note),
    requiredConfirmer: nullable(f.requiredConfirmer),
    updatedBy: nullable(f.updatedBy),
    sourceIds: f.sourceIds ?? [],
    synthetic: f.synthetic ?? false,
    ...(f.updatedAt ? { updatedAt: isoToDateTime(f.updatedAt) } : {}),
  };
}
export function fromConfigFieldRow(r: PC.ConfigField): ConfigField {
  return compact({
    key: r.key,
    section: r.section,
    label: r.label,
    value: r.value === null ? null : (r.value as unknown),
    status: r.status,
    note: optional(r.note),
    requiredConfirmer: optional(r.requiredConfirmer),
    updatedAt: dateTimeToISO(r.updatedAt),
    updatedBy: optional(r.updatedBy),
    sourceIds: r.sourceIds,
    synthetic: r.synthetic || undefined,
  });
}

// ---------------------------------------------------------------------------
// Chart of accounts, periods, ledger
// ---------------------------------------------------------------------------

export function toAccountRow(a: Account): Prisma.AccountCreateManyInput {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    normalBalance: a.normalBalance,
    cashFlowSection: nullable(a.cashFlowSection),
    parentId: nullable(a.parentId),
    isActive: a.isActive,
    description: nullable(a.description),
    restricted: a.restricted ?? false,
  };
}
export function fromAccountRow(r: PC.Account): Account {
  return compact({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    subtype: r.subtype,
    normalBalance: r.normalBalance,
    cashFlowSection: optional(r.cashFlowSection),
    parentId: optional(r.parentId),
    isActive: r.isActive,
    description: optional(r.description),
    restricted: r.restricted || undefined,
  });
}

export function toPeriodRow(p: Period): Prisma.PeriodCreateManyInput {
  return {
    id: p.id,
    year: p.year,
    month: p.month,
    startDate: isoToDate(p.startDate),
    endDate: isoToDate(p.endDate),
    status: p.status,
    lockedAt: isoToDateTimeOpt(p.lockedAt),
    lockedBy: nullable(p.lockedBy),
    lockApprovalId: nullable(p.lockApprovalId),
    closeChecklistId: nullable(p.closeChecklistId),
    tags: p.tags ?? [],
  };
}
export function fromPeriodRow(r: PC.Period): Period {
  return compact({
    id: r.id,
    year: r.year,
    month: r.month,
    startDate: dateToISO(r.startDate),
    endDate: dateToISO(r.endDate),
    status: r.status,
    lockedAt: dateTimeToISOOpt(r.lockedAt),
    lockedBy: optional(r.lockedBy),
    lockApprovalId: optional(r.lockApprovalId),
    closeChecklistId: optional(r.closeChecklistId),
    tags: r.tags,
  });
}

export interface JournalEntryRows {
  entry: Prisma.JournalEntryCreateManyInput;
  lines: Prisma.JournalLineCreateManyInput[];
}
export function toJournalLineRow(line: JournalLine, entryId: ID, lineNo: number): Prisma.JournalLineCreateManyInput {
  return {
    id: line.id,
    entryId,
    lineNo,
    accountId: line.accountId,
    debit: stringToDecimal(line.debit),
    credit: stringToDecimal(line.credit),
    currency: line.currency,
    memo: nullable(line.memo),
    entityRefType: line.entityRef?.type ?? null,
    entityRefId: line.entityRef?.id ?? null,
  };
}
export function toJournalEntryRows(e: JournalEntry): JournalEntryRows {
  return {
    entry: {
      id: e.id,
      entryNumber: e.entryNumber,
      date: isoToDate(e.date),
      periodId: e.periodId,
      description: e.description,
      memo: nullable(e.memo),
      status: e.status,
      source: e.source,
      sourceIds: e.sourceIds ?? [],
      createdBy: e.createdBy,
      createdAt: isoToDateTime(e.createdAt),
      postedAt: isoToDateTimeOpt(e.postedAt),
      approvalId: nullable(e.approvalId),
      reversesEntryId: nullable(e.reversesEntryId),
      reversedByEntryId: nullable(e.reversedByEntryId),
      tags: e.tags ?? [],
    },
    lines: e.lines.map((l, i) => toJournalLineRow(l, e.id, i)),
  };
}
export function fromJournalLineRow(r: PC.JournalLine): JournalLine {
  return compact({
    id: r.id,
    accountId: r.accountId,
    debit: decimalToString(r.debit),
    credit: decimalToString(r.credit),
    currency: r.currency,
    memo: optional(r.memo),
    entityRef: entityRefFromRow(r.entityRefType, r.entityRefId),
  });
}
export function fromJournalEntryRow(r: PC.JournalEntry & { lines: PC.JournalLine[] }): JournalEntry {
  const lines = [...r.lines].sort((a, b) => a.lineNo - b.lineNo).map(fromJournalLineRow);
  return compact({
    id: r.id,
    entryNumber: r.entryNumber,
    date: dateToISO(r.date),
    periodId: r.periodId,
    description: r.description,
    memo: optional(r.memo),
    status: r.status,
    source: r.source,
    lines,
    sourceIds: r.sourceIds,
    createdBy: r.createdBy,
    createdAt: dateTimeToISO(r.createdAt),
    postedAt: dateTimeToISOOpt(r.postedAt),
    approvalId: optional(r.approvalId),
    reversesEntryId: optional(r.reversesEntryId),
    reversedByEntryId: optional(r.reversedByEntryId),
    tags: r.tags,
  });
}

// ---------------------------------------------------------------------------
// Bank, cards, transactions
// ---------------------------------------------------------------------------

export function toBankAccountRow(b: BankAccount): Prisma.BankAccountCreateManyInput {
  return {
    id: b.id,
    name: b.name,
    institution: b.institution,
    accountType: b.accountType,
    last4: b.last4,
    currency: b.currency,
    glAccountId: b.glAccountId,
    isSynthetic: b.isSynthetic,
    openedDate: isoToDateOpt(b.openedDate),
  };
}
export function fromBankAccountRow(r: PC.BankAccount): BankAccount {
  return compact({
    id: r.id,
    name: r.name,
    institution: r.institution,
    accountType: r.accountType,
    last4: r.last4,
    currency: r.currency,
    glAccountId: r.glAccountId,
    isSynthetic: r.isSynthetic,
    openedDate: dateToISOOpt(r.openedDate),
  });
}

export function toCardRow(c: Card): Prisma.CardCreateManyInput {
  return {
    id: c.id,
    name: c.name,
    issuer: c.issuer,
    last4: c.last4,
    currency: c.currency,
    glAccountId: c.glAccountId,
    isSynthetic: c.isSynthetic,
    statementCloseDay: nullable(c.statementCloseDay),
    paymentDueDay: nullable(c.paymentDueDay),
  };
}
export function fromCardRow(r: PC.Card): Card {
  return compact({
    id: r.id,
    name: r.name,
    issuer: r.issuer,
    last4: r.last4,
    currency: r.currency,
    glAccountId: r.glAccountId,
    isSynthetic: r.isSynthetic,
    statementCloseDay: optional(r.statementCloseDay),
    paymentDueDay: optional(r.paymentDueDay),
  });
}

export function toTransactionRow(t: Transaction): Prisma.TransactionCreateManyInput {
  const c = t.category;
  return {
    id: t.id,
    sourceKind: t.sourceKind,
    sourceAccountId: t.sourceAccountId,
    externalId: t.externalId,
    date: isoToDate(t.date),
    postedDate: isoToDate(t.postedDate),
    amount: stringToDecimal(t.amount),
    currency: t.currency,
    descriptionRaw: t.descriptionRaw,
    merchantNormalized: nullable(t.merchantNormalized),
    counterpartyRefType: t.counterpartyRef?.type ?? null,
    counterpartyRefId: t.counterpartyRef?.id ?? null,
    categoryAccountId: c.accountId,
    categoryStatus: c.status,
    categoryConfidence: c.confidence,
    categoryReason: nullable(c.reason),
    categorySuggestedBy: nullable(c.suggestedBy),
    categoryApprovedBy: nullable(c.approvedBy),
    categorySplits: toJsonOpt(c.splits?.map((s) => ({ ...s, amount: money(s.amount) }))),
    journalEntryId: nullable(t.journalEntryId),
    documentIds: t.documentIds ?? [],
    transferPairId: nullable(t.transferPairId),
    duplicateOfId: nullable(t.duplicateOfId),
    flags: t.flags ?? [],
    importBatchId: t.importBatchId,
    meta: toJsonOpt(t.meta),
  };
}
export function fromTransactionRow(r: PC.Transaction): Transaction {
  const category: TransactionCategory = compact({
    accountId: r.categoryAccountId,
    status: r.categoryStatus,
    confidence: r.categoryConfidence,
    reason: optional(r.categoryReason),
    suggestedBy: optional(r.categorySuggestedBy) as TransactionCategory["suggestedBy"],
    approvedBy: optional(r.categoryApprovedBy),
    splits: fromJsonOpt<TransactionCategory["splits"]>(r.categorySplits),
  });
  return compact({
    id: r.id,
    sourceKind: r.sourceKind,
    sourceAccountId: r.sourceAccountId,
    externalId: r.externalId,
    date: dateToISO(r.date),
    postedDate: dateToISO(r.postedDate),
    amount: decimalToString(r.amount),
    currency: r.currency,
    descriptionRaw: r.descriptionRaw,
    merchantNormalized: optional(r.merchantNormalized),
    counterpartyRef: entityRefFromRow(r.counterpartyRefType, r.counterpartyRefId),
    category,
    journalEntryId: optional(r.journalEntryId),
    documentIds: r.documentIds,
    transferPairId: optional(r.transferPairId),
    duplicateOfId: optional(r.duplicateOfId),
    flags: r.flags,
    importBatchId: r.importBatchId,
    meta: fromJsonOpt<Record<string, unknown>>(r.meta),
  });
}

// ---------------------------------------------------------------------------
// Counterparties, AR / AP
// ---------------------------------------------------------------------------

export function toVendorRow(v: Vendor): Prisma.VendorCreateManyInput {
  return {
    id: v.id,
    name: v.name,
    normalizedNames: v.normalizedNames ?? [],
    defaultAccountId: nullable(v.defaultAccountId),
    paymentTermsDays: nullable(v.paymentTermsDays),
    isRecurring: v.isRecurring,
    category: nullable(v.category),
    country: v.country,
    taxDocStatus: v.taxDocStatus,
    active: v.active,
    createdAt: isoToDateTime(v.createdAt),
    approvedBy: nullable(v.approvedBy),
  };
}
export function fromVendorRow(r: PC.Vendor): Vendor {
  return compact({
    id: r.id,
    name: r.name,
    normalizedNames: r.normalizedNames,
    defaultAccountId: optional(r.defaultAccountId),
    paymentTermsDays: optional(r.paymentTermsDays),
    isRecurring: r.isRecurring,
    category: optional(r.category),
    country: r.country,
    taxDocStatus: r.taxDocStatus,
    active: r.active,
    createdAt: dateTimeToISO(r.createdAt),
    approvedBy: optional(r.approvedBy),
  });
}

export function toCustomerRow(c: Customer): Prisma.CustomerCreateManyInput {
  return {
    id: c.id,
    name: c.name,
    paymentTermsDays: c.paymentTermsDays,
    country: c.country,
    relatedParty: c.relatedParty,
    relatedPartyNote: nullable(c.relatedPartyNote),
    contractDocumentId: nullable(c.contractDocumentId),
    active: c.active,
  };
}
export function fromCustomerRow(r: PC.Customer): Customer {
  return compact({
    id: r.id,
    name: r.name,
    paymentTermsDays: r.paymentTermsDays,
    country: r.country,
    relatedParty: r.relatedParty,
    relatedPartyNote: optional(r.relatedPartyNote),
    contractDocumentId: optional(r.contractDocumentId),
    active: r.active,
  });
}

export interface InvoiceRows {
  invoice: Prisma.InvoiceCreateManyInput;
  lines: Prisma.InvoiceLineCreateManyInput[];
}
export function toInvoiceLineRow(l: InvoiceLine, invoiceId: ID, lineNo: number): Prisma.InvoiceLineCreateManyInput {
  return {
    id: l.id,
    invoiceId,
    lineNo,
    description: l.description,
    quantity: stringToDecimal(l.quantity),
    unitPrice: stringToDecimal(l.unitPrice),
    amount: stringToDecimal(l.amount),
    revenueAccountId: l.revenueAccountId,
  };
}
export function toInvoiceRows(inv: Invoice): InvoiceRows {
  return {
    invoice: {
      id: inv.id,
      number: inv.number,
      customerId: inv.customerId,
      issueDate: isoToDate(inv.issueDate),
      dueDate: isoToDate(inv.dueDate),
      servicePeriodStart: isoToDateOpt(inv.servicePeriodStart),
      servicePeriodEnd: isoToDateOpt(inv.servicePeriodEnd),
      currency: inv.currency,
      total: stringToDecimal(inv.total),
      amountPaid: stringToDecimal(inv.amountPaid),
      status: inv.status,
      journalEntryId: nullable(inv.journalEntryId),
      documentId: nullable(inv.documentId),
      paymentIds: inv.paymentIds ?? [],
    },
    lines: inv.lines.map((l, i) => toInvoiceLineRow(l, inv.id, i)),
  };
}
export function fromInvoiceLineRow(r: PC.InvoiceLine): InvoiceLine {
  return {
    id: r.id,
    description: r.description,
    quantity: decimalToString(r.quantity),
    unitPrice: decimalToString(r.unitPrice),
    amount: decimalToString(r.amount),
    revenueAccountId: r.revenueAccountId,
  };
}
export function fromInvoiceRow(r: PC.Invoice & { lines: PC.InvoiceLine[] }): Invoice {
  return compact({
    id: r.id,
    number: r.number,
    customerId: r.customerId,
    issueDate: dateToISO(r.issueDate),
    dueDate: dateToISO(r.dueDate),
    servicePeriodStart: dateToISOOpt(r.servicePeriodStart),
    servicePeriodEnd: dateToISOOpt(r.servicePeriodEnd),
    currency: r.currency,
    total: decimalToString(r.total),
    amountPaid: decimalToString(r.amountPaid),
    status: r.status,
    lines: [...r.lines].sort((a, b) => a.lineNo - b.lineNo).map(fromInvoiceLineRow),
    journalEntryId: optional(r.journalEntryId),
    documentId: optional(r.documentId),
    paymentIds: r.paymentIds,
  });
}

export function toBillRow(b: Bill): Prisma.BillCreateManyInput {
  return {
    id: b.id,
    vendorId: b.vendorId,
    number: b.number,
    receivedDate: isoToDate(b.receivedDate),
    billDate: isoToDate(b.billDate),
    dueDate: isoToDate(b.dueDate),
    currency: b.currency,
    total: stringToDecimal(b.total),
    amountPaid: stringToDecimal(b.amountPaid),
    status: b.status,
    expenseAccountId: b.expenseAccountId,
    description: b.description,
    documentId: nullable(b.documentId),
    journalEntryId: nullable(b.journalEntryId),
    paymentIds: b.paymentIds ?? [],
    duplicateOfId: nullable(b.duplicateOfId),
    approvalId: nullable(b.approvalId),
  };
}
export function fromBillRow(r: PC.Bill): Bill {
  return compact({
    id: r.id,
    vendorId: r.vendorId,
    number: r.number,
    receivedDate: dateToISO(r.receivedDate),
    billDate: dateToISO(r.billDate),
    dueDate: dateToISO(r.dueDate),
    currency: r.currency,
    total: decimalToString(r.total),
    amountPaid: decimalToString(r.amountPaid),
    status: r.status,
    expenseAccountId: r.expenseAccountId,
    description: r.description,
    documentId: optional(r.documentId),
    journalEntryId: optional(r.journalEntryId),
    paymentIds: r.paymentIds,
    duplicateOfId: optional(r.duplicateOfId),
    approvalId: optional(r.approvalId),
  });
}

export function toPaymentRow(p: Payment): Prisma.PaymentCreateManyInput {
  return {
    id: p.id,
    direction: p.direction,
    date: isoToDate(p.date),
    amount: stringToDecimal(p.amount),
    currency: p.currency,
    method: p.method,
    counterpartyRefType: p.counterpartyRef?.type ?? null,
    counterpartyRefId: p.counterpartyRef?.id ?? null,
    applications: toJson(p.applications.map((a) => ({ ...a, amount: money(a.amount) }))),
    transactionId: nullable(p.transactionId),
    journalEntryId: nullable(p.journalEntryId),
    memo: nullable(p.memo),
  };
}
export function fromPaymentRow(r: PC.Payment): Payment {
  return compact({
    id: r.id,
    direction: r.direction,
    date: dateToISO(r.date),
    amount: decimalToString(r.amount),
    currency: r.currency,
    method: r.method,
    counterpartyRef: entityRefFromRow(r.counterpartyRefType, r.counterpartyRefId),
    applications: fromJson<PaymentApplication[]>(r.applications),
    transactionId: optional(r.transactionId),
    journalEntryId: optional(r.journalEntryId),
    memo: optional(r.memo),
  });
}

/** Agent names are stored as plain strings; narrow on the way out. */
export const asAgentName = (s: string): AgentName => s as AgentName;
