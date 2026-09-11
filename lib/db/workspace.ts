/**
 * Workspaces.
 *
 *  - `lab` (default): the synthetic Phase One training company, regenerated on demand.
 *  - `company`: the owners' REAL company. Starts EMPTY — no bank, card, payroll or accounting
 *    connection exists; the books contain only what the owners enter or import. Every fact
 *    comes from the Finance Bible (`buildFinanceBible`) with its unknowns left explicit.
 *
 * Selected with `TAU_WORKSPACE=lab|company`. The two workspaces never share a snapshot.
 */
import { resolve } from "node:path";
import { buildChartOfAccounts, accountIdForCode, ACCT } from "@/lib/accounting/chart-of-accounts";
import { hasPostedEffect } from "@/lib/accounting/statements";
import { toISODate } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { emptyDataset, type CompanyDataset, type CompanyProfile, type ConfigField, type Customer, type ISODate, type Worker } from "@/lib/core/types";
import { buildFinanceBible, getField } from "@/lib/knowledge/finance-bible";
import { incompleteInternationalReview } from "@/lib/knowledge/international-review";

export type Workspace = "lab" | "company";

export const COMPANY_ID = "company";
export const COMPANY_DISPLAY_NAME = "Your Company (name unconfirmed)";
export const COMPANY_SNAPSHOT_PATH = resolve(process.cwd(), ".tau", "company-snapshot.json");
export const CHART_TEMPLATE_STATUS_KEY = "chart_of_accounts.template_status";

/** `TAU_WORKSPACE`, defaulting to the synthetic lab. Anything other than "company" is the lab. */
export function currentWorkspace(): Workspace {
  return (process.env.TAU_WORKSPACE ?? "lab").trim().toLowerCase() === "company" ? "company" : "lab";
}

export function isCompanyWorkspace(): boolean {
  return currentWorkspace() === "company";
}

/**
 * Whether the ledger holds any posted activity. When false, cash and every balance-sheet figure
 * is UNKNOWN — there is no bank data — and must never be presented as 0.00. (A P&L over zero
 * entries may legitimately read 0.00; a cash balance may not.)
 */
export function hasBookData(dataset: CompanyDataset): boolean {
  return dataset.journalEntries.some(hasPostedEffect);
}

/** Label used everywhere a balance is unknown because no bank data exists. */
export const CASH_UNKNOWN_LABEL = "UNKNOWN — no bank data";

const REAL_AT = "2026-09-09T00:00:00.000Z";

function profileField<T>(name: string, label: string, value: T | null, status: ConfigField["status"], note?: string, requiredConfirmer?: ConfigField["requiredConfirmer"]): ConfigField<T> {
  return { key: `entity_profile.${name}`, section: "Entity profile", label, value, status, note, requiredConfirmer, updatedAt: REAL_AT, updatedBy: "SYSTEM_PHASE_TWO", synthetic: false };
}

export function buildCompanyProfile(asOfDate: ISODate): CompanyProfile {
  const bible = buildFinanceBible();
  const conf = <T>(key: string) => getField<T>(bible, key)?.value ?? null;
  return {
    id: COMPANY_ID,
    displayName: COMPANY_DISPLAY_NAME,
    isSynthetic: false,
    entityType: profileField("entity_type", "Legal entity type", conf<string>("entity_profile.entity_type") ?? "LLC", "CONFIRMED", "Limited liability company formed in California."),
    taxElection: profileField("tax_election", "Federal tax election", conf<string>("entity_profile.tax_election") ?? "S_CORPORATION", "CONFIRMED", "The LLC elected to be taxed as an S corporation."),
    state: profileField("state", "State of formation / primary operations", conf<string>("entity_profile.state") ?? "CA", "CONFIRMED"),
    fiscalYearEnd: profileField<string>("fiscal_year", "Fiscal year end", null, "UNCONFIRMED", "Must be confirmed from the S election and prior returns — not assumed.", "CPA"),
    accountingMethod: profileField<"CASH" | "ACCRUAL">("accounting_method", "Accounting method (CASH / ACCRUAL)", null, "UNCONFIRMED", "Book and tax methods may differ; confirm both from prior returns and CPA.", "CPA"),
    functionalCurrency: "USD",
    asOfDate,
  };
}

const wid = (key: string) => deterministicId("wrk", COMPANY_ID, key);

