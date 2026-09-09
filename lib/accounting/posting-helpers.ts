/**
 * Pure builders of `NewJournalEntryInput` for the standard business events. Nothing here touches
 * the ledger; the synthetic generator and agents pass the result to `Ledger.createEntry`.
 * Amounts are normalized with `money()`; every builder yields a balanced entry by construction.
 */
import { D, abs, add, money } from "@/lib/core/money";
import type { NewJournalEntryInput, NewJournalLineInput } from "@/lib/core/contracts";
import type { Bill, DecimalString, ID, ISODate, Invoice, JournalSource, Payment, PayrollLiability, PayrollRun, Transaction, Worker } from "@/lib/core/types";
import { ACCT } from "./chart-of-accounts";

export interface EntryOptions {
  id?: ID;
  post?: boolean;
  memo?: string;
  tags?: string[];
  sourceIds?: ID[];
  approvalId?: ID;
  description?: string;
  source?: JournalSource;
}

type Numeric = DecimalString | number;

function finish(base: NewJournalEntryInput, opts: EntryOptions = {}): NewJournalEntryInput {
  return {
    ...base,
    id: opts.id ?? base.id,
    description: opts.description ?? base.description,
    memo: opts.memo ?? base.memo,
    source: opts.source ?? base.source,
    sourceIds: [...new Set([...(base.sourceIds ?? []), ...(opts.sourceIds ?? [])])],
    tags: [...new Set([...(base.tags ?? []), ...(opts.tags ?? [])])],
    post: opts.post ?? base.post,
    approvalId: opts.approvalId ?? base.approvalId,
  };
}

function txDescription(tx: Transaction): string {
  return tx.merchantNormalized ? `${tx.merchantNormalized} — ${tx.descriptionRaw}` : tx.descriptionRaw;
}

/** Two-line entry: `amount` debited to `debitCode`, credited to `creditCode`. */
export function simpleEntry(date: ISODate, description: string, source: JournalSource, debitCode: string, creditCode: string, amount: Numeric, opts: EntryOptions = {}): NewJournalEntryInput {
  const amt = money(amount);
  if (D(amt).lte(0)) throw new Error(`Entry amount must be positive: ${amt}`);
  return finish({ date, description, source, lines: [{ accountCode: debitCode, debit: amt }, { accountCode: creditCode, credit: amt }] }, opts);
}

/**
 * Bank transaction: outflow (negative) → Dr expense / Cr bank; inflow (positive) → Dr bank / Cr revenue.
 * `expenseOrRevenueAccountCode` is the offset account; `bankGlCode` is the bank's GL account code.
 */
export function entryForBankTransaction(tx: Transaction, expenseOrRevenueAccountCode: string, bankGlCode: string, opts: EntryOptions = {}): NewJournalEntryInput {
  const amt = abs(tx.amount);
  const outflow = D(tx.amount).lt(0);
  const base: NewJournalEntryInput = {
    date: tx.date,
    description: txDescription(tx),
    source: "BANK_IMPORT",
    lines: outflow
      ? [
          { accountCode: expenseOrRevenueAccountCode, debit: amt, entityRef: tx.counterpartyRef },
          { accountCode: bankGlCode, credit: amt },
        ]
      : [
          { accountCode: bankGlCode, debit: amt },
          { accountCode: expenseOrRevenueAccountCode, credit: amt, entityRef: tx.counterpartyRef },
        ],
    sourceIds: [tx.id, ...tx.documentIds],
    tags: ["bank-transaction"],
  };
  return finish(base, opts);
}

/** Card charge (negative) → Dr expense / Cr card liability; credit/refund on the card (positive) → Dr card / Cr expense. */
export function entryForCardCharge(tx: Transaction, expenseAccountCode: string, cardGlCode: string = ACCT.CREDIT_CARD, opts: EntryOptions = {}): NewJournalEntryInput {
  const amt = abs(tx.amount);
  const charge = D(tx.amount).lt(0);
  const base: NewJournalEntryInput = {
    date: tx.date,
    description: txDescription(tx),
    source: "CARD_IMPORT",
    lines: charge
      ? [
          { accountCode: expenseAccountCode, debit: amt, entityRef: tx.counterpartyRef },
          { accountCode: cardGlCode, credit: amt },
        ]
      : [
          { accountCode: cardGlCode, debit: amt },
          { accountCode: expenseAccountCode, credit: amt, entityRef: tx.counterpartyRef },
        ],
    sourceIds: [tx.id, ...tx.documentIds],
    tags: ["card-transaction"],
  };
  return finish(base, opts);
}

