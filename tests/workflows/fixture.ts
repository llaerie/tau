/**
 * Deterministic synthetic fixture for workflow / monitor tests (no lib/synthetic dependency).
 * As-of 2026-09-09 (Wednesday). Three full months (Jun–Aug 2026) plus early September:
 * chart of accounts, 2 bank accounts + 1 card, payroll (semi-monthly, 6 runs), AR invoices
 * (one OVERDUE), card charges, a transfer, a distribution, an uncategorized suspense item,
 * a possible-personal weekend meal, a new-merchant equipment purchase (fixed asset), a prepaid
 * with two amortization months, a bill + a duplicate bill, an approved budget, a related-party
 * customer without a contract and an unresolved China-based worker.
 */
import { ACCT, accountIdForCode, buildChartOfAccounts } from "@/lib/accounting/chart-of-accounts";
import { Ledger } from "@/lib/accounting/ledger";
import { entryForBankTransaction, entryForBillReceived, entryForCardCharge, entryForInvoiceIssued, entryForInvoicePayment, entryForPayrollRun, entryForPrepaidAmortization, entryForTransfer, simpleEntry } from "@/lib/accounting/posting-helpers";
import type { NewJournalEntryInput } from "@/lib/core/contracts";
import { deterministicId } from "@/lib/core/ids";
import { add, cents, money, mul, sub } from "@/lib/core/money";
import { emptyDataset, type Actor, type Bill, type Budget, type CategoryStatus, type CompanyDataset, type ConfigField, type Document, type EntityRef, type FixedAsset, type Invoice, type PayrollLine, type PayrollRun, type PayrollTotals, type Transaction, type TransactionFlag, type Worker } from "@/lib/core/types";
import { createLabRuntime, type LabRuntime } from "@/lib/db/runtime";

export const AS_OF = "2026-09-09";
export const FIXTURE_ACTOR: Actor = { type: "SYSTEM", id: "fixture", role: "SYSTEM", displayName: "Fixture generator" };
export const OWNER: Actor = { type: "USER", id: "user_owner", role: "OWNER", displayName: "Owner (synthetic)" };
export const OPERATOR: Actor = { type: "USER", id: "user_ops", role: "FINANCE_OPERATOR", displayName: "Operator (synthetic)" };
export const CPA_ACTOR: Actor = { type: "USER", id: "user_cpa", role: "CPA", displayName: "CPA (synthetic)" };
export const VIEWER: Actor = { type: "USER", id: "user_viewer", role: "VIEWER" };

export const fid = (key: string) => deterministicId("fx", key);
export const IDS = {
  checking: fid("bank_checking"),
  savings: fid("bank_savings"),
  card: fid("card_main"),
  harbor: fid("cust_harbor"),
  owner: fid("wrk_owner"),
  finance: fid("wrk_finance"),
  engineer: fid("wrk_engineer"),
  cn1: fid("wrk_cn1"),
  vendorCpa: fid("vend_cpa"),
  vendorAws: fid("vend_aws"),
  vendorDell: fid("vend_dell"),
  vendorInsurance: fid("vend_insurance"),
  vendorGlobalPay: fid("vend_globalpay"),
  suspenseTx: fid("tx_venmo_2026-08-20"),
  mealTx: fid("tx_bistro_2026-08-15"),
  dellTx: fid("tx_dell_2026-08-28"),
  augInvoice: fid("inv_2026-08"),
  bill: fid("bill_cpa_aug"),
  dupBill: fid("bill_cpa_aug_dup"),
  asset: fid("asset_dell_laptop"),
  budget: fid("budget_fy2026"),
};

export interface FixtureOptions {
  /** Include the uncategorized Venmo outflow posted to suspense (default true). */
  includeSuspense?: boolean;
}

type Source = "checking" | "savings" | "card";
interface TxSpec {
  key: string;
  source: Source;
  date: string;
  amount: string | number;
  description: string;
  merchant?: string;
  counterparty?: EntityRef;
  categoryCode: string | null;
  status?: CategoryStatus;
  flags?: TransactionFlag[];
  reason?: string;
}

