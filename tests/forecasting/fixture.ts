/**
 * Small deterministic synthetic dataset for forecasting tests (no ledger engine required).
 * As-of date: 2026-09-09 (a Wednesday). Everything is labelled synthetic.
 */
import type { Bill, CompanyDataset, ConfigField, Invoice, JournalEntry, PayrollRun, TaxObligation, Transaction, Worker } from "@/lib/core/types";
import { emptyDataset } from "@/lib/core/types";
import { ACCT, accountIdForCode, buildChartOfAccounts } from "@/lib/accounting/chart-of-accounts";
import { D } from "@/lib/core/money";

export const AS_OF = "2026-09-09";
export const A = (code: string) => accountIdForCode(code);

const cf = <T,>(key: string, value: T | null, status: ConfigField["status"] = "CONFIRMED"): ConfigField<T> => ({ key, section: "entity", label: key, value, status, synthetic: true });

let entryNo = 0;
function je(date: string, lines: [string, string, string][], status: JournalEntry["status"] = "POSTED"): JournalEntry {
  entryNo++;
  return {
    id: `je_${entryNo}`,
    entryNumber: entryNo,
    date,
    periodId: date.slice(0, 7),
    description: `entry ${entryNo}`,
    status,
    source: "MANUAL",
    lines: lines.map(([code, debit, credit], i) => ({ id: `je_${entryNo}_${i}`, accountId: A(code), debit: D(debit).toFixed(4), credit: D(credit).toFixed(4), currency: "USD" })),
    sourceIds: [],
    createdBy: "test",
    createdAt: `${date}T00:00:00.000Z`,
  };
}

function invoice(id: string, issueDate: string, dueDate: string, total: string, status: Invoice["status"], paid = "0"): Invoice {
  return { id, number: id.toUpperCase(), customerId: "cust_1", issueDate, dueDate, currency: "USD", total: D(total).toFixed(4), amountPaid: D(paid).toFixed(4), status, lines: [], paymentIds: [] };
}

function bill(id: string, dueDate: string, total: string, status: Bill["status"], paid = "0"): Bill {
  return { id, vendorId: "ven_law", number: id, receivedDate: "2026-09-01", billDate: "2026-09-01", dueDate, currency: "USD", total: D(total).toFixed(4), amountPaid: D(paid).toFixed(4), status, expenseAccountId: A(ACCT.PROFESSIONAL_FEES), description: "legal", paymentIds: [] };
}

function payrollRun(payDate: string): PayrollRun {
  const gross = "4500.0000";
  return {
    id: `run_${payDate}`,
    periodStart: payDate,
    periodEnd: payDate,
    payDate,
    currency: "USD",
    status: "PAID",
    lines: [],
    totals: { gross, employeeTaxes: "1000.0000", otherDeductions: "0.0000", netPay: "3500.0000", employerTaxes: "350.0000", totalEmployerCost: "4850.0000" },
    netPayTransactionIds: [],
  };
}

function tx(id: string, date: string, amount: string, merchant: string, accountCode: string | null, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    sourceKind: "BANK",
    sourceAccountId: "bank_1",
    externalId: id,
    date,
    postedDate: date,
    amount: D(amount).toFixed(4),
    currency: "USD",
    descriptionRaw: merchant.toUpperCase(),
    merchantNormalized: merchant,
    category: { accountId: accountCode ? A(accountCode) : null, status: accountCode ? "APPROVED" : "UNCATEGORIZED", confidence: 1 },
    documentIds: [],
    flags: [],
    importBatchId: "batch_1",
    ...extra,
  };
}

