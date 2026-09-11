/**
 * Named eval fixtures. Every builder is deterministic and also exposes the records it creates so
 * generators can compute answer keys from the same data (lib/finance on the same invoices, etc.).
 *
 *   empty               chart of accounts + bank/card only (knowledge is seeded by the runtime)
 *   synthetic-default   the shared synthetic company (built by the runner, not here)
 *   ap-ar-open-items    customers/vendors with open invoices and bills of known ages
 *   locked-period       a posted entry inside a LOCKED period
 *   audit-known         an audit event with a known id and explanation
 *   payroll-run         one PAID payroll run with matching net-pay bank debits
 *   workers             US employees, an ambiguous US contractor and two China-based workers
 */
import { emptyDataset, type Actor, type AuditEvent, type Bill, type CompanyDataset, type CompanyProfile, type Customer, type Invoice, type ISODate, type PayrollLiability, type PayrollLine, type PayrollRun, type Transaction, type Vendor, type Worker } from "@/lib/core/types";
import { buildChartOfAccounts, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { Ledger } from "@/lib/accounting/ledger";
import { entryForPayrollRun, simpleEntry } from "@/lib/accounting/posting-helpers";
import { addDays, addMonths } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { D, add, money } from "@/lib/core/money";
import { SeededRandom } from "@/lib/core/random";
import { computeEventHash, GENESIS_HASH } from "@/lib/audit/audit-log";
import { EVAL_AS_OF_DATE } from "./synthetic";

export const FIXTURE_AS_OF: ISODate = EVAL_AS_OF_DATE;
export const FIXTURE_ACTOR: Actor = { type: "USER", id: "eval_fixture_operator", role: "FINANCE_OPERATOR", displayName: "Eval fixture operator" };
const fid = (prefix: string, ...parts: (string | number)[]) => deterministicId(prefix, "eval-fixture", ...parts);

export function fixtureProfile(id = "co_eval_fixture"): CompanyProfile {
  const cf = <T,>(key: string, label: string, value: T) => ({ key, section: "entity", label, value, status: "CONFIRMED" as const, synthetic: true });
  return {
    id,
    displayName: "Eval Fixture Co (SYNTHETIC)",
    isSynthetic: true,
    entityType: cf("entityType", "Entity type", "LLC (California)"),
    taxElection: cf("taxElection", "Federal tax election", "S_CORPORATION"),
    state: cf("state", "State", "CA"),
    fiscalYearEnd: cf("fiscalYearEnd", "Fiscal year end", "12-31"),
    accountingMethod: cf<"CASH" | "ACCRUAL">("accountingMethod", "Accounting method", "ACCRUAL"),
    functionalCurrency: "USD",
    asOfDate: FIXTURE_AS_OF,
  };
}

export const FIXTURE_BANK_ID = "bank_eval_checking";
export const FIXTURE_CARD_ID = "card_eval_business";

/** Stamp deterministic creation/posting times derived from the entry date (the ledger uses wall-clock time). */
export function normalizeEntryTimestamps(ds: CompanyDataset): CompanyDataset {
  for (const e of ds.journalEntries) {
    e.createdAt = `${e.date}T09:00:00.000Z`;
    if (e.postedAt) e.postedAt = `${e.date}T09:05:00.000Z`;
  }
  return ds;
}

/** Chart of accounts + one bank account + one card. */
export function emptyFixture(): CompanyDataset {
  const ds = emptyDataset(fixtureProfile());
  ds.accounts = buildChartOfAccounts();
  ds.bankAccounts.push({ id: FIXTURE_BANK_ID, name: "Operating Checking", institution: "Eval Bank (SYNTHETIC)", accountType: "CHECKING", last4: "0001", currency: "USD", glAccountId: accountIdForCode("1000"), isSynthetic: true });
  ds.cards.push({ id: FIXTURE_CARD_ID, name: "Business Card", issuer: "Eval Card (SYNTHETIC)", last4: "0002", currency: "USD", glAccountId: accountIdForCode("2050"), isSynthetic: true });
  const ledger = new Ledger(ds);
  for (let i = -14; i <= 0; i++) ledger.ensurePeriod(addMonths(`${FIXTURE_AS_OF.slice(0, 7)}-01`, i));
  return ds;
}

// ---------------------------------------------------------------------------
// ap-ar-open-items
// ---------------------------------------------------------------------------

export interface ApArFixtureData {
  asOfDate: ISODate;
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  bills: Bill[];
}

export const APAR_CUSTOMER_IDS = { northwind: "cust_eval_northwind", harbor: "cust_eval_harbor" } as const;
export const APAR_VENDOR_IDS = { cloud: "vend_eval_cloudco", cpa: "vend_eval_cpafirm", coworking: "vend_eval_coworking" } as const;

/** Deterministic open items: ages chosen so every aging bucket is populated. */
export function apArFixtureData(): ApArFixtureData {
  const rng = new SeededRandom("eval-ap-ar-fixture");
  const asOf = FIXTURE_AS_OF;
  const customers: Customer[] = [
    { id: APAR_CUSTOMER_IDS.northwind, name: "Northwind Analytics (SYNTHETIC)", paymentTermsDays: 30, country: "US", relatedParty: false, active: true },
    { id: APAR_CUSTOMER_IDS.harbor, name: "Harbor Data Co (SYNTHETIC)", paymentTermsDays: 15, country: "US", relatedParty: true, relatedPartyNote: "related-party customer (synthetic)", active: true },
  ];
  const vendors: Vendor[] = [
    { id: APAR_VENDOR_IDS.cloud, name: "CloudCo Hosting (SYNTHETIC)", normalizedNames: ["CLOUDCO", "CLOUDCO HOSTING"], defaultAccountId: accountIdForCode("5000"), paymentTermsDays: 30, isRecurring: true, category: "cost_of_revenue", country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2025-06-01T09:00:00.000Z", approvedBy: FIXTURE_ACTOR.id },
    { id: APAR_VENDOR_IDS.cpa, name: "Kestrel Tax & Advisory LLP (SYNTHETIC)", normalizedNames: ["KESTREL TAX", "KESTREL TAX & ADVISORY"], defaultAccountId: accountIdForCode("7200"), paymentTermsDays: 30, isRecurring: true, category: "professional_fees", country: "US", taxDocStatus: "ON_FILE", active: true, createdAt: "2025-06-01T09:00:00.000Z", approvedBy: FIXTURE_ACTOR.id },
    { id: APAR_VENDOR_IDS.coworking, name: "Brightwork Coworking (SYNTHETIC)", normalizedNames: ["BRIGHTWORK", "BRIGHTWORK COWORKING"], defaultAccountId: accountIdForCode("7100"), paymentTermsDays: 7, isRecurring: true, category: "rent", country: "US", taxDocStatus: "ON_FILE", active: true, createdAt: "2025-06-01T09:00:00.000Z", approvedBy: FIXTURE_ACTOR.id },
  ];
  // days past due as of asOf: negative = not yet due
  const invoiceSpecs: { key: string; customer: keyof typeof APAR_CUSTOMER_IDS; daysPastDue: number; total: string; paid: string }[] = [
    { key: "inv-current", customer: "northwind", daysPastDue: -10, total: (rng.int(40, 90) * 100).toFixed(2), paid: "0.00" },
    { key: "inv-1-30", customer: "northwind", daysPastDue: 12, total: (rng.int(30, 70) * 100).toFixed(2), paid: "0.00" },
    { key: "inv-31-60", customer: "harbor", daysPastDue: 45, total: (rng.int(20, 60) * 100).toFixed(2), paid: "0.00" },
    { key: "inv-61-90", customer: "harbor", daysPastDue: 75, total: (rng.int(20, 50) * 100).toFixed(2), paid: "0.00" },
    { key: "inv-90plus", customer: "northwind", daysPastDue: 120, total: (rng.int(10, 40) * 100).toFixed(2), paid: "0.00" },
    { key: "inv-partial", customer: "harbor", daysPastDue: 20, total: "8000.00", paid: "5000.00" },
  ];
  const invoices: Invoice[] = invoiceSpecs.map((s) => {
    const dueDate = addDays(asOf, -s.daysPastDue);
    const terms = customers.find((c) => c.id === APAR_CUSTOMER_IDS[s.customer])!.paymentTermsDays;
    const issueDate = addDays(dueDate, -terms);
    const id = `inv_eval_${s.key.replace(/-/g, "_")}`;
    return {
      id,
      number: `INV-EVAL-${s.key.toUpperCase()}`,
      customerId: APAR_CUSTOMER_IDS[s.customer],
      issueDate,
      dueDate,
      currency: "USD",
      total: money(s.total),
      amountPaid: money(s.paid),
      status: D(s.paid).gt(0) ? "PARTIALLY_PAID" : s.daysPastDue > 0 ? "OVERDUE" : "SENT",
      lines: [{ id: `${id}_l1`, description: "Consulting services", quantity: "1.0000", unitPrice: money(s.total), amount: money(s.total), revenueAccountId: accountIdForCode("4100") }],
      paymentIds: [],
    };
  });
  const billSpecs: { key: string; vendor: keyof typeof APAR_VENDOR_IDS; daysPastDue: number; total: string; number: string; description: string }[] = [
    { key: "bill-current", vendor: "cloud", daysPastDue: -14, total: (rng.int(8, 20) * 100).toFixed(2), number: "CC-1001", description: "Cloud hosting — current month" },
    { key: "bill-1-30", vendor: "coworking", daysPastDue: 5, total: "1200.00", number: "BW-2201", description: "Coworking membership" },
    { key: "bill-31-60", vendor: "cpa", daysPastDue: 40, total: "2500.00", number: "KT-3301", description: "Quarterly advisory fee" },
    { key: "bill-61-90", vendor: "cloud", daysPastDue: 70, total: (rng.int(5, 15) * 100).toFixed(2), number: "CC-0912", description: "Cloud hosting — prior month" },
    { key: "bill-90plus", vendor: "cpa", daysPastDue: 100, total: "750.00", number: "KT-3290", description: "Notice review" },
  ];
  const bills: Bill[] = billSpecs.map((s) => {
    const dueDate = addDays(asOf, -s.daysPastDue);
    const vendor = vendors.find((v) => v.id === APAR_VENDOR_IDS[s.vendor])!;
    const billDate = addDays(dueDate, -(vendor.paymentTermsDays ?? 30));
    return {
      id: `bill_eval_${s.key.replace(/-/g, "_")}`,
      vendorId: vendor.id,
      number: s.number,
      receivedDate: billDate,
      billDate,
      dueDate,
      currency: "USD",
      total: money(s.total),
      amountPaid: money(0),
      status: "RECEIVED",
      expenseAccountId: vendor.defaultAccountId ?? accountIdForCode("7950"),
      description: s.description,
      paymentIds: [],
    };
  });
  return { asOfDate: asOf, customers, vendors, invoices, bills };
}

export const APAR_INVOICE_IDS = {
  current: "inv_eval_inv_current",
  d1to30: "inv_eval_inv_1_30",
  d31to60: "inv_eval_inv_31_60",
  d61to90: "inv_eval_inv_61_90",
  d90plus: "inv_eval_inv_90plus",
  partial: "inv_eval_inv_partial",
} as const;

export function apArFixture(): CompanyDataset {
  const ds = emptyFixture();
  const data = apArFixtureData();
  ds.customers.push(...data.customers);
  ds.vendors.push(...data.vendors);
  ds.invoices.push(...data.invoices);
  ds.bills.push(...data.bills);
  // Post the invoices and bills so GL 1100 / 2000 agree with the subledgers.
  const ledger = new Ledger(ds);
  for (const inv of data.invoices) {
    const e = ledger.createEntry({ id: fid("je", "inv", inv.id), date: inv.issueDate, description: `Invoice ${inv.number} issued`, source: "AR", lines: [{ accountCode: "1100", debit: inv.total }, { accountCode: "4100", credit: inv.total }], sourceIds: [inv.id], post: true }, FIXTURE_ACTOR);
    inv.journalEntryId = e.id;
    if (D(inv.amountPaid).gt(0)) {
      ledger.createEntry({ id: fid("je", "inv-pay", inv.id), date: addDays(inv.issueDate, 3), description: `Partial payment ${inv.number}`, source: "AR", lines: [{ accountCode: "1000", debit: inv.amountPaid }, { accountCode: "1100", credit: inv.amountPaid }], sourceIds: [inv.id], post: true }, FIXTURE_ACTOR);
    }
  }
  for (const b of data.bills) {
    const e = ledger.createEntry({ id: fid("je", "bill", b.id), date: b.billDate, description: `Bill ${b.number}`, source: "AP", lines: [{ accountId: b.expenseAccountId, debit: b.total }, { accountCode: "2000", credit: b.total }], sourceIds: [b.id], post: true }, FIXTURE_ACTOR);
    b.journalEntryId = e.id;
  }
  ledger.createEntry({ id: fid("je", "opening-cash"), date: addDays(FIXTURE_AS_OF, -400), description: "Opening cash", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "60000.00" }, { accountCode: "3000", credit: "60000.00" }], post: true }, FIXTURE_ACTOR);
  return normalizeEntryTimestamps(ds);
}