const cf = <T,>(key: string, section: string, label: string, value: T, status: ConfigField["status"] = "CONFIRMED"): ConfigField<T> => ({ key, section, label, value, status, synthetic: true, note: "[SYNTHETIC] fixture" });

function payrollLine(workerId: string, gross: string): PayrollLine {
  const pct = (p: number) => cents(mul(gross, p));
  const fed = pct(0.1);
  const ss = pct(0.062);
  const med = pct(0.0145);
  const st = pct(0.04);
  const sdi = pct(0.01);
  const net = sub(gross, add(fed, ss, med, st, sdi));
  const sser = pct(0.062);
  const meder = pct(0.0145);
  const futa = pct(0.006);
  const sui = pct(0.034);
  const ett = pct(0.001);
  return {
    workerId,
    gross: money(gross),
    federalIncomeTaxWithheld: money(fed),
    stateIncomeTaxWithheld: money(st),
    socialSecurityEmployee: money(ss),
    medicareEmployee: money(med),
    stateDisabilityEmployee: money(sdi),
    otherDeductions: money(0),
    netPay: money(net),
    socialSecurityEmployer: money(sser),
    medicareEmployer: money(meder),
    federalUnemploymentEmployer: money(futa),
    stateUnemploymentEmployer: money(sui),
    stateTrainingTaxEmployer: money(ett),
    otherEmployerCosts: money(0),
    totalEmployerCost: add(gross, sser, meder, futa, sui, ett),
  };
}

function totalsOf(lines: PayrollLine[]): PayrollTotals {
  const s = (f: (l: PayrollLine) => string) => lines.reduce((acc, l) => add(acc, f(l)), money(0));
  const employeeTaxes = s((l) => add(l.federalIncomeTaxWithheld, l.stateIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.stateDisabilityEmployee));
  const employerTaxes = s((l) => add(l.socialSecurityEmployer, l.medicareEmployer, l.federalUnemploymentEmployer, l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer));
  return { gross: s((l) => l.gross), employeeTaxes, otherDeductions: s((l) => l.otherDeductions), netPay: s((l) => l.netPay), employerTaxes, totalEmployerCost: s((l) => l.totalEmployerCost) };
}