/** Invoice issued: Dr AR total / Cr each line's revenue account. */
export function entryForInvoiceIssued(invoice: Invoice, opts: EntryOptions = {}): NewJournalEntryInput {
  const lineTotal = add(...invoice.lines.map((l) => l.amount));
  if (money(lineTotal) !== money(invoice.total)) {
    throw new Error(`Invoice ${invoice.number} line total ${money(lineTotal)} != invoice total ${money(invoice.total)}`);
  }
  const customer = { type: "CUSTOMER" as const, id: invoice.customerId };
  const lines: NewJournalLineInput[] = [
    { accountCode: ACCT.AR, debit: money(invoice.total), memo: `Invoice ${invoice.number}`, entityRef: customer },
    ...invoice.lines.map<NewJournalLineInput>((l) => ({ accountId: l.revenueAccountId, credit: money(l.amount), memo: l.description, entityRef: customer })),
  ];
  return finish(
    { date: invoice.issueDate, description: `Invoice ${invoice.number} issued`, source: "AR", lines, sourceIds: [invoice.id, ...(invoice.documentId ? [invoice.documentId] : [])], tags: ["invoice"] },
    opts,
  );
}

function appliedAmount(payment: Payment, targetType: "INVOICE" | "BILL", targetId: ID): DecimalString {
  const apps = payment.applications.filter((a) => a.targetType === targetType && a.targetId === targetId);
  return apps.length ? add(...apps.map((a) => a.amount)) : money(payment.amount);
}

/** Customer payment: Dr bank / Cr AR for the amount applied to the invoice. */
export function entryForInvoicePayment(invoice: Invoice, payment: Payment, bankCode: string = ACCT.CHECKING, opts: EntryOptions = {}): NewJournalEntryInput {
  const amt = appliedAmount(payment, "INVOICE", invoice.id);
  const customer = { type: "CUSTOMER" as const, id: invoice.customerId };
  return finish(
    {
      date: payment.date,
      description: `Payment received for invoice ${invoice.number}`,
      source: "AR",
      lines: [
        { accountCode: bankCode, debit: amt, entityRef: customer },
        { accountCode: ACCT.AR, credit: amt, memo: `Invoice ${invoice.number}`, entityRef: customer },
      ],
      sourceIds: [payment.id, invoice.id, ...(payment.transactionId ? [payment.transactionId] : [])],
      tags: ["invoice-payment"],
    },
    opts,
  );
}

/** Vendor bill received: Dr expense account / Cr AP. */
export function entryForBillReceived(bill: Bill, opts: EntryOptions = {}): NewJournalEntryInput {
  const vendor = { type: "VENDOR" as const, id: bill.vendorId };
  return finish(
    {
      date: bill.billDate,
      description: `Bill ${bill.number}: ${bill.description}`,
      source: "AP",
      lines: [
        { accountId: bill.expenseAccountId, debit: money(bill.total), memo: bill.description, entityRef: vendor },
        { accountCode: ACCT.AP, credit: money(bill.total), memo: `Bill ${bill.number}`, entityRef: vendor },
      ],
      sourceIds: [bill.id, ...(bill.documentId ? [bill.documentId] : [])],
      tags: ["bill"],
    },
    opts,
  );
}

/** Bill payment: Dr AP / Cr bank for the amount applied to the bill. */
export function entryForBillPayment(bill: Bill, payment: Payment, bankCode: string = ACCT.CHECKING, opts: EntryOptions = {}): NewJournalEntryInput {
  const amt = appliedAmount(payment, "BILL", bill.id);
  const vendor = { type: "VENDOR" as const, id: bill.vendorId };
  return finish(
    {
      date: payment.date,
      description: `Payment of bill ${bill.number}`,
      source: "AP",
      lines: [
        { accountCode: ACCT.AP, debit: amt, memo: `Bill ${bill.number}`, entityRef: vendor },
        { accountCode: bankCode, credit: amt, entityRef: vendor },
      ],
      sourceIds: [payment.id, bill.id, ...(payment.transactionId ? [payment.transactionId] : [])],
      tags: ["bill-payment"],
    },
    opts,
  );
}