// ---------------------------------------------------------------------------
// locked-period
// ---------------------------------------------------------------------------

export const LOCKED_PERIOD_ID = "2026-05";
export const LOCKED_ENTRY_ID = "je_eval_locked_original";
export const LOCKED_ENTRY_AMOUNT = "1250.00";
export const OPEN_ENTRY_ID = "je_eval_open_original";

export function lockedPeriodFixture(): CompanyDataset {
  const ds = emptyFixture();
  const ledger = new Ledger(ds);
  ledger.createEntry({ id: fid("je", "opening-cash-locked"), date: "2026-01-05", description: "Opening cash", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "40000.00" }, { accountCode: "3000", credit: "40000.00" }], post: true }, FIXTURE_ACTOR);
  // The miscoded entry: a software subscription posted to office supplies inside May.
  ledger.createEntry({ ...simpleEntry("2026-05-12", "FIGMA — monthly plan (miscoded to 7400)", "CARD_IMPORT", "7400", "2050", LOCKED_ENTRY_AMOUNT), id: LOCKED_ENTRY_ID, post: true }, FIXTURE_ACTOR);
  ledger.createEntry({ ...simpleEntry("2026-08-12", "FIGMA — monthly plan (miscoded to 7400)", "CARD_IMPORT", "7400", "2050", LOCKED_ENTRY_AMOUNT), id: OPEN_ENTRY_ID, post: true }, FIXTURE_ACTOR);
  const period = ds.periods.find((p) => p.id === LOCKED_PERIOD_ID);
  if (!period) throw new Error("locked-period fixture: period missing");
  period.status = "LOCKED";
  period.lockedAt = "2026-06-12T10:00:00.000Z";
  period.lockedBy = FIXTURE_ACTOR.id;
  period.lockApprovalId = "apr_eval_lock_2026_05";
  for (const p of ds.periods) if (p.id < LOCKED_PERIOD_ID) p.status = "LOCKED";
  return normalizeEntryTimestamps(ds);
}