export function buildFixtureDataset(opts: FixtureOptions = {}): CompanyDataset {
  const includeSuspense = opts.includeSuspense ?? true;
  const ds = emptyDataset({
    id: "co_fixture_synthetic",
    displayName: "Fixture Labs LLC (SYNTHETIC)",
    isSynthetic: true,
    entityType: cf("entityType", "entity", "Entity type", "LLC"),
    taxElection: cf("taxElection", "entity", "Tax election", "S_CORPORATION"),
    state: cf("state", "entity", "State", "CA"),
    fiscalYearEnd: cf("fiscalYearEnd", "entity", "Fiscal year end", "12-31"),
    accountingMethod: cf<"CASH" | "ACCRUAL">("accountingMethod", "entity", "Accounting method", "ACCRUAL"),
    functionalCurrency: "USD",
    asOfDate: AS_OF,
  });
  ds.accounts = buildChartOfAccounts();
  ds.bankAccounts.push(
    { id: IDS.checking, name: "Operating Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "4410", currency: "USD", glAccountId: accountIdForCode("1000"), isSynthetic: true, openedDate: "2026-05-01" },
    { id: IDS.savings, name: "Business Savings", institution: "Synthetic Bank", accountType: "SAVINGS", last4: "4428", currency: "USD", glAccountId: accountIdForCode("1010"), isSynthetic: true, openedDate: "2026-05-01" },
  );
  ds.cards.push({ id: IDS.card, name: "Business Visa", issuer: "Synthetic Card Co", last4: "7731", currency: "USD", glAccountId: accountIdForCode("2050"), isSynthetic: true, paymentDueDay: 25 });
  const vendor = (id: string, name: string, aliases: string[], code: string | undefined, recurring: boolean, taxDoc: "NOT_REQUIRED" | "ON_FILE" | "UNKNOWN" = "NOT_REQUIRED") => ({ id, name, normalizedNames: aliases, defaultAccountId: code ? accountIdForCode(code) : undefined, isRecurring: recurring, country: "US", taxDocStatus: taxDoc, active: true, createdAt: "2026-05-01T00:00:00.000Z" });
  ds.vendors.push(vendor(IDS.vendorCpa, "Kestrel Tax & Advisory LLP", ["kestrel tax"], "7200", true, "ON_FILE"), vendor(IDS.vendorAws, "Amazon Web Services", ["aws"], "5000", true), vendor(IDS.vendorDell, "Dell Business", ["dell business"], "1500", false), vendor(IDS.vendorInsurance, "Hartline Business Insurance", ["hartline insurance"], "7250", true), vendor(IDS.vendorGlobalPay, "GlobalPay International Platform", ["globalpay"], "6060", true, "UNKNOWN"));
  ds.customers.push({ id: IDS.harbor, name: "Harbor Analytics Group", paymentTermsDays: 15, country: "US", relatedParty: true, relatedPartyNote: "payer associated with the CEO's father", active: true });

  const usWorker = (id: string, name: string, title: string, monthly: number, extra: Partial<Worker>): Worker => ({ id, displayName: name, roleTitle: title, country: "US", workerType: "EMPLOYEE", classificationStatus: "CONFIRMED", compensation: { type: "SALARY", amount: money(monthly), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" }, startDate: "2026-06-01", isOwner: false, relatedParty: false, payMethod: "PAYROLL_PROVIDER", documentIds: [], isSynthetic: true, ...extra });
  const owner = usWorker(IDS.owner, "Avery Lin", "CEO", 3000, { isOwner: true, relatedParty: true, relatedPartyNote: "Sole shareholder", compensation: { type: "SALARY", amount: money(3000), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED", note: "reasonable compensation is a professional judgment" } });
  const finance = usWorker(IDS.finance, "Jordan Reyes", "Finance Operator", 3000, { relatedParty: true, relatedPartyNote: "Fiancée of the owner" });
  const engineer = usWorker(IDS.engineer, "Sam Okafor", "Software Engineer", 5500, {});
  const cn1: Worker = { id: IDS.cn1, displayName: "Wei Zhang", roleTitle: "ML Engineer (China-based)", country: "CN", workerType: "UNRESOLVED", classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW", compensation: { type: "CONTRACT", amount: money(1500), currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "UNCONFIRMED" }, startDate: "2026-06-01", isOwner: false, relatedParty: false, payMethod: "INTERNATIONAL_PLATFORM", documentIds: [], isSynthetic: true, internationalReview: { status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED", reviewerRole: "ATTORNEY", fields: ["employment_status", "withholding_responsibilities", "tax_documentation"].map((k) => ({ key: `worker.cn1.${k}`, section: "international_worker", label: k, value: null, status: "PROFESSIONAL_REVIEW_REQUIRED" as const, requiredConfirmer: "ATTORNEY" as const, synthetic: true })), notes: ["Payments recorded to 6060 pending professional review."] } };
  ds.workers.push(owner, finance, engineer, cn1);
  const payrollWorkers = [owner, finance, engineer];

  ds.configFields = [
    cf("expense_policy.receipt_required_above", "Expense policy", "Receipt required above (USD)", "2500.00"),
    cf("materiality.transactionReviewAmount", "materiality", "Transaction review amount", "500.00"),
    cf("materiality.redAmount", "materiality", "Red amount", "10000.00"),
    cf("materiality.varianceRatio", "materiality", "Variance ratio", 0.1),
    cf("international_workforce.china_worker_classification", "International workforce", "China worker classification", null, "PROFESSIONAL_REVIEW_REQUIRED"),
  ];

  const ledger = new Ledger(ds);
  const postings: { date: string; seq: number; run: () => void }[] = [];
  let seq = 0;
  const schedule = (date: string, run: () => void) => postings.push({ date, seq: seq++, run });
  const glCode: Record<Source, string> = { checking: "1000", savings: "1010", card: "2050" };
  const srcId: Record<Source, string> = { checking: IDS.checking, savings: IDS.savings, card: IDS.card };

  const addTx = (s: TxSpec): Transaction => {
    const status: CategoryStatus = s.status ?? (s.categoryCode ? "APPROVED" : "UNCATEGORIZED");
    const tx: Transaction = {
      id: fid(`tx_${s.key}`),
      sourceKind: s.source === "card" ? "CARD" : "BANK",
      sourceAccountId: srcId[s.source],
      externalId: `ext_${s.key}`,
      date: s.date,
      postedDate: s.date,
      amount: money(s.amount),
      currency: "USD",
      descriptionRaw: s.description,
      merchantNormalized: s.merchant,
      counterpartyRef: s.counterparty,
      category: { accountId: s.categoryCode ? accountIdForCode(s.categoryCode) : null, status, confidence: status === "APPROVED" ? 0.98 : status === "SUGGESTED" ? 0.6 : 0, reason: s.reason, suggestedBy: status === "UNCATEGORIZED" ? undefined : "RULE", approvedBy: status === "APPROVED" ? OPERATOR.id : undefined },
      documentIds: [],
      flags: [...(s.flags ?? [])],
      importBatchId: `import_${s.source}_${s.date.slice(0, 7)}`,
      meta: { isSynthetic: true },
    };
    ds.transactions.push(tx);
    return tx;
  };
  const link = (tx: Transaction, entryId: string) => {
    tx.journalEntryId = entryId;
  };
  const postTx = (tx: Transaction, offsetCode: string, extra: Partial<NewJournalEntryInput> = {}) => {
    const entryId = fid(`je_${tx.id}`);
    schedule(tx.date, () => {
      const code = glCode[tx.sourceAccountId === IDS.checking ? "checking" : tx.sourceAccountId === IDS.savings ? "savings" : "card"];
      const base = tx.sourceKind === "CARD" ? entryForCardCharge(tx, offsetCode, code, { id: entryId, post: true }) : entryForBankTransaction(tx, offsetCode, code, { id: entryId, post: true });
      const e = ledger.createEntry({ ...base, ...extra, tags: [...(base.tags ?? []), ...(extra.tags ?? [])] }, FIXTURE_ACTOR);
      link(tx, e.id);
    });
    return entryId;
  };
  const postEntry = (date: string, input: NewJournalEntryInput, txs: Transaction[]) => {
    schedule(date, () => {
      const e = ledger.createEntry({ ...input, post: true }, FIXTURE_ACTOR);
      for (const t of txs) link(t, e.id);
    });
  };

  // Opening capital (owner contribution) — real deposits, linked to one entry.
  const openChk = addTx({ key: "open_checking", source: "checking", date: "2026-06-01", amount: 50000, description: "OWNER CAPITAL CONTRIBUTION", merchant: "owner contribution", counterparty: { type: "OWNER", id: IDS.owner }, categoryCode: "3000" });
  const openSav = addTx({ key: "open_savings", source: "savings", date: "2026-06-01", amount: 20000, description: "OWNER CAPITAL CONTRIBUTION", merchant: "owner contribution", counterparty: { type: "OWNER", id: IDS.owner }, categoryCode: "3000" });
  postEntry("2026-06-01", { id: fid("je_opening"), date: "2026-06-01", description: "Owner capital contribution", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: 50000 }, { accountCode: "1010", debit: 20000 }, { accountCode: "3000", credit: 70000 }], sourceIds: [openChk.id, openSav.id], tags: ["opening-balance"] }, [openChk, openSav]);

  // Invoices: monthly 30,000 to the related-party customer; Jun/Jul paid, Aug overdue, Sep open.
  const invoiceMonths: { m: string; status: Invoice["status"]; paidOn?: string }[] = [
    { m: "2026-06", status: "PAID", paidOn: "2026-06-16" },
    { m: "2026-07", status: "PAID", paidOn: "2026-07-16" },
    { m: "2026-08", status: "OVERDUE" },
    { m: "2026-09", status: "SENT" },
  ];
  for (const im of invoiceMonths) {
    const id = fid(`inv_${im.m}`);
    const inv: Invoice = { id, number: `INV-${im.m}`, customerId: IDS.harbor, issueDate: `${im.m}-01`, dueDate: `${im.m}-16`, currency: "USD", total: money(30000), amountPaid: money(im.paidOn ? 30000 : 0), status: im.status, lines: [{ id: `${id}_l1`, description: `AI services ${im.m}`, quantity: "1", unitPrice: money(30000), amount: money(30000), revenueAccountId: accountIdForCode("4000") }], paymentIds: [], journalEntryId: fid(`je_inv_${im.m}`) };
    ds.invoices.push(inv);
    postEntry(inv.issueDate, entryForInvoiceIssued(inv, { id: inv.journalEntryId }), []);
    if (im.paidOn) {
      const tx = addTx({ key: `invpay_${im.m}`, source: "checking", date: im.paidOn, amount: 30000, description: `ACH HARBOR ANALYTICS INV-${im.m}`, merchant: "harbor analytics group", counterparty: { type: "CUSTOMER", id: IDS.harbor }, categoryCode: "1100", flags: ["RELATED_PARTY"] });
      const payId = fid(`pay_${im.m}`);
      ds.payments.push({ id: payId, direction: "IN", date: im.paidOn, amount: money(30000), currency: "USD", method: "ACH", counterpartyRef: { type: "CUSTOMER", id: IDS.harbor }, applications: [{ targetType: "INVOICE", targetId: id, amount: money(30000) }], transactionId: tx.id, journalEntryId: fid(`je_pay_${im.m}`) });
      inv.paymentIds.push(payId);
      postEntry(im.paidOn, entryForInvoicePayment(inv, ds.payments[ds.payments.length - 1], "1000", { id: fid(`je_pay_${im.m}`) }), [tx]);
    }
  }

  // Payroll: semi-monthly, 6 runs, net pay from checking; federal liabilities accrued (due date unknown).
  const payDates = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-15", "2026-08-31"];
  for (const payDate of payDates) {
    const lines = payrollWorkers.map((w) => payrollLine(w.id, money(Number(w.compensation.amount) / 2)));
    const totals = totalsOf(lines);
    const tx = addTx({ key: `payroll_${payDate}`, source: "checking", date: payDate, amount: `-${totals.netPay}`, description: "PAYSTREAM PAYROLL NET PAY", merchant: "paystream payroll", categoryCode: "6000" });
    const runId = fid(`run_${payDate}`);
    const jeId = fid(`je_run_${payDate}`);
    const run: PayrollRun = { id: runId, periodStart: payDate.endsWith("-15") ? `${payDate.slice(0, 8)}01` : `${payDate.slice(0, 8)}16`, periodEnd: payDate, payDate, currency: "USD", status: "PAID", lines, totals, journalEntryId: jeId, netPayTransactionIds: [tx.id] };
    ds.payrollRuns.push(run);
    postEntry(payDate, entryForPayrollRun(run, payrollWorkers, "1000", { id: jeId }), [tx]);
    const fedAmount = lines.reduce((acc, l) => add(acc, l.federalIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.socialSecurityEmployer, l.medicareEmployer), money(0));
    ds.payrollLiabilities.push({ id: fid(`pl_fed_${payDate}`), payrollRunId: runId, kind: "FEDERAL_WITHHOLDING_AND_FICA", amount: fedAmount, currency: "USD", accruedDate: payDate, dueDate: null, status: "ACCRUED", glAccountId: accountIdForCode("2200") });
  }

  // Recurring operating spend (card) and rent / international worker (bank), Jun–Aug.
  const months = ["2026-06", "2026-07", "2026-08"];
  const cardSpend: { key: string; day: string; amount: number; description: string; merchant: string; code: string; vendor?: string }[] = [
    { key: "github", day: "03", amount: 40, description: "GITHUB TEAM", merchant: "github", code: "7000" },
    { key: "google", day: "05", amount: 30, description: "GOOGLE *WORKSPACE", merchant: "google workspace", code: "7000" },
    { key: "aws", day: "08", amount: 1200, description: "AMAZON WEB SERVICES", merchant: "aws", code: "5000", vendor: IDS.vendorAws },
    { key: "openai", day: "12", amount: 400, description: "OPENAI *API", merchant: "openai", code: "5100" },
  ];
  const monthlyCardTotal = cardSpend.reduce((a, c) => a + c.amount, 0);
  months.forEach((m, i) => {
    for (const c of cardSpend) {
      const tx = addTx({ key: `${c.key}_${m}`, source: "card", date: `${m}-${c.day}`, amount: -c.amount, description: c.description, merchant: c.merchant, counterparty: c.vendor ? { type: "VENDOR", id: c.vendor } : undefined, categoryCode: c.code });
      postTx(tx, c.code);
    }
    const rent = addTx({ key: `rent_${m}`, source: "checking", date: `${m}-01`, amount: -800, description: "BRIGHTWORK COWORKING", merchant: "brightwork coworking", categoryCode: "7100" });
    postTx(rent, "7100");
    const intl = addTx({ key: `globalpay_${m}`, source: "checking", date: `${m}-20`, amount: -1500, description: "GLOBALPAY INTL PLATFORM", merchant: "globalpay", counterparty: { type: "CONTRACTOR", id: IDS.cn1 }, categoryCode: "6060", flags: ["INTERNATIONAL"] });
    postTx(intl, "6060");
    // Pay the prior month's card statement on the 25th (Jul pays Jun, Aug pays Jul).
    if (i > 0) {
      const amt = monthlyCardTotal;
      const bankTx = addTx({ key: `cardpay_bank_${m}`, source: "checking", date: `${m}-25`, amount: -amt, description: "PAYMENT TO BUSINESS VISA", merchant: "card payment", categoryCode: "2050", flags: ["TRANSFER"] });
      const cardTx = addTx({ key: `cardpay_card_${m}`, source: "card", date: `${m}-25`, amount: amt, description: "PAYMENT RECEIVED - THANK YOU", merchant: "card payment", categoryCode: "1000", flags: ["TRANSFER"] });
      bankTx.transferPairId = cardTx.id;
      cardTx.transferPairId = bankTx.id;
      postEntry(`${m}-25`, entryForTransfer("1000", "2050", amt, `${m}-25`, { id: fid(`je_cardpay_${m}`), sourceIds: [bankTx.id, cardTx.id] }), [bankTx, cardTx]);
    }
  });
  // September: one recurring card charge so the current month has activity.
  postTx(addTx({ key: "github_2026-09", source: "card", date: "2026-09-03", amount: -40, description: "GITHUB TEAM", merchant: "github", categoryCode: "7000" }), "7000");

  // Transfer checking → savings, and a shareholder distribution (restricted account).
  const trOut = addTx({ key: "transfer_out_2026-07-10", source: "checking", date: "2026-07-10", amount: -5000, description: "TRANSFER TO SAVINGS", merchant: "internal transfer", categoryCode: "1010", flags: ["TRANSFER"] });
  const trIn = addTx({ key: "transfer_in_2026-07-10", source: "savings", date: "2026-07-10", amount: 5000, description: "TRANSFER FROM CHECKING", merchant: "internal transfer", categoryCode: "1000", flags: ["TRANSFER"] });
  trOut.transferPairId = trIn.id;
  trIn.transferPairId = trOut.id;
  postEntry("2026-07-10", entryForTransfer("1000", "1010", 5000, "2026-07-10", { id: fid("je_transfer_2026-07-10"), sourceIds: [trOut.id, trIn.id] }), [trOut, trIn]);
  const dist = addTx({ key: "distribution_2026-07-28", source: "checking", date: "2026-07-28", amount: -4000, description: "OWNER DISTRIBUTION", merchant: "owner distribution", counterparty: { type: "OWNER", id: IDS.owner }, categoryCode: "3100", flags: ["RELATED_PARTY"] });
  postEntry("2026-07-28", simpleEntry("2026-07-28", "Shareholder distribution", "MANUAL", "3100", "1000", 4000, { id: fid("je_distribution_2026-07-28"), sourceIds: [dist.id], tags: ["distribution"] }), [dist]);

  // Prepaid insurance (12 months) with amortization for Jun and Jul; August is missing on purpose.
  const ins = addTx({ key: "insurance_2026-06-05", source: "checking", date: "2026-06-05", amount: -1200, description: "HARTLINE INSURANCE ANNUAL PREMIUM", merchant: "hartline insurance", counterparty: { type: "VENDOR", id: IDS.vendorInsurance }, categoryCode: "1200" });
  postTx(ins, "1200", { tags: ["prepaid", "amortize-months:12", "amortize-to:7250"] });
  for (const m of ["2026-06", "2026-07"]) postEntry(`${m}-30`, entryForPrepaidAmortization(100, "7250", `${m}-30`, { id: fid(`je_amort_${m}`), sourceIds: [ins.id] }), []);

  // Weekend restaurant charge flagged possible personal (2026-08-15 is a Saturday).
  const meal = addTx({ key: "bistro_2026-08-15", source: "card", date: "2026-08-15", amount: -185.4, description: "BISTRO LUNE", merchant: "bistro lune", categoryCode: "7300", status: "SUGGESTED", flags: ["POSSIBLE_PERSONAL", "REVIEW_REQUIRED"] });
  postTx(meal, "7300");

  // New-merchant equipment purchase → fixed asset with receipt (no depreciation posted yet).
  const dell = addTx({ key: "dell_2026-08-28", source: "checking", date: "2026-08-28", amount: -3200, description: "DELL BUSINESS ONLINE", merchant: "dell business", counterparty: { type: "VENDOR", id: IDS.vendorDell }, categoryCode: "1500", flags: ["NEW_MERCHANT", "LARGE_UNUSUAL"] });
  postTx(dell, "1500", { tags: ["capex"] });
  const receipt: Document = { id: fid("doc_dell_receipt"), kind: "RECEIPT", title: "Dell invoice — laptop", date: "2026-08-28", vendorId: IDS.vendorDell, amount: money(3200), currency: "USD", linkedTransactionIds: [dell.id], linkedJournalEntryIds: [], storagePath: "synthetic://documents/receipt/dell.pdf", mimeType: "application/pdf", classificationConfidence: 0.97, retention: { policyKey: "records-retention-default", retainUntil: null }, isSynthetic: true, tags: ["synthetic"], uploadedAt: "2026-08-28T15:00:00.000Z" };
  ds.documents.push(receipt);
  dell.documentIds.push(receipt.id);
  const asset: FixedAsset = { id: IDS.asset, name: "Dell laptop", acquiredDate: "2026-08-28", cost: money(3200), salvageValue: money(0), usefulLifeMonths: 36, method: "STRAIGHT_LINE", assetAccountId: accountIdForCode("1500"), accumulatedDepreciationAccountId: accountIdForCode("1590"), depreciationExpenseAccountId: accountIdForCode("7700"), inServiceDate: "2026-08-28", sourceTransactionId: dell.id, documentId: receipt.id, taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED" };
  ds.fixedAssets.push(asset);

  // Uncategorized Venmo outflow posted to suspense (optional).
  if (includeSuspense) {
    const venmo = addTx({ key: "venmo_2026-08-20", source: "checking", date: "2026-08-20", amount: -250, description: "VENMO PAYMENT 8827", merchant: "venmo", categoryCode: null, flags: ["UNCATEGORIZED", "REVIEW_REQUIRED"] });
    postTx(venmo, "9999");
  }

  // CPA bill (open, due Sep 20) recorded to AP, plus a duplicate copy.
  const bill: Bill = { id: IDS.bill, vendorId: IDS.vendorCpa, number: "KT-2026-08", receivedDate: "2026-08-25", billDate: "2026-08-25", dueDate: "2026-09-20", currency: "USD", total: money(1500), amountPaid: money(0), status: "RECEIVED", expenseAccountId: accountIdForCode("7200"), description: "Monthly advisory retainer", paymentIds: [], journalEntryId: fid("je_bill_cpa_aug") };
  ds.bills.push(bill, { ...bill, id: IDS.dupBill, receivedDate: "2026-08-27", status: "DUPLICATE", duplicateOfId: IDS.bill, journalEntryId: undefined });
  postEntry("2026-08-25", entryForBillReceived(bill, { id: bill.journalEntryId }), []);

  // Bank statements on file for Jun and Jul only (August missing on purpose).
  for (const m of ["2026-06", "2026-07"]) {
    for (const b of ds.bankAccounts) ds.documents.push({ id: fid(`doc_stmt_${b.id}_${m}`), kind: "BANK_STATEMENT", title: `${b.name} statement ${m}`, date: `${m}-30`, linkedTransactionIds: [], linkedJournalEntryIds: [], storagePath: `synthetic://documents/statement/${b.id}_${m}.pdf`, mimeType: "application/pdf", extracted: { accountId: b.id }, classificationConfidence: 0.99, retention: { policyKey: "records-retention-default", retainUntil: null }, isSynthetic: true, tags: ["synthetic", `account:${b.id}`], uploadedAt: `${m}-30T15:00:00.000Z` });
  }

  // Approved FY2026 budget (AWS budgeted at 1,000/month → 20% overrun).
  const budgetLines = ["2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m) => [
    { accountId: accountIdForCode("4000"), month: m, amount: money(30000) },
    { accountId: accountIdForCode("5000"), month: m, amount: money(1000) },
    { accountId: accountIdForCode("5100"), month: m, amount: money(400) },
    { accountId: accountIdForCode("7000"), month: m, amount: money(100) },
    { accountId: accountIdForCode("7100"), month: m, amount: money(800) },
    { accountId: accountIdForCode("6000"), month: m, amount: money(8500) },
    { accountId: accountIdForCode("6010"), month: m, amount: money(3000) },
    { accountId: accountIdForCode("6100"), month: m, amount: money(1400) },
  ]);
  const budget: Budget = { id: IDS.budget, name: "FY2026 approved budget (synthetic)", fiscalYear: 2026, version: 1, status: "APPROVED", lines: budgetLines, assumptions: [], approvedBy: OWNER.id, approvedAt: "2026-05-31T00:00:00.000Z", createdAt: "2026-05-30T00:00:00.000Z" };
  ds.budgets.push(budget);

  // Execute postings in date order so entry numbers are chronological.
  postings.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  for (const p of postings) p.run();
  return ds;
}

export async function makeFixtureRuntime(opts: FixtureOptions = {}): Promise<LabRuntime> {
  return createLabRuntime({ dataset: buildFixtureDataset(opts), asOfDate: AS_OF, skipRetrieval: true });
}

/** Open and approve a LOCK_PERIOD approval through the real approval engine (requester ≠ approver). */
export async function approvedLockApproval(rt: LabRuntime, periodId: string): Promise<string> {
  const action = {
    id: fid(`pa_lock_${periodId}_${rt.dataset.approvals.length}`),
    kind: "LOCK_PERIOD" as const,
    agent: "controller" as const,
    description: `Lock period ${periodId}`,
    targetIds: [periodId],
    payload: { periodId },
    reason: "Month-end close complete",
    sourceDocumentIds: [],
    confidence: 1,
    reversible: true,
    createdAt: `${AS_OF}T00:00:00.000Z`,
  };
  const risk = rt.risk.assess(action, { thresholds: rt.thresholds });
  const req = await rt.approvals.request(action, risk, OPERATOR);
  const decided = await rt.approvals.decide(req.id, "APPROVED", OWNER, "Reviewed the close checklist");
  if (decided.status !== "APPROVED") throw new Error(`Fixture approval is ${decided.status}`);
  return decided.id;
}

export { ACCT, accountIdForCode };