/** The five known workers, with placeholders only — nothing here is a confirmed personnel fact. */
export function buildCompanyWorkers(startDate: ISODate): Worker[] {
  const unknownComp = (note: string): Worker["compensation"] => ({ type: "CONTRACT", amount: "", currency: "USD", period: "MONTHLY", basis: "UNKNOWN", status: "UNCONFIRMED", note });
  const usBase = { country: "US", workerType: "EMPLOYEE" as const, classificationStatus: "CONFIRMED" as const, startDate, payMethod: "UNKNOWN" as const, documentIds: [] as string[], isSynthetic: false, roleTitle: "UNCONFIRMED" };
  const owner: Worker = {
    ...usBase,
    id: wid("owner"),
    displayName: "Owner",
    compensation: { type: "SALARY", amount: "3000.0000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED", note: "PROPOSED working assumption from the finance bible (employees.owner_salary_gross_monthly). Reasonable compensation is a CPA judgment." },
    isOwner: true,
    relatedParty: true,
    relatedPartyNote: "Sole shareholder and officer.",
  };
  const fiancee: Worker = {
    ...usBase,
    id: wid("finance_operator"),
    displayName: "Finance Operator (fiancée)",
    compensation: { type: "SALARY", amount: "3000.0000", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "UNCONFIRMED", note: "Unconfirmed figure from the finance bible (employees.fiancee_compensation_gross_monthly). Related party: disclosed to the CPA." },
    isOwner: false,
    relatedParty: true,
    relatedPartyNote: "Owner's fiancée — related-party compensation; flagged and disclosed to the CPA.",
  };
  const usEmployee: Worker = {
    ...usBase,
    id: wid("us_employee_1"),
    displayName: "US employee 1",
    compensation: unknownComp("Per-worker compensation is UNKNOWN (employees.per_worker_compensation); the ~$8,000/month allocation has no confirmed basis."),
    isOwner: false,
    relatedParty: false,
  };
  const cn = ["china_worker_1", "china_worker_2"].map<Worker>((key, i) => ({
    id: wid(key),
    displayName: `China-based worker ${i + 1}`,
    roleTitle: "UNCONFIRMED",
    country: "CN",
    workerType: "UNRESOLVED",
    classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW",
    compensation: unknownComp("Compensation, currency and payment method for China-based workers are UNKNOWN (international_workforce.*)."),
    startDate,
    isOwner: false,
    relatedParty: false,
    payMethod: "UNKNOWN",
    documentIds: [],
    internationalReview: incompleteInternationalReview(key, { synthetic: false, reviewer: "ATTORNEY" }),
    isSynthetic: false,
  }));
  return [owner, fiancee, usEmployee, ...cn];
}

export function buildCompanyCustomers(): Customer[] {
  return [
    {
      id: deterministicId("cust", COMPANY_ID, "primary"),
      name: "Primary services customer (entity unconfirmed)",
      // Payment terms are UNKNOWN (customers.payment_terms). 0 is a placeholder required by the
      // type, not a confirmed "due on receipt" term; nothing computes from it until confirmed.
      paymentTermsDays: 0,
      country: "US",
      relatedParty: true,
      relatedPartyNote: "The payer is associated with the CEO's father. All inflows carry the RELATED_PARTY flag and are disclosed to the CPA; treatment requires professional review (revenue_model.related_party_payer).",
      active: true,
    },
  ];
}

/** Extra config field recording that the chart of accounts is a PROPOSED template, not a confirmed fact. */
export function chartTemplateField(): ConfigField<string> {
  return {
    key: CHART_TEMPLATE_STATUS_KEY,
    section: "Chart of accounts",
    label: "Chart of accounts template status",
    value: "PROPOSED_TEMPLATE",
    status: "UNCONFIRMED",
    note: "PROPOSED: the chart loaded into this workspace is the lib/accounting/chart-of-accounts.ts template. The CPA must confirm or adapt it (chart_of_accounts.confirmed_chart).",
    requiredConfirmer: "CPA",
    updatedAt: REAL_AT,
    updatedBy: "SYSTEM_PHASE_TWO",
    synthetic: false,
  };
}

export interface CompanyWorkspaceOptions {
  /** Defaults to today. */
  asOfDate?: ISODate;
}

/**
 * The real company's starting dataset: profile + proposed chart + the finance bible + the five
 * known workers + the one (related-party) customer. No periods, no entries, no transactions,
 * no bank accounts, no cards, no payroll, no invoices — nothing is fabricated.
 */
export function buildCompanyWorkspace(opts: CompanyWorkspaceOptions = {}): CompanyDataset {
  const asOfDate = opts.asOfDate ?? toISODate(new Date());
  const ds = emptyDataset(buildCompanyProfile(asOfDate));
  ds.accounts = buildChartOfAccounts();
  ds.configFields = [...buildFinanceBible(), chartTemplateField()];
  ds.workers = buildCompanyWorkers(asOfDate);
  ds.customers = buildCompanyCustomers();
  return ds;
}

/** GL accounts a manually added bank account / card may map to (cash accounts / credit-card liabilities). */
export function eligibleGlAccountsFor(dataset: CompanyDataset, kind: "BANK" | "CARD") {
  const subtype = kind === "BANK" ? "CASH" : "CREDIT_CARD";
  return dataset.accounts.filter((a) => a.isActive && a.subtype === subtype);
}

export function defaultGlAccountIdFor(kind: "BANK" | "CARD", accountType?: string): string {
  if (kind === "CARD") return accountIdForCode(ACCT.CREDIT_CARD);
  return accountIdForCode(accountType === "SAVINGS" || accountType === "MONEY_MARKET" ? ACCT.SAVINGS : ACCT.CHECKING);
}