/**
 * Payroll run:
 *   Dr 6000 salaries (non-owners) / Dr 6010 officer compensation (owners) — gross
 *   Dr 6100 employer payroll taxes (SS + Medicare employer, FUTA, SUI, ETT)
 *   Dr 6150 employee benefits (other employer costs, if any)
 *   Cr bank — net pay
 *   Cr 2200 federal withholding + employee & employer FICA
 *   Cr 2210 state withholding + SDI
 *   Cr 2220 FUTA
 *   Cr 2230 SUI + ETT
 *   Cr 2150 accrued payroll — other deductions + other employer costs
 */
export function entryForPayrollRun(run: PayrollRun, workers: readonly Worker[], bankCode: string = ACCT.CHECKING, opts: EntryOptions = {}): NewJournalEntryInput {
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const lines: NewJournalLineInput[] = [];
  let employerTaxes = D(0);
  let otherEmployer = D(0);
  let netPay = D(0);
  let federal = D(0);
  let state = D(0);
  let futa = D(0);
  let sui = D(0);
  let accrued = D(0);

  for (const l of run.lines) {
    const w = workerById.get(l.workerId);
    if (!w) throw new Error(`Payroll run ${run.id} references unknown worker ${l.workerId}`);
    const gross = D(l.gross);
    // Per-worker expense lines keep the entity reference for the auditor.
    lines.push({ accountCode: w.isOwner ? ACCT.OFFICER_COMP : ACCT.SALARIES, debit: money(gross), memo: `${w.displayName} gross`, entityRef: { type: w.isOwner ? "OWNER" : "EMPLOYEE", id: w.id } });

    const erTaxes = D(l.socialSecurityEmployer).plus(D(l.medicareEmployer)).plus(D(l.federalUnemploymentEmployer)).plus(D(l.stateUnemploymentEmployer)).plus(D(l.stateTrainingTaxEmployer));
    employerTaxes = employerTaxes.plus(erTaxes);
    otherEmployer = otherEmployer.plus(D(l.otherEmployerCosts));
    netPay = netPay.plus(D(l.netPay));
    federal = federal.plus(D(l.federalIncomeTaxWithheld)).plus(D(l.socialSecurityEmployee)).plus(D(l.medicareEmployee)).plus(D(l.socialSecurityEmployer)).plus(D(l.medicareEmployer));
    state = state.plus(D(l.stateIncomeTaxWithheld)).plus(D(l.stateDisabilityEmployee));
    futa = futa.plus(D(l.federalUnemploymentEmployer));
    sui = sui.plus(D(l.stateUnemploymentEmployer)).plus(D(l.stateTrainingTaxEmployer));
    accrued = accrued.plus(D(l.otherDeductions)).plus(D(l.otherEmployerCosts));
  }
  if (employerTaxes.gt(0)) lines.push({ accountCode: ACCT.EMPLOYER_PAYROLL_TAX, debit: money(employerTaxes), memo: "Employer payroll taxes" });
  if (otherEmployer.gt(0)) lines.push({ accountCode: ACCT.BENEFITS, debit: money(otherEmployer), memo: "Other employer costs" });
  if (netPay.gt(0)) lines.push({ accountCode: bankCode, credit: money(netPay), memo: "Net pay" });
  if (federal.gt(0)) lines.push({ accountCode: ACCT.FED_PAYROLL_TAX_PAYABLE, credit: money(federal), memo: "Federal withholding + FICA (employee & employer)" });
  if (state.gt(0)) lines.push({ accountCode: ACCT.STATE_PAYROLL_TAX_PAYABLE, credit: money(state), memo: "State withholding + SDI" });
  if (futa.gt(0)) lines.push({ accountCode: ACCT.FUTA_PAYABLE, credit: money(futa), memo: "FUTA" });
  if (sui.gt(0)) lines.push({ accountCode: ACCT.SUI_PAYABLE, credit: money(sui), memo: "SUI + ETT" });
  if (accrued.gt(0)) lines.push({ accountCode: ACCT.ACCRUED_PAYROLL, credit: money(accrued), memo: "Other deductions / employer costs" });

  return finish(
    {
      date: run.payDate,
      description: `Payroll ${run.periodStart} to ${run.periodEnd} (paid ${run.payDate})`,
      source: "PAYROLL",
      lines,
      sourceIds: [run.id, ...run.netPayTransactionIds],
      tags: ["payroll"],
    },
    opts,
  );
}

