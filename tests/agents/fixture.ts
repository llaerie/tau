/**
 * Deterministic fixture for agent tests: a small S-corp ledger with posted entries, open
 * invoices/bills, a locked period, workers, a payroll run and a handful of transactions.
 * Everything is synthetic; no network, no database.
 */
import { accountIdForCode, buildChartOfAccounts } from "@/lib/accounting/chart-of-accounts";
import { Ledger } from "@/lib/accounting/ledger";
import { emptyDataset, type Actor, type CompanyDataset, type Transaction } from "@/lib/core/types";
import { money } from "@/lib/core/money";
import { MemoryStore } from "@/lib/db/memory-store";
import { createLabRuntime, toolContextFor, type LabRuntime } from "@/lib/db/runtime";
import type { ToolContext } from "@/lib/core/contracts";
import type { AgentName } from "@/lib/core/types";

export const AS_OF = "2026-09-09";
export const OWNER: Actor = { type: "USER", id: "user_owner", role: "OWNER", displayName: "Owner" };
export const OPERATOR: Actor = { type: "USER", id: "user_ops", role: "FINANCE_OPERATOR", displayName: "Operator" };
export const VIEWER: Actor = { type: "USER", id: "user_viewer", role: "VIEWER", displayName: "Viewer" };
export const SYSTEM: Actor = { type: "SYSTEM", id: "fixture", role: "SYSTEM" };
const A = accountIdForCode;

function tx(partial: Partial<Transaction> & { id: string; amount: string; date: string; descriptionRaw: string }): Transaction {
  return { sourceKind: "BANK", sourceAccountId: "bank_checking", externalId: `ext_${partial.id}`, postedDate: partial.date, currency: "USD", category: { accountId: null, status: "UNCATEGORIZED", confidence: 0 }, documentIds: [], flags: [], importBatchId: "batch_1", ...partial };
}