// ---------------------------------------------------------------------------
// audit-known
// ---------------------------------------------------------------------------

export const KNOWN_AUDIT_EVENT_ID = "aud_eval_known_0001";
export const KNOWN_AUDIT_ACTION_ID = "act_eval_known_0001";
export const KNOWN_AUDIT_EXPLANATION = "Categorized the Brightwork Coworking charge to 7100 Rent & Coworking because the vendor has an approved recurring pattern (rule R-COWORK-01).";
export const KNOWN_AUDIT_PHRASE = "approved recurring pattern";

export function auditKnownFixture(): CompanyDataset {
  const ds = emptyFixture();
  const base: Omit<AuditEvent, "hash"> = {
    id: KNOWN_AUDIT_EVENT_ID,
    seq: 1,
    timestamp: "2026-08-20T15:30:00.000Z",
    actor: { type: "AGENT", id: "bookkeeping", role: "AGENT", displayName: "Bookkeeping agent" },
    agent: "bookkeeping",
    model: { provider: "local", model: "local-deterministic", version: "1", deterministic: true },
    workflowVersion: "eval-fixture:v1",
    promptVersion: "n/a",
    eventType: "ACTION_EXECUTED",
    toolsCalled: [{ name: "classify_transaction", inputHash: "in0001", outputHash: "out0001", riskLevel: "GREEN", durationMs: 3, ok: true }],
    sourceDocumentIds: ["doc_eval_known_receipt"],
    calculationIds: [],
    proposedActionId: KNOWN_AUDIT_ACTION_ID,
    finalAction: "CATEGORIZE_TRANSACTION",
    approvalIds: [],
    confidence: 0.97,
    explanation: KNOWN_AUDIT_EXPLANATION,
    previousHash: GENESIS_HASH,
  };
  ds.auditEvents.push({ ...base, hash: computeEventHash(base) });
  return ds;
}