/** Remittance of an accrued payroll liability: Dr liability GL / Cr bank. */
export function entryForPayrollLiabilityPayment(liability: PayrollLiability, bankCode: string = ACCT.CHECKING, date?: ISODate, opts: EntryOptions = {}): NewJournalEntryInput {
  const when = date ?? liability.dueDate ?? liability.accruedDate;
  return finish(
    {
      date: when,
      description: `Payroll tax remittance: ${liability.kind}`,
      source: "PAYROLL",
      lines: [
        { accountId: liability.glAccountId, debit: money(liability.amount), memo: liability.kind, entityRef: { type: "TAX_AUTHORITY", id: liability.kind } },
        { accountCode: bankCode, credit: money(liability.amount) },
      ],
      sourceIds: [liability.id, liability.payrollRunId, ...(liability.paidTransactionId ? [liability.paidTransactionId] : [])],
      tags: ["payroll-liability-payment"],
    },
    opts,
  );
}

/** Transfer between two balance-sheet accounts (e.g. checking → savings, or checking → card payment). */
export function entryForTransfer(fromCode: string, toCode: string, amount: Numeric, date: ISODate, opts: EntryOptions = {}): NewJournalEntryInput {
  return simpleEntry(date, `Transfer ${fromCode} → ${toCode}`, "BANK_IMPORT", toCode, fromCode, amount, { tags: ["transfer"], ...opts });
}

/** Monthly amortization of a prepaid: Dr expense / Cr prepaid. */
export function entryForPrepaidAmortization(prepaidAmount: Numeric, expenseCode: string, date: ISODate, opts: EntryOptions = {}): NewJournalEntryInput {
  return simpleEntry(date, `Prepaid amortization to ${expenseCode}`, "ADJUSTING", expenseCode, ACCT.PREPAID, prepaidAmount, { tags: ["prepaid-amortization"], ...opts });
}

/** Expense accrual: Dr expense / Cr accrued expenses. */
export function entryForAccrual(expenseCode: string, amount: Numeric, date: ISODate, opts: EntryOptions = {}): NewJournalEntryInput {
  return simpleEntry(date, `Accrued expense ${expenseCode}`, "ADJUSTING", expenseCode, ACCT.ACCRUED_EXPENSES, amount, { tags: ["accrual"], ...opts });
}

/** Shareholder distribution: Dr distributions / Cr bank. Restricted account — the risk engine gates it. */
export function entryForDistribution(amount: Numeric, date: ISODate, bankCode: string = ACCT.CHECKING, opts: EntryOptions = {}): NewJournalEntryInput {
  return simpleEntry(date, "Shareholder distribution", "MANUAL", ACCT.DISTRIBUTIONS, bankCode, amount, { tags: ["distribution"], ...opts });
}

/** Capitalized equipment purchase: Dr fixed asset / Cr bank (or card). */
export function entryForEquipmentPurchase(amount: Numeric, date: ISODate, assetCode: string = ACCT.COMPUTER_EQUIPMENT, paidFromCode: string = ACCT.CHECKING, opts: EntryOptions = {}): NewJournalEntryInput {
  return simpleEntry(date, "Equipment purchase (capitalized)", "BANK_IMPORT", assetCode, paidFromCode, amount, { tags: ["capex"], ...opts });
}

/**
 * Refund transaction: positive amount = vendor refund received (Dr bank / Cr offset account);
 * negative amount = refund paid to a customer (Dr offset account / Cr bank).
 */
export function entryForRefund(tx: Transaction, offsetAccountCode: string, bankGlCode: string, opts: EntryOptions = {}): NewJournalEntryInput {
  return entryForBankTransaction(tx, offsetAccountCode, bankGlCode, { tags: ["refund"], description: `Refund: ${txDescription(tx)}`, ...opts });
}

/** Bank fee: Dr bank fees / Cr bank. */
export function entryForBankFee(tx: Transaction, bankGlCode: string, opts: EntryOptions = {}): NewJournalEntryInput {
  return entryForBankTransaction(tx, ACCT.BANK_FEES, bankGlCode, { tags: ["bank-fee"], description: `Bank fee: ${txDescription(tx)}`, ...opts });
}

/** Opening balance entry: arbitrary balanced lines with source OPENING_BALANCE. */
export function entryForOpeningBalances(date: ISODate, lines: NewJournalLineInput[], opts: EntryOptions = {}): NewJournalEntryInput {
  return finish({ date, description: "Opening balances", source: "OPENING_BALANCE", lines, tags: ["opening-balance"] }, opts);
}
