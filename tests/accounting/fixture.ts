import { emptyDataset } from "@/lib/core/types";
import type { Actor, Bill, CompanyDataset, Invoice, Payment, PayrollLine, PayrollRun, Transaction, Worker } from "@/lib/core/types";
import { money } from "@/lib/core/money";
import { buildChartOfAccounts, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { Ledger } from "@/lib/accounting/ledger";

export const actor: Actor = { type: "USER", id: "user_test", role: "FINANCE_OPERATOR", displayName: "Test Operator" };
export const owner: Actor = { type: "USER", id: "user_owner", role: "OWNER" };

export function makeDataset(): CompanyDataset {
  const ds = emptyDataset({
    id: "co_test",
    displayName: "Synthetic Test Co",
    isSynthetic: true,
    entityType: { key: "entityType", section: "entity", label: "Entity type", value: "S_CORP", status: "CONFIRMED", synthetic: true },
    taxElection: { key: "taxElection", section: "entity", label: "Tax election", value: "S", status: "CONFIRMED", synthetic: true },
    state: { key: "state", section: "entity", label: "State", value: "CA", status: "CONFIRMED", synthetic: true },
    fiscalYearEnd: { key: "fye", section: "entity", label: "Fiscal year end", value: "12-31", status: "CONFIRMED", synthetic: true },
    accountingMethod: { key: "method", section: "accounting", label: "Method", value: "ACCRUAL", status: "CONFIRMED", synthetic: true },
    functionalCurrency: "USD",
    asOfDate: "2026-06-30",
  });
  ds.accounts = buildChartOfAccounts();
  ds.bankAccounts.push({ id: "bank_checking", name: "Operating Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "1234", currency: "USD", glAccountId: accountIdForCode("1000"), isSynthetic: true });
  ds.cards.push({ id: "card_main", name: "Business Card", issuer: "Synthetic Card Co", last4: "9876", currency: "USD", glAccountId: accountIdForCode("2050"), isSynthetic: true });
  return ds;
}

export function makeLedger(): { ds: CompanyDataset; ledger: Ledger; persisted: string[] } {
  const ds = makeDataset();
  const persisted: string[] = [];
  const ledger = new Ledger(ds, (collection, entity) => persisted.push(`${collection}:${(entity as { id: string }).id}`));
  return { ds, ledger, persisted };
}

export const acct = accountIdForCode;

export function tx(partial: Partial<Transaction> & { id: string; amount: string; date: string }): Transaction {
  return {
    sourceKind: "BANK",
    sourceAccountId: "bank_checking",
    externalId: `ext_${partial.id}`,
    postedDate: partial.date,
    currency: "USD",
    descriptionRaw: `TX ${partial.id}`,
    category: { accountId: null, status: "UNCATEGORIZED", confidence: 0 },
    documentIds: [],
    flags: [],
    importBatchId: "batch_1",
    ...partial,
  };
}

export function invoice(partial: Partial<Invoice> & { id: string; total: string; issueDate: string }): Invoice {
  return {
    number: `INV-${partial.id}`,
    customerId: "cust_1",
    dueDate: partial.issueDate,
    currency: "USD",
    amountPaid: money(0),
    status: "SENT",
    lines: [{ id: `${partial.id}_l1`, description: "Services", quantity: "1", unitPrice: partial.total, amount: partial.total, revenueAccountId: acct("4000") }],
    paymentIds: [],
    ...partial,
  };
}

export function bill(partial: Partial<Bill> & { id: string; total: string; billDate: string }): Bill {
  return {
    vendorId: "vend_1",
    number: `BILL-${partial.id}`,
    receivedDate: partial.billDate,
    dueDate: partial.billDate,
    currency: "USD",
    amountPaid: money(0),
    status: "RECEIVED",
    expenseAccountId: acct("7100"),
    description: "Vendor bill",
    paymentIds: [],
    ...partial,
  };
}

export function payment(partial: Partial<Payment> & { id: string; amount: string; date: string; direction: "IN" | "OUT" }): Payment {
  return { currency: "USD", method: "ACH", applications: [], ...partial };
}

export function worker(id: string, isOwner: boolean): Worker {
  return {
    id,
    displayName: isOwner ? "Owner One" : `Employee ${id}`,
    roleTitle: isOwner ? "CEO" : "Engineer",
    country: "US",
    workerType: "EMPLOYEE",
    classificationStatus: "CONFIRMED",
    compensation: { type: "SALARY", amount: "120000", currency: "USD", period: "ANNUAL", basis: "GROSS", status: "CONFIRMED" },
    startDate: "2025-01-01",
    isOwner,
    relatedParty: isOwner,
    documentIds: [],
    isSynthetic: true,
  };
}

export function payrollLine(workerId: string, gross: string): PayrollLine {
  // Simple synthetic rates, chosen so numbers are exact at 2dp.
  const g = Number(gross);
  const fmt = (n: number) => money(n.toFixed(2));
  const fit = g * 0.1;
  const sit = g * 0.04;
  const ss = g * 0.062;
  const med = g * 0.0145;
  const sdi = g * 0.01;
  const net = g - fit - sit - ss - med - sdi;
  return {
    workerId,
    gross: fmt(g),
    federalIncomeTaxWithheld: fmt(fit),
    stateIncomeTaxWithheld: fmt(sit),
    socialSecurityEmployee: fmt(ss),
    medicareEmployee: fmt(med),
    stateDisabilityEmployee: fmt(sdi),
    otherDeductions: money(0),
    netPay: fmt(net),
    socialSecurityEmployer: fmt(ss),
    medicareEmployer: fmt(med),
    federalUnemploymentEmployer: fmt(g * 0.006),
    stateUnemploymentEmployer: fmt(g * 0.034),
    stateTrainingTaxEmployer: fmt(g * 0.001),
    otherEmployerCosts: money(0),
    totalEmployerCost: fmt(g + ss + med + g * 0.006 + g * 0.034 + g * 0.001),
  };
}

export function payrollRun(id: string, payDate: string, lines: PayrollLine[]): PayrollRun {
  const sum = (f: (l: PayrollLine) => string) => money(lines.reduce((a, l) => a + Number(f(l)), 0).toFixed(2));
  return {
    id,
    periodStart: payDate.slice(0, 8) + "01",
    periodEnd: payDate,
    payDate,
    currency: "USD",
    status: "PAID",
    lines,
    totals: {
      gross: sum((l) => l.gross),
      employeeTaxes: sum((l) => String(Number(l.federalIncomeTaxWithheld) + Number(l.stateIncomeTaxWithheld) + Number(l.socialSecurityEmployee) + Number(l.medicareEmployee) + Number(l.stateDisabilityEmployee))),
      otherDeductions: sum((l) => l.otherDeductions),
      netPay: sum((l) => l.netPay),
      employerTaxes: sum((l) => String(Number(l.socialSecurityEmployer) + Number(l.medicareEmployer) + Number(l.federalUnemploymentEmployer) + Number(l.stateUnemploymentEmployer) + Number(l.stateTrainingTaxEmployer))),
      totalEmployerCost: sum((l) => l.totalEmployerCost),
    },
    netPayTransactionIds: [],
  };
}