export function buildFixtureDataset(): CompanyDataset {
  const ds = emptyDataset({
    id: "co_agent_fixture",
    displayName: "Agent Fixture Co (SYNTHETIC)",
    isSynthetic: true,
    entityType: { key: "entityType", section: "entity", label: "Entity type", value: "LLC", status: "CONFIRMED", synthetic: true },
    taxElection: { key: "taxElection", section: "entity", label: "Tax election", value: "S_CORPORATION", status: "CONFIRMED", synthetic: true },
    state: { key: "state", section: "entity", label: "State", value: "CA", status: "CONFIRMED", synthetic: true },
    fiscalYearEnd: { key: "fye", section: "entity", label: "Fiscal year end", value: "12-31", status: "CONFIRMED", synthetic: true },
    accountingMethod: { key: "method", section: "accounting", label: "Method", value: "ACCRUAL", status: "CONFIRMED", synthetic: true },
    functionalCurrency: "USD",
    asOfDate: AS_OF,
  });
  ds.accounts = buildChartOfAccounts();
  ds.bankAccounts.push({ id: "bank_checking", name: "Operating Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "1234", currency: "USD", glAccountId: A("1000"), isSynthetic: true });
  ds.bankAccounts.push({ id: "bank_savings", name: "Business Savings", institution: "Synthetic Bank", accountType: "SAVINGS", last4: "5678", currency: "USD", glAccountId: A("1010"), isSynthetic: true });
  ds.cards.push({ id: "card_main", name: "Business Card", issuer: "Synthetic Card Co", last4: "9876", currency: "USD", glAccountId: A("2050"), isSynthetic: true });
  ds.vendors = [
    { id: "vend_github", name: "GitHub, Inc.", normalizedNames: ["GITHUB", "GITHUB TEAM"], defaultAccountId: A("7000"), isRecurring: true, country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2025-06-01T00:00:00Z" },
    { id: "vend_law", name: "Law LLP", normalizedNames: ["LAW LLP"], defaultAccountId: A("7200"), paymentTermsDays: 30, isRecurring: false, country: "US", taxDocStatus: "ON_FILE", active: true, createdAt: "2025-06-01T00:00:00Z" },
    { id: "vend_brightwork", name: "Brightwork Coworking", normalizedNames: ["BRIGHTWORK COWORKING", "BRIGHTWORK"], defaultAccountId: A("7100"), paymentTermsDays: 7, isRecurring: true, country: "US", taxDocStatus: "ON_FILE", active: true, createdAt: "2025-06-01T00:00:00Z" },
  ];
  ds.customers = [
    { id: "cust_harbor", name: "Harbor Analytics", paymentTermsDays: 30, country: "US", relatedParty: false, active: true },
    { id: "cust_meridian", name: "Meridian Holdings", paymentTermsDays: 30, country: "US", relatedParty: true, relatedPartyNote: "Associated with the owner's father", active: true },
  ];
  ds.workers = [
    { id: "w_owner", displayName: "Avery Owner", roleTitle: "CEO", country: "US", workerType: "EMPLOYEE", classificationStatus: "CONFIRMED", compensation: { type: "SALARY", amount: "3000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED" }, startDate: "2025-06-01", isOwner: true, relatedParty: true, payMethod: "PAYROLL_PROVIDER", documentIds: [], isSynthetic: true },
    { id: "w_eng", displayName: "Sam Engineer", roleTitle: "Engineer", country: "US", workerType: "EMPLOYEE", classificationStatus: "CONFIRMED", compensation: { type: "SALARY", amount: "8000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED" }, startDate: "2025-06-01", isOwner: false, relatedParty: false, payMethod: "PAYROLL_PROVIDER", documentIds: [], isSynthetic: true },
    { id: "w_cn", displayName: "Li Wei", roleTitle: "Developer", country: "CN", workerType: "UNRESOLVED", classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW", compensation: { type: "CONTRACT", amount: "2500", currency: "USD", period: "MONTHLY", basis: "UNKNOWN", status: "UNCONFIRMED" }, startDate: "2025-09-01", isOwner: false, relatedParty: false, payMethod: "INTERNATIONAL_PLATFORM", documentIds: [], internationalReview: { status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED", reviewerRole: "ATTORNEY", fields: [{ key: "worker.li_wei.employment_status", section: "international_worker", label: "Employment vs contractor status", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED" }, { key: "worker.li_wei.contract", section: "international_worker", label: "Written contract on file", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED" }] }, isSynthetic: true },
  ];

  const ledger = new Ledger(ds);
  const post = (date: string, description: string, lines: [string, "debit" | "credit", string][], source: "OPENING_BALANCE" | "AR" | "BANK_IMPORT" | "CARD_IMPORT" | "PAYROLL" | "MANUAL" | "AP" = "MANUAL", id?: string) =>
    ledger.createEntry({ id, date, description, source, post: true, lines: lines.map(([code, side, amt]) => (side === "debit" ? { accountCode: code, debit: money(amt) } : { accountCode: code, credit: money(amt) })) }, SYSTEM);

  post("2025-12-01", "Opening balances", [["1000", "debit", "60000"], ["1010", "debit", "20000"], ["3000", "credit", "80000"]], "OPENING_BALANCE", "je_opening");
  const months = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  months.forEach((m, i) => {
    post(`${m}-15`, `Invoice Harbor ${m}`, [["1100", "debit", "12000"], ["4000", "credit", "12000"]], "AR", `je_inv_${m}`);
    post(`${m}-20`, `Payment Harbor ${m}`, [["1000", "debit", "12000"], ["1100", "credit", "12000"]], "AR", `je_pay_${m}`);
    post(`${m}-05`, `GITHUB TEAM ${m}`, [["7000", "debit", "100"], ["2050", "credit", "100"]], "CARD_IMPORT", `je_gh_${m}`);
    post(`${m}-01`, `Brightwork coworking ${m}`, [["7100", "debit", "2000"], ["1000", "credit", "2000"]], "BANK_IMPORT", `je_rent_${m}`);
    post(`${m}-28`, `Payroll ${m}`, [["6000", "debit", "8000"], ["6010", "debit", "3000"], ["6100", "debit", "900"], ["1000", "credit", "8500"], ["2200", "credit", "2500"], ["2210", "credit", "900"]], "PAYROLL", `je_payroll_${m}`);
    if (i % 2 === 1) post(`${m}-25`, `AWS ${m}`, [["5000", "debit", "1500"], ["1000", "credit", "1500"]], "BANK_IMPORT", `je_aws_${m}`);
  });
  post("2026-03-10", "Shareholder distribution", [["3100", "debit", "5000"], ["1000", "credit", "5000"]], "MANUAL", "je_dist_2026_03");
  post("2026-08-10", "Apple Store MacBook Pro", [["1500", "debit", "3200"], ["2050", "credit", "3200"]], "CARD_IMPORT", "je_apple");
  post("2026-09-01", "Brightwork coworking 2026-09", [["7100", "debit", "2000"], ["1000", "credit", "2000"]], "BANK_IMPORT", "je_rent_2026-09");
  // DRAFT entry for posting tests
  ledger.createEntry({ id: "je_draft_software", date: "2026-09-03", description: "Notion subscription (draft)", source: "CARD_IMPORT", lines: [{ accountCode: "7000", debit: "50.0000" }, { accountCode: "2050", credit: "50.0000" }] }, SYSTEM);
  // Lock December 2025 directly (fixture only)
  const dec = ds.periods.find((p) => p.id === "2025-12")!;
  dec.status = "LOCKED";
  dec.lockedAt = "2026-01-15T00:00:00.000Z";
  dec.lockedBy = "user_owner";
  dec.lockApprovalId = "apr_fixture_lock";

  ds.invoices = [
    { id: "inv_aug", number: "INV-2026-0008", customerId: "cust_harbor", issueDate: "2026-08-15", dueDate: "2026-08-31", currency: "USD", total: "12000.0000", amountPaid: "0.0000", status: "OVERDUE", lines: [{ id: "l1", description: "Services August", quantity: "1.0000", unitPrice: "12000.0000", amount: "12000.0000", revenueAccountId: A("4000") }], paymentIds: [] },
    { id: "inv_sep", number: "INV-2026-0009", customerId: "cust_meridian", issueDate: "2026-09-01", dueDate: "2026-10-01", currency: "USD", total: "4000.0000", amountPaid: "0.0000", status: "SENT", lines: [{ id: "l2", description: "Services September", quantity: "1.0000", unitPrice: "4000.0000", amount: "4000.0000", revenueAccountId: A("4000") }], paymentIds: [] },
  ];
  ds.bills = [
    { id: "bill_law", vendorId: "vend_law", number: "L-1001", receivedDate: "2026-09-01", billDate: "2026-09-01", dueDate: "2026-10-01", currency: "USD", total: "1200.0000", amountPaid: "0.0000", status: "APPROVED", expenseAccountId: A("7200"), description: "Legal services", paymentIds: [] },
    { id: "bill_bright", vendorId: "vend_brightwork", number: "BW-0909", receivedDate: "2026-09-05", billDate: "2026-09-05", dueDate: "2026-09-12", currency: "USD", total: "2000.0000", amountPaid: "0.0000", status: "RECEIVED", expenseAccountId: A("7100"), description: "Coworking October", paymentIds: [] },
  ];
  ds.transactions = [
    tx({ id: "tx_github_aug", date: "2026-08-05", amount: "-100.0000", descriptionRaw: "GITHUB TEAM *1234", merchantNormalized: "GITHUB", sourceKind: "CARD", sourceAccountId: "card_main", counterpartyRef: { type: "VENDOR", id: "vend_github" }, category: { accountId: A("7000"), status: "APPROVED", confidence: 0.98, approvedBy: "user_ops" }, journalEntryId: "je_gh_2026-08" }),
    tx({ id: "tx_github_jul", date: "2026-07-05", amount: "-100.0000", descriptionRaw: "GITHUB TEAM *1234", merchantNormalized: "GITHUB", sourceKind: "CARD", sourceAccountId: "card_main", counterpartyRef: { type: "VENDOR", id: "vend_github" }, category: { accountId: A("7000"), status: "APPROVED", confidence: 0.98, approvedBy: "user_ops" }, journalEntryId: "je_gh_2026-07" }),
    tx({ id: "tx_github_dup", date: "2026-08-07", amount: "-100.0000", descriptionRaw: "GITHUB TEAM *1234", merchantNormalized: "GITHUB", sourceKind: "CARD", sourceAccountId: "card_main" }),
    tx({ id: "tx_bistro", date: "2026-08-08", amount: "-85.5000", descriptionRaw: "BISTRO LUNE SAN FRANCISCO", merchantNormalized: "BISTRO LUNE", sourceKind: "CARD", sourceAccountId: "card_main" }),
    tx({ id: "tx_venmo", date: "2026-08-12", amount: "-400.0000", descriptionRaw: "VENMO PAYMENT 1234567", flags: ["UNCATEGORIZED"] }),
    tx({ id: "tx_xfer_out", date: "2026-08-20", amount: "-5000.0000", descriptionRaw: "ONLINE TRANSFER TO SAVINGS", flags: ["TRANSFER"] }),
    tx({ id: "tx_xfer_in", date: "2026-08-20", amount: "5000.0000", descriptionRaw: "ONLINE TRANSFER FROM CHECKING", sourceAccountId: "bank_savings", flags: ["TRANSFER"] }),
    tx({ id: "tx_apple", date: "2026-08-10", amount: "-3200.0000", descriptionRaw: "APPLE STORE #R123 MACBOOK PRO", merchantNormalized: "APPLE STORE", sourceKind: "CARD", sourceAccountId: "card_main", category: { accountId: A("1500"), status: "APPROVED", confidence: 0.9 }, journalEntryId: "je_apple" }),
    tx({ id: "tx_payroll_aug", date: "2026-08-28", amount: "-8500.0000", descriptionRaw: "PAYSTREAM PAYROLL NET PAY", journalEntryId: "je_payroll_2026-08" }),
  ];
  ds.payrollRuns = ["2026-06-28", "2026-07-28", "2026-08-28"].map((d) => ({
    id: `run_${d}`,
    periodStart: `${d.slice(0, 8)}01`,
    periodEnd: d,
    payDate: d,
    currency: "USD",
    status: "PAID" as const,
    lines: [],
    totals: { gross: "11000.0000", employeeTaxes: "2400.0000", otherDeductions: "0.0000", netPay: "8500.0000", employerTaxes: "900.0000", totalEmployerCost: "11900.0000" },
    netPayTransactionIds: d === "2026-08-28" ? ["tx_payroll_aug"] : [],
  }));
  ds.payrollLiabilities = [
    { id: "pl_fed_aug", payrollRunId: "run_2026-08-28", kind: "FEDERAL_WITHHOLDING_AND_FICA", amount: "2400.0000", currency: "USD", accruedDate: "2026-08-28", dueDate: "2026-09-15", status: "ACCRUED", glAccountId: A("2200") },
    { id: "pl_state_aug", payrollRunId: "run_2026-08-28", kind: "STATE_WITHHOLDING_AND_SDI", amount: "900.0000", currency: "USD", accruedDate: "2026-08-28", dueDate: null, status: "ACCRUED", glAccountId: A("2210") },
  ];
  ds.documents = [
    { id: "doc_receipt_gh", kind: "RECEIPT", title: "GitHub receipt August", date: "2026-08-05", vendorId: "vend_github", amount: "100.0000", currency: "USD", linkedTransactionIds: [], linkedJournalEntryIds: [], storagePath: "synthetic://doc", mimeType: "application/pdf", classificationConfidence: 0.9, retention: { policyKey: "document_retention", retainUntil: null }, isSynthetic: true, tags: [], uploadedAt: "2026-08-05T12:00:00Z" },
  ];
  return ds;
}

export interface FixtureRuntime {
  rt: LabRuntime;
  ds: CompanyDataset;
  ctx: (agent?: AgentName, actor?: Actor) => ToolContext;
}

export async function makeFixtureRuntime(dataset: CompanyDataset = buildFixtureDataset()): Promise<FixtureRuntime> {
  const store = new MemoryStore(dataset);
  const rt = await createLabRuntime({ store, asOfDate: AS_OF, skipRetrieval: true });
  return { rt, ds: rt.dataset, ctx: (agent = "cfo_orchestrator", actor = OWNER) => toolContextFor(rt, agent, actor, AS_OF) };
}

/** JSON snapshot of the dataset without the append-only governance collections. */
export function snapshotDataset(ds: CompanyDataset): string {
  const { auditEvents, agentActions, approvals, calculations, taxWorkpapers, ...rest } = ds;
  void auditEvents;
  void agentActions;
  void approvals;
  void calculations;
  void taxWorkpapers;
  return JSON.stringify(rest);
}