export function buildFixtureDataset(): CompanyDataset {
  entryNo = 0;
  const ds = emptyDataset({
    id: "co_synth",
    displayName: "Synthetic Co",
    isSynthetic: true,
    entityType: cf("entityType", "S_CORP"),
    taxElection: cf("taxElection", "S"),
    state: cf("state", "CA"),
    fiscalYearEnd: cf("fiscalYearEnd", "12-31"),
    accountingMethod: cf("accountingMethod", "ACCRUAL"),
    functionalCurrency: "USD",
    asOfDate: AS_OF,
  });
  ds.accounts = buildChartOfAccounts();
  ds.customers = [{ id: "cust_1", name: "Acme", paymentTermsDays: 30, country: "US", relatedParty: false, active: true }];
  ds.vendors = [
    { id: "ven_law", name: "Law LLP", normalizedNames: ["law llp"], isRecurring: false, country: "US", taxDocStatus: "ON_FILE", active: true, createdAt: "2026-01-01T00:00:00Z" },
    { id: "ven_github", name: "GitHub", normalizedNames: ["github"], isRecurring: true, country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2026-01-01T00:00:00Z" },
  ];

  // Ledger: Jun–Aug each month revenue 10000, software 500, salaries 9000; a DRAFT entry and an old entry.
  for (const m of ["2026-06", "2026-07", "2026-08"]) {
    ds.journalEntries.push(je(`${m}-15`, [[ACCT.AR, "10000", "0"], [ACCT.SERVICE_REVENUE, "0", "10000"]]));
    ds.journalEntries.push(je(`${m}-05`, [[ACCT.SOFTWARE, "500", "0"], [ACCT.CHECKING, "0", "500"]]));
    ds.journalEntries.push(je(`${m}-28`, [[ACCT.SALARIES, "9000", "0"], [ACCT.CHECKING, "0", "9000"]]));
  }
  ds.journalEntries.push(je("2026-08-20", [[ACCT.SOFTWARE, "999", "0"], [ACCT.CHECKING, "0", "999"]], "DRAFT"));
  ds.journalEntries.push(je("2026-09-03", [[ACCT.AR, "4000", "0"], [ACCT.SERVICE_REVENUE, "0", "4000"]]));
  ds.journalEntries.push(je("2024-01-15", [[ACCT.AR, "7777", "0"], [ACCT.SERVICE_REVENUE, "0", "7777"]]));

  ds.invoices = [
    invoice("inv_jun", "2026-06-01", "2026-07-01", "10000", "PAID", "10000"),
    invoice("inv_jul", "2026-07-01", "2026-07-31", "10000", "PAID", "10000"),
    invoice("inv_aug", "2026-08-01", "2026-08-31", "10000", "OVERDUE"),
    invoice("inv_extra", "2026-08-20", "2026-09-19", "5000", "SENT"),
    invoice("inv_void", "2026-08-25", "2026-09-25", "99999", "VOID"),
  ];
  ds.bills = [bill("bill_open", "2026-09-25", "1200", "APPROVED"), bill("bill_paid", "2026-08-25", "800", "PAID", "800"), bill("bill_far", "2027-03-01", "5000", "RECEIVED")];
  ds.payrollRuns = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-15", "2026-08-31"].map(payrollRun);
  ds.payrollLiabilities = [
    { id: "pl_1", payrollRunId: "run_2026-08-31", kind: "FEDERAL_WITHHOLDING_AND_FICA", amount: "900.0000", currency: "USD", accruedDate: "2026-08-31", dueDate: "2026-09-15", status: "ACCRUED", glAccountId: A(ACCT.FED_PAYROLL_TAX_PAYABLE) },
    { id: "pl_2", payrollRunId: "run_2026-08-31", kind: "STATE_UNEMPLOYMENT_AND_ETT", amount: "50.0000", currency: "USD", accruedDate: "2026-08-31", dueDate: null, status: "ACCRUED", glAccountId: A(ACCT.SUI_PAYABLE) },
  ];

  // Recurring vendors: github (5th, 4 months) & wework rent (1st, 4 months); one-off apple; a payroll tx (excluded); a transfer (excluded)
  let n = 0;
  for (const m of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
    ds.transactions.push(tx(`tx_gh_${++n}`, `${m}-05`, "-100", "github", ACCT.SOFTWARE, { counterpartyRef: { type: "VENDOR", id: "ven_github" } }));
    ds.transactions.push(tx(`tx_ww_${++n}`, `${m}-01`, m === "2026-07" ? "-2100" : "-2000", "wework", ACCT.RENT));
  }
  ds.transactions.push(tx(`tx_apple_${++n}`, "2026-08-10", "-3000", "apple store", ACCT.COMPUTER_EQUIPMENT));
  ds.transactions.push(tx(`tx_pay_${++n}`, "2026-08-31", "-3500", "gusto payroll", ACCT.SALARIES));
  for (const m of ["2026-06", "2026-07", "2026-08"]) ds.transactions.push(tx(`tx_xfer_${++n}`, `${m}-20`, "-5000", "transfer to savings", null, { flags: ["TRANSFER"] }));

  const tax = (id: string, dueDate: string | null, amount: string | null, status: TaxObligation["status"] = "UPCOMING"): TaxObligation => ({
    id, jurisdiction: "FEDERAL", kind: "ESTIMATED_TAX", title: `Tax ${id}`, description: "", taxYear: 2026, dueDate, amount, currency: "USD", status, requiresCpaReview: true, documentIds: [],
  });
  ds.taxObligations = [tax("t_q3", "2026-10-15", "800"), tax("t_unknown_amount", "2026-11-15", null), tax("t_unknown_due", null, "100"), tax("t_paid", "2026-06-15", "700", "PAID")];

  const worker = (id: string, extra: Partial<Worker>): Worker => ({
    id, displayName: id, roleTitle: "eng", country: "US", workerType: "EMPLOYEE", classificationStatus: "CONFIRMED",
    compensation: { type: "SALARY", amount: "5000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" },
    startDate: "2026-01-01", isOwner: false, relatedParty: false, documentIds: [], isSynthetic: true, ...extra,
  });
  ds.workers = [
    worker("w_emp", {}),
    worker("w_owner", { isOwner: true, compensation: { type: "SALARY", amount: "96000", currency: "USD", period: "ANNUAL", basis: "GROSS", status: "UNCONFIRMED" } }),
    worker("w_contractor", { workerType: "CONTRACTOR", compensation: { type: "CONTRACT", amount: "2000", currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "CONFIRMED" } }),
    worker("w_unknown", { workerType: "UNRESOLVED", classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW", compensation: { type: "SALARY", amount: "", currency: "USD", period: "MONTHLY", basis: "UNKNOWN", status: "UNCONFIRMED" } }),
    worker("w_left", { endDate: "2026-03-31" }),
  ];
  return ds;
}