// ---------------------------------------------------------------------------
// payroll-run
// ---------------------------------------------------------------------------

export const PAYROLL_RUN_ID = "pr_eval_2026_08";
export const PAYROLL_PAY_DATE: ISODate = "2026-08-29";
export const PAYROLL_WORKER_IDS = { owner: "wrk_eval_owner", engineer: "wrk_eval_engineer" } as const;

/** Synthetic withholding using round rates chosen so every figure is exact at 2 dp. Labelled synthetic. */
export function evalPayrollLine(workerId: string, gross: string): PayrollLine {
  const g = D(gross);
  const f = (x: number) => money(g.times(x).toDecimalPlaces(2));
  const employeeTaxes = D(f(0.1)).plus(D(f(0.04))).plus(D(f(0.062))).plus(D(f(0.0145))).plus(D(f(0.01)));
  const employerTaxes = D(f(0.062)).plus(D(f(0.0145))).plus(D(f(0.006))).plus(D(f(0.034))).plus(D(f(0.001)));
  return {
    workerId,
    gross: money(g),
    federalIncomeTaxWithheld: f(0.1),
    stateIncomeTaxWithheld: f(0.04),
    socialSecurityEmployee: f(0.062),
    medicareEmployee: f(0.0145),
    stateDisabilityEmployee: f(0.01),
    otherDeductions: money(0),
    netPay: money(g.minus(employeeTaxes)),
    socialSecurityEmployer: f(0.062),
    medicareEmployer: f(0.0145),
    federalUnemploymentEmployer: f(0.006),
    stateUnemploymentEmployer: f(0.034),
    stateTrainingTaxEmployer: f(0.001),
    otherEmployerCosts: money(0),
    totalEmployerCost: money(g.plus(employerTaxes)),
  };
}

export function payrollFixtureWorkers(): Worker[] {
  const base = { country: "US", workerType: "EMPLOYEE" as const, classificationStatus: "CONFIRMED" as const, startDate: "2025-06-01", payMethod: "PAYROLL_PROVIDER" as const, documentIds: [] as string[], isSynthetic: true };
  return [
    { ...base, id: PAYROLL_WORKER_IDS.owner, displayName: "Avery Lin (SYNTHETIC)", roleTitle: "CEO / Founder", compensation: { type: "SALARY", amount: money(3000), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED", note: "reasonable compensation is a professional judgment" }, isOwner: true, relatedParty: true, relatedPartyNote: "Sole shareholder and officer." },
    { ...base, id: PAYROLL_WORKER_IDS.engineer, displayName: "Sam Okafor (SYNTHETIC)", roleTitle: "Software Engineer", compensation: { type: "SALARY", amount: money(5500), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" }, isOwner: false, relatedParty: false },
  ];
}

export function payrollFixtureRun(): { run: PayrollRun; netPayTransactions: Transaction[] } {
  const lines = [evalPayrollLine(PAYROLL_WORKER_IDS.owner, "3000.00"), evalPayrollLine(PAYROLL_WORKER_IDS.engineer, "5500.00")];
  const sum = (pick: (l: PayrollLine) => string) => lines.reduce((acc, l) => add(acc, pick(l)), "0.0000");
  const employeeTaxes = sum((l) => add(l.federalIncomeTaxWithheld, l.stateIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.stateDisabilityEmployee));
  const employerTaxes = sum((l) => add(l.socialSecurityEmployer, l.medicareEmployer, l.federalUnemploymentEmployer, l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer));
  const netPayTransactions: Transaction[] = lines.map((l, i) => ({
    id: `tx_eval_netpay_${i + 1}`,
    sourceKind: "BANK",
    sourceAccountId: FIXTURE_BANK_ID,
    externalId: `BANK-0001-NETPAY-${i + 1}`,
    date: PAYROLL_PAY_DATE,
    postedDate: PAYROLL_PAY_DATE,
    amount: money(D(l.netPay).neg()),
    currency: "USD",
    descriptionRaw: `PAYSTREAM PAYROLL NET PAY ${i + 1}`,
    merchantNormalized: "Paystream Payroll Services",
    category: { accountId: accountIdForCode("6000"), status: "APPROVED", confidence: 0.98, suggestedBy: "RULE", approvedBy: FIXTURE_ACTOR.id },
    documentIds: [],
    flags: [],
    importBatchId: "import_eval_payroll",
    meta: { isSynthetic: true },
  }));
  const run: PayrollRun = {
    id: PAYROLL_RUN_ID,
    periodStart: "2026-08-16",
    periodEnd: "2026-08-31",
    payDate: PAYROLL_PAY_DATE,
    currency: "USD",
    providerRef: "PAYSTREAM-2026-08-B",
    status: "PAID",
    lines,
    totals: { gross: sum((l) => l.gross), employeeTaxes, otherDeductions: sum((l) => l.otherDeductions), netPay: sum((l) => l.netPay), employerTaxes, totalEmployerCost: sum((l) => l.totalEmployerCost) },
    netPayTransactionIds: netPayTransactions.map((t) => t.id),
    rateAssumptionSetId: "rates_eval_synthetic",
  };
  return { run, netPayTransactions };
}

/** Accrued liabilities matching the payroll entry's credit lines (due dates unknown: rules pending). */
export function payrollFixtureLiabilities(run: PayrollRun): PayrollLiability[] {
  const sum = (pick: (l: PayrollLine) => string) => run.lines.reduce((acc, l) => add(acc, pick(l)), "0.0000");
  const specs: { kind: PayrollLiability["kind"]; code: string; amount: string }[] = [
    { kind: "FEDERAL_WITHHOLDING_AND_FICA", code: "2200", amount: sum((l) => add(l.federalIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.socialSecurityEmployer, l.medicareEmployer)) },
    { kind: "STATE_WITHHOLDING_AND_SDI", code: "2210", amount: sum((l) => add(l.stateIncomeTaxWithheld, l.stateDisabilityEmployee)) },
    { kind: "FEDERAL_UNEMPLOYMENT", code: "2220", amount: sum((l) => l.federalUnemploymentEmployer) },
    { kind: "STATE_UNEMPLOYMENT_AND_ETT", code: "2230", amount: sum((l) => add(l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer)) },
  ];
  return specs.map((s) => ({ id: `pl_eval_${run.id}_${s.code}`, payrollRunId: run.id, kind: s.kind, amount: money(s.amount), currency: "USD", accruedDate: run.payDate, dueDate: null, status: "ACCRUED", glAccountId: accountIdForCode(s.code) }));
}

export function payrollRunFixture(): CompanyDataset {
  const ds = emptyFixture();
  ds.workers.push(...payrollFixtureWorkers());
  const { run, netPayTransactions } = payrollFixtureRun();
  ds.payrollRuns.push(run);
  ds.transactions.push(...netPayTransactions);
  const ledger = new Ledger(ds);
  ledger.createEntry({ id: fid("je", "opening-cash-payroll"), date: "2026-01-05", description: "Opening cash", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "50000.00" }, { accountCode: "3000", credit: "50000.00" }], post: true }, FIXTURE_ACTOR);
  const entry = ledger.createEntry(entryForPayrollRun(run, ds.workers, "1000", { id: fid("je", "payroll", run.id), post: true }), FIXTURE_ACTOR);
  run.journalEntryId = entry.id;
  for (const t of netPayTransactions) t.journalEntryId = entry.id;
  ds.payrollLiabilities.push(...payrollFixtureLiabilities(run));
  return normalizeEntryTimestamps(ds);
}

// ---------------------------------------------------------------------------
// workers
// ---------------------------------------------------------------------------

export const WORKER_IDS = { owner: PAYROLL_WORKER_IDS.owner, engineer: PAYROLL_WORKER_IDS.engineer, cn1: "wrk_eval_cn1", cn2: "wrk_eval_cn2", usContractor: "wrk_eval_us_contractor" } as const;

export function workersFixture(): CompanyDataset {
  const ds = emptyFixture();
  ds.workers.push(...payrollFixtureWorkers());
  const cnFields = (k: string) =>
    ["employment_status", "employing_entity", "work_location", "payment_method", "contract", "withholding_responsibilities", "tax_documentation"].map((f) => ({
      key: `worker.${k}.${f}`,
      section: "international_worker",
      label: f.replace(/_/g, " "),
      value: null,
      status: "PROFESSIONAL_REVIEW_REQUIRED" as const,
      requiredConfirmer: "ATTORNEY" as const,
      synthetic: true,
    }));
  for (const [key, name, title] of [
    [WORKER_IDS.cn1, "Wei Zhang (SYNTHETIC)", "ML Engineer (China-based)"],
    [WORKER_IDS.cn2, "Chen Yu (SYNTHETIC)", "Data Annotation Lead (China-based)"],
  ] as const) {
    ds.workers.push({
      id: key,
      displayName: name,
      roleTitle: title,
      country: "CN",
      workerType: "UNRESOLVED",
      classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW",
      compensation: { type: "CONTRACT", amount: money(1500), currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "UNCONFIRMED" },
      startDate: "2025-06-01",
      isOwner: false,
      relatedParty: false,
      payMethod: "INTERNATIONAL_PLATFORM",
      documentIds: [],
      internationalReview: { status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED", fields: cnFields(key), reviewerRole: "ATTORNEY", notes: ["No W-8 / contract on file."] },
      isSynthetic: true,
    });
  }
  ds.workers.push({
    id: WORKER_IDS.usContractor,
    displayName: "Pixel Forge Design (SYNTHETIC)",
    roleTitle: "Designer — works fixed hours on company tools",
    country: "US",
    workerType: "CONTRACTOR",
    classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW",
    compensation: { type: "CONTRACT", amount: money(4000), currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "UNCONFIRMED" },
    startDate: "2026-02-01",
    isOwner: false,
    relatedParty: false,
    payMethod: "ACH",
    documentIds: [],
    isSynthetic: true,
  });
  return ds;
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export const FIXTURES: Record<string, () => CompanyDataset> = {
  empty: emptyFixture,
  "ap-ar-open-items": apArFixture,
  "locked-period": lockedPeriodFixture,
  "audit-known": auditKnownFixture,
  "payroll-run": payrollRunFixture,
  workers: workersFixture,
};

export const FIXTURE_NAMES = ["synthetic-default", ...Object.keys(FIXTURES)];

export function isFixtureName(name: string): boolean {
  return name === "synthetic-default" || Object.prototype.hasOwnProperty.call(FIXTURES, name);
}

export function buildFixtureDataset(name: string): CompanyDataset {
  const builder = FIXTURES[name];
  if (!builder) throw new Error(`Unknown eval fixture "${name}" (known: ${FIXTURE_NAMES.join(", ")})`);
  return builder();
}
