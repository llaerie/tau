/**
 * Company Finance Bible — the single structured record of what is KNOWN, UNKNOWN,
 * and PENDING PROFESSIONAL REVIEW about the real company.
 *
 * Rules (see docs/BUILD_BRIEF.md #4):
 *  - Unknown facts are `value: null` with status UNCONFIRMED. Never zero, never a guess.
 *  - Proposed working assumptions carry a value but keep status UNCONFIRMED or
 *    PROFESSIONAL_REVIEW_REQUIRED and a note beginning with "PROPOSED:".
 *  - Nothing in this file is synthetic. The synthetic lab company lives in
 *    `synthetic-profile.ts`.
 *  - Secrets (EIN, account numbers) are NEVER stored here — only vault reference ids.
 */
import type { Actor, ConfigField, FieldStatus, ISODateTime, Role } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";

// ---------------------------------------------------------------------------
// Sections (exactly 30, in canonical order)
// ---------------------------------------------------------------------------

export const BIBLE_SECTIONS = [
  "Entity profile",
  "Ownership",
  "Revenue model",
  "Customers",
  "Employees",
  "Contractors",
  "International workforce",
  "Bank accounts",
  "Cards",
  "Payroll provider",
  "Accounting system",
  "CPA",
  "Insurance",
  "Chart of accounts",
  "Recurring revenue",
  "Recurring expenses",
  "Accounting policies",
  "Expense policy",
  "Reimbursement policy",
  "Approval matrix",
  "Tax calendar",
  "Payroll calendar",
  "Month-end close checklist",
  "Year-end checklist",
  "Document retention",
  "Personal/business separation rules",
  "Materiality thresholds",
  "Cash reserve policy",
  "Budget assumptions",
  "Forecast assumptions",
] as const;

export type BibleSection = (typeof BIBLE_SECTIONS)[number];

/** Section slug used as the key prefix: "Entity profile" -> "entity_profile". */
export function sectionSlug(section: BibleSection): string {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const SLUG_TO_SECTION: Record<string, BibleSection> = Object.fromEntries(
  BIBLE_SECTIONS.map((s) => [sectionSlug(s), s]),
) as Record<string, BibleSection>;

/** Resolve the section of a bible key ("entity_profile.legal_name" -> "Entity profile"). */
export function sectionOf(key: string): BibleSection | undefined {
  const prefix = key.split(".")[0];
  return SLUG_TO_SECTION[prefix];
}

// ---------------------------------------------------------------------------
// Field construction helpers
// ---------------------------------------------------------------------------

interface FieldSpec<T = unknown> {
  section: BibleSection;
  name: string;
  label: string;
  value: T | null;
  status: FieldStatus;
  note?: string;
  requiredConfirmer?: Role;
}

const BIBLE_UPDATED_AT: ISODateTime = "2026-09-09T00:00:00.000Z";

function field<T>(spec: FieldSpec<T>): ConfigField<T> {
  return {
    key: `${sectionSlug(spec.section)}.${spec.name}`,
    section: spec.section,
    label: spec.label,
    value: spec.value,
    status: spec.status,
    note: spec.note,
    requiredConfirmer: spec.requiredConfirmer,
    updatedAt: BIBLE_UPDATED_AT,
    updatedBy: "SYSTEM_PHASE_ONE",
    synthetic: false,
  };
}

const confirmed = <T>(section: BibleSection, name: string, label: string, value: T, note?: string): ConfigField<T> =>
  field({ section, name, label, value, status: "CONFIRMED", note });

const unknown = (section: BibleSection, name: string, label: string, whoConfirms: Role, note?: string): ConfigField =>
  field({ section, name, label, value: null, status: "UNCONFIRMED", note, requiredConfirmer: whoConfirms });

const proposed = <T>(section: BibleSection, name: string, label: string, value: T, whoConfirms: Role, note: string): ConfigField<T> =>
  field({ section, name, label, value, status: "UNCONFIRMED", note: `PROPOSED: ${note}`, requiredConfirmer: whoConfirms });

const professional = <T>(section: BibleSection, name: string, label: string, value: T | null, whoConfirms: Role, note: string): ConfigField<T> =>
  field({ section, name, label, value, status: "PROFESSIONAL_REVIEW_REQUIRED", note, requiredConfirmer: whoConfirms });

// ---------------------------------------------------------------------------
// The bible
// ---------------------------------------------------------------------------

export const MONTH_END_CLOSE_STEPS = [
  "Import and categorize all bank and card transactions",
  "Reconcile every bank and card account to its statement",
  "Match customer payments to invoices; review AR aging",
  "Record vendor bills and match payments; review AP aging",
  "Reconcile payroll runs to bank debits and accrue payroll liabilities",
  "Amortize prepaid expenses and record depreciation",
  "Review related-party transactions and flag for CPA disclosure",
  "Clear the suspense account to zero",
  "Review missing-receipt and missing-document alerts",
  "Produce income statement, balance sheet, cash flow; run integrity checks",
  "Soft-close, owner review, then lock the period with approval",
] as const;

export const YEAR_END_STEPS = [
  "Complete all twelve month-end closes and lock periods",
  "Assemble the tax document checklist (statements, payroll reports, 1099s, fixed-asset invoices)",
  "Confirm information returns for contractors with the CPA (which forms apply is a CPA decision)",
  "Review owner compensation vs. distributions with the CPA (reasonable compensation is professional judgment)",
  "Compile shareholder basis information for the CPA",
  "Prepare the CPA package with FACT / CALCULATION / ASSUMPTION / PROFESSIONAL JUDGMENT separation",
  "Confirm CA Statement of Information and franchise tax status with the CPA",
  "Archive documents under the retention policy",
] as const;

/** Build the real-company Finance Bible. Nothing here is synthetic. */
export function buildFinanceBible(): ConfigField[] {
  const F: ConfigField[] = [
    // 1. Entity profile
    confirmed("Entity profile", "entity_type", "Legal entity type", "LLC", "Limited liability company formed in California."),
    confirmed("Entity profile", "tax_election", "Federal tax election", "S_CORPORATION", "The LLC elected to be taxed as an S corporation."),
    confirmed("Entity profile", "state", "State of formation / primary operations", "CA"),
    confirmed("Entity profile", "industry", "Line of business", "AI-related services"),
    unknown("Entity profile", "legal_name", "Legal company name", "OWNER"),
    unknown(
      "Entity profile",
      "ein_vault_reference",
      "EIN storage reference (secrets vault id)",
      "OWNER",
      "Design: the dataset stores ONLY a reference id to a secrets vault entry. The EIN itself is never persisted in the dataset, logs, retrieval index or exports.",
    ),
    unknown("Entity profile", "business_address", "Business address", "OWNER"),
    unknown("Entity profile", "fiscal_year", "Fiscal year end", "CPA", "S corporations commonly use a calendar year, but this must be confirmed from the election and prior returns — not assumed."),
    unknown("Entity profile", "formation_date", "Formation date", "OWNER"),
    unknown("Entity profile", "s_election_effective_date", "S election effective date", "CPA"),

    // 2. Ownership
    confirmed("Ownership", "owner_count", "Number of owners", 1),
    confirmed("Ownership", "father_owns_llc", "Does the CEO's father own any part of the LLC?", false, "Confirmed: the father does not own the LLC. He is associated with the company's payer (see Revenue model)."),
    unknown("Ownership", "owner_basis", "Owner (shareholder) basis information", "CPA", "Stock and debt basis history is required for distributions and loss limitations; only the CPA / prior returns can establish it."),
    unknown("Ownership", "capital_contributions_history", "Capital contribution history", "OWNER"),

    // 3. Revenue model
    confirmed("Revenue model", "model", "Revenue model", "SERVICES", "Fees for AI-related services."),
    confirmed(
      "Revenue model",
      "monthly_inflow_approx",
      "Approximate monthly inflow for services (USD)",
      "30000.00",
      "Owner-reported approximation. Ledger amounts must come from bank data, never from this figure.",
    ),
    confirmed("Revenue model", "deposit_destination", "Where service payments arrive", "COMPANY_BANK_ACCOUNT", "Money arrives directly in the company bank account."),
    professional(
      "Revenue model",
      "related_party_payer",
      "Payer is a related party",
      true,
      "CPA",
      "The payer is associated with the CEO's father. All inflows carry the RELATED_PARTY flag and are disclosed to the CPA; treatment requires professional review.",
    ),

    // 4. Customers
    unknown("Customers", "primary_customer_entity", "Legal entity paying for services", "OWNER"),
    unknown("Customers", "payment_terms", "Payment terms", "OWNER"),
    unknown("Customers", "formal_service_agreement", "Formal service agreement exists?", "OWNER", "A written agreement matters for revenue recognition, related-party documentation and CPA disclosure."),
    unknown("Customers", "invoicing_process", "Invoicing process (who issues, when, format)", "OWNER"),

    // 5. Employees
    confirmed("Employees", "us_worker_count", "US-based workers", 3),
    confirmed(
      "Employees",
      "total_monthly_allocation_approx",
      "Approximate total monthly employee allocation (USD)",
      "8000.00",
      "Owner-reported. The BASIS of this figure (gross / net / contractor fee / employer cost) is UNKNOWN — see employees.allocation_basis.",
    ),
    unknown("Employees", "allocation_basis", "Basis of the ~$8,000/month allocation", "OWNER", "One of GROSS, NET, CONTRACTOR_FEE, EMPLOYER_COST. Payroll monitoring cannot run until this is known."),
    professional(
      "Employees",
      "owner_salary_gross_monthly",
      "Owner salary (gross, monthly, USD)",
      "3000.00",
      "CPA",
      "PROPOSED: tentative working assumption only. Reasonable compensation for an S corporation shareholder-employee is a professional judgment requiring CPA review before any payroll change.",
    ),
    proposed(
      "Employees",
      "fiancee_compensation_gross_monthly",
      "Owner's fiancée compensation for legitimate work (gross, monthly, USD)",
      "3000.00",
      "OWNER",
      "Configurable, unconfirmed assumption. Related party: flagged and disclosed to CPA.",
    ),
    unknown("Employees", "per_worker_compensation", "Compensation per worker", "OWNER"),
    unknown("Employees", "pay_frequency", "Pay frequency", "OWNER"),

    // 6. Contractors
    unknown("Contractors", "domestic_contractors", "Domestic (US) contractors and agreements", "OWNER"),
    unknown("Contractors", "tax_documentation_status", "Tax documentation on file for contractors", "OWNER", "Which form applies per worker is not assumed; confirm with CPA."),

    // 7. International workforce
    confirmed("International workforce", "china_worker_count", "China-based workers", 2),
    professional(
      "International workforce",
      "china_worker_classification",
      "Classification of China-based workers",
      null,
      "CPA",
      "No classification (employee vs. contractor, and the applicable cross-border withholding / documentation) may be made without professional review (CPA and/or attorney).",
    ),
    unknown("International workforce", "china_payment_method", "How China-based workers are paid", "OWNER"),
    unknown("International workforce", "china_payment_currency", "Currency of payments to China-based workers", "OWNER"),

    // 8. Bank accounts
    unknown("Bank accounts", "accounts", "Business bank accounts (institution, type, last4, vault ref)", "OWNER", "Store only institution, type, last4 and a vault reference — never full account numbers."),
    unknown("Bank accounts", "signatories", "Authorized signatories", "OWNER"),

    // 9. Cards
    unknown("Cards", "cards", "Business cards (issuer, last4, holder)", "OWNER"),
    unknown("Cards", "personal_card_used_for_business", "Is any personal card used for business spend?", "OWNER", "Drives the personal/business separation controls."),

    // 10. Payroll provider
    unknown("Payroll provider", "provider", "Payroll software / provider", "OWNER"),
    unknown("Payroll provider", "provider_handles_filings", "Does the provider file 941/940/DE 9 and deposit taxes?", "PAYROLL_PROFESSIONAL"),

    // 11. Accounting system
    confirmed("Accounting system", "software", "Accounting software in use", "NONE", "No accounting software is currently used."),
    unknown("Accounting system", "books_maintained_by", "Who currently maintains the books", "OWNER"),

    // 12. CPA
    confirmed("CPA", "cpa_exists", "A CPA is engaged", true),
    unknown("CPA", "identity", "CPA identity and contact", "OWNER"),
    professional("CPA", "responsibilities", "CPA responsibilities (returns, payroll filings, bookkeeping, advisory)", null, "CPA", "Scope of the CPA engagement is unknown; must be confirmed with the CPA before the system routes work to them."),

    // 13. Insurance
    unknown("Insurance", "business_insurance", "Business insurance policies (GL, E&O, workers' comp)", "OWNER"),

    // 14. Chart of accounts
    unknown("Chart of accounts", "confirmed_chart", "Confirmed chart of accounts", "CPA", "The lab uses lib/accounting/chart-of-accounts.ts as a PROPOSED template; the CPA must confirm or adapt it."),

    // 15. Recurring revenue
    confirmed("Recurring revenue", "primary_stream", "Primary recurring revenue stream", "Monthly services fee (~$30,000, related-party payer)", "Approximation; see Revenue model."),
    unknown("Recurring revenue", "contract_term", "Contract term / renewal", "OWNER"),

    // 16. Recurring expenses
    unknown("Recurring expenses", "known_recurring", "Known recurring expenses (software, hosting, rent, insurance)", "OWNER"),
    unknown("Recurring expenses", "workforce_cost_monthly", "Monthly workforce cost (by basis)", "OWNER", "Depends on employees.allocation_basis."),

    // 17. Accounting policies
    unknown("Accounting policies", "accounting_method", "Accounting method (CASH / ACCRUAL)", "CPA", "Book and tax methods may differ; confirm both from prior returns and CPA."),
    unknown("Accounting policies", "revenue_recognition", "Revenue recognition policy", "CPA"),
    unknown("Accounting policies", "capitalization_threshold", "Fixed asset capitalization threshold", "CPA"),
    unknown("Accounting policies", "opening_balances", "Opening balances as of system start", "CPA"),
    unknown("Accounting policies", "fixed_assets", "Existing fixed assets register", "OWNER"),
    unknown("Accounting policies", "loans", "Loans (to/from company, including shareholder loans)", "OWNER"),

    // 18. Expense policy
    proposed("Expense policy", "receipt_required_above", "Receipt required for expenses above (USD)", "75.00", "OWNER", "Default working threshold; configurable; unconfirmed."),
    confirmed("Expense policy", "meals_require_purpose_and_attendees", "Meals require business purpose and attendees", true, "System control: meals are never auto-deductible."),

    // 19. Reimbursement policy
    unknown("Reimbursement policy", "rules", "Reimbursement rules (who, what, documentation, timing)", "OWNER"),

    // 20. Approval matrix
    confirmed("Approval matrix", "structure", "Approval structure", "RISK_LEVELS_GREEN_YELLOW_RED", "System control: GREEN auto-executable, YELLOW owner approval, RED owner + professional approval; money movement always blocked in Phase One."),
    unknown("Approval matrix", "thresholds", "Approval dollar thresholds", "OWNER"),

    // 21. Tax calendar
    unknown("Tax calendar", "obligations_confirmed", "Confirmed tax obligations and due dates", "CPA", "Due dates come from retrieved authoritative sources + CPA confirmation, never from memory."),
    unknown("Tax calendar", "tax_payment_history", "Tax payment history (federal, CA)", "CPA"),
    unknown("Tax calendar", "prior_tax_returns", "Prior tax returns on file", "CPA"),

    // 22. Payroll calendar
    unknown("Payroll calendar", "pay_schedule", "Pay schedule and pay dates", "OWNER"),
    unknown("Payroll calendar", "deposit_schedule", "Payroll tax deposit schedule", "PAYROLL_PROFESSIONAL"),

    // 23. Month-end close checklist
    confirmed("Month-end close checklist", "steps", "Month-end close steps", [...MONTH_END_CLOSE_STEPS], "System default procedure."),

    // 24. Year-end checklist
    confirmed("Year-end checklist", "steps", "Year-end steps", [...YEAR_END_STEPS], "System default procedure."),

    // 25. Document retention
    unknown("Document retention", "periods", "Retention periods per document kind", "CPA", "Defaults exist as UNCONFIRMED policy parameters; never asserted as law."),

    // 26. Personal/business separation rules
    confirmed("Personal/business separation rules", "household_finances_separate_system", "Household/personal finances are a separate system", true, "System control: household data is never accessible to the business system."),
    confirmed("Personal/business separation rules", "personal_expense_handling", "Personal expenses found in business accounts", "FLAG_AND_ROUTE_TO_REVIEW", "System control: flagged POSSIBLE_PERSONAL, never auto-deducted."),

    // 27. Materiality thresholds
    unknown("Materiality thresholds", "transaction_review_amount", "Single transaction review threshold (USD)", "OWNER"),
    unknown("Materiality thresholds", "variance_ratio", "Material budget variance ratio", "OWNER"),

    // 28. Cash reserve policy
    unknown("Cash reserve policy", "minimum_reserve", "Minimum cash reserve (USD or months of expenses)", "OWNER"),

    // 29. Budget assumptions
    unknown("Budget assumptions", "annual_budget", "Approved annual budget", "OWNER"),

    // 30. Forecast assumptions
    proposed("Forecast assumptions", "revenue_run_rate_monthly", "Revenue run-rate driver (USD/month)", "30000.00", "OWNER", "Derived from the owner-reported approximation; must be replaced by bank-derived actuals."),
    unknown("Forecast assumptions", "growth_rate", "Revenue growth assumption", "OWNER"),
  ];
  return F;
}

// ---------------------------------------------------------------------------
// Summary & queries
// ---------------------------------------------------------------------------

export type BibleSummary = Record<FieldStatus, number> & { total: number; bySection: Record<string, Record<FieldStatus, number>> };

const zeroCounts = (): Record<FieldStatus, number> => ({ CONFIRMED: 0, UNCONFIRMED: 0, PROFESSIONAL_REVIEW_REQUIRED: 0, SUPERSEDED: 0 });

export function bibleSummary(fields: ConfigField[]): BibleSummary {
  const counts = zeroCounts();
  const bySection: Record<string, Record<FieldStatus, number>> = {};
  for (const f of fields) {
    counts[f.status]++;
    bySection[f.section] ??= zeroCounts();
    bySection[f.section][f.status]++;
  }
  return { ...counts, total: fields.length, bySection };
}

/** Fields that are current (not SUPERSEDED). */
export function currentFields(fields: ConfigField[]): ConfigField[] {
  return fields.filter((f) => f.status !== "SUPERSEDED");
}

export function getField<T = unknown>(fields: ConfigField[], key: string): ConfigField<T> | undefined {
  return currentFields(fields).find((f) => f.key === key) as ConfigField<T> | undefined;
}

/**
 * Overlay persisted (non-synthetic, non-superseded) answers on top of the static bible, keyed by
 * field key. Synthetic lab fields never overlay the real bible.
 */
export function mergeBibleFields(bible: ConfigField[], persisted: ConfigField[]): ConfigField[] {
  const byKey = new Map<string, ConfigField>();
  for (const f of bible) if (f.status !== "SUPERSEDED") byKey.set(f.key, f);
  for (const f of persisted) if (f.status !== "SUPERSEDED" && !f.synthetic) byKey.set(f.key, f);
  return Array.from(byKey.values());
}

/** Value of a field only if CONFIRMED; otherwise null (never a guess). */
export function confirmedValue<T = unknown>(fields: ConfigField[], key: string): T | null {
  const f = getField<T>(fields, key);
  return f && f.status === "CONFIRMED" ? f.value : null;
}

/** All versions of a key, oldest first (SUPERSEDED entries + the current one). */
export function historyOf(fields: ConfigField[], key: string): ConfigField[] {
  return fields.filter((f) => f.key === key).sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
}

export interface ConfigAnswerResult {
  /** New fields array: prior versions of the key are kept with status SUPERSEDED. */
  fields: ConfigField[];
  current: ConfigField;
  history: ConfigField[];
}

/**
 * Record an answer for a bible key. Pure: returns a new array; the previous current
 * version is marked SUPERSEDED and retained as history.
 */
export function applyConfigAnswer(
  fields: ConfigField[],
  key: string,
  value: unknown,
  actor: Actor,
  status: Exclude<FieldStatus, "SUPERSEDED"> = "CONFIRMED",
  opts?: { note?: string; sourceIds?: string[]; at?: ISODateTime },
): ConfigAnswerResult {
  const prev = getField(fields, key);
  const at = opts?.at ?? nowISO();
  if (!prev && !sectionOf(key)) throw new Error(`Unknown bible key and section: ${key}`);
  const section = prev?.section ?? sectionOf(key)!;
  if (status === "CONFIRMED" && value === null) throw new Error("A CONFIRMED answer cannot have a null value");
  const next: ConfigField = {
    key,
    section,
    label: prev?.label ?? key,
    value,
    status,
    note: opts?.note ?? (status === "CONFIRMED" ? undefined : prev?.note),
    requiredConfirmer: prev?.requiredConfirmer,
    updatedAt: at,
    updatedBy: `${actor.role}:${actor.id}`,
    sourceIds: opts?.sourceIds ?? prev?.sourceIds,
    synthetic: prev?.synthetic ?? false,
  };
  const out = fields.map((f) => (f.key === key && f.status !== "SUPERSEDED" ? { ...f, status: "SUPERSEDED" as const } : f));
  out.push(next);
  return { fields: out, current: next, history: historyOf(out, key) };
}

// ---------------------------------------------------------------------------
// Unknowns registry — "Complete the Finance Setup" checklist
// ---------------------------------------------------------------------------

export type CapabilityKey =
  | "transaction_categorization"
  | "bank_reconciliation"
  | "payroll_monitoring"
  | "tax_workpapers"
  | "tax_calendar"
  | "cpa_package"
  | "worker_classification"
  | "thirteen_week_cash"
  | "financial_statements"
  | "ar_management"
  | "ap_management"
  | "fixed_asset_depreciation"
  | "budget_variance"
  | "period_close"
  | "missing_document_alerts"
  | "related_party_disclosure"
  | "entity_compliance"
  | "risk_assessment"
  | "distribution_planning";

export interface UnknownItem {
  key: string;
  /** Bible field key this item resolves */
  fieldKey: string;
  label: string;
  section: BibleSection;
  status: FieldStatus;
  whyItMatters: string;
  whoCanAnswer: Role;
  blocksCapabilities: CapabilityKey[];
}

interface UnknownSpec {
  key: string;
  fieldKey: string;
  label: string;
  whyItMatters: string;
  whoCanAnswer: Role;
  blocksCapabilities: CapabilityKey[];
}

export const UNKNOWN_ITEM_SPECS: UnknownSpec[] = [
  { key: "legal_company_name", fieldKey: "entity_profile.legal_name", label: "Legal company name", whyItMatters: "Every statement, filing and CPA package must carry the exact legal name. Mismatches cause rejected filings and confused vendors.", whoCanAnswer: "OWNER", blocksCapabilities: ["cpa_package", "entity_compliance"] },
  { key: "ein_reference_architecture", fieldKey: "entity_profile.ein_vault_reference", label: "EIN storage / reference architecture", whyItMatters: "The EIN is a secret. The system stores only a vault reference id and never the EIN itself, so the reference must be provisioned before any document generation.", whoCanAnswer: "OWNER", blocksCapabilities: ["cpa_package", "entity_compliance"] },
  { key: "business_address", fieldKey: "entity_profile.business_address", label: "Business address", whyItMatters: "Determines local tax/registration exposure and appears on every invoice, filing and Statement of Information.", whoCanAnswer: "OWNER", blocksCapabilities: ["entity_compliance", "cpa_package"] },
  { key: "fiscal_year", fieldKey: "entity_profile.fiscal_year", label: "Fiscal year", whyItMatters: "The tax calendar, year-end close and every annual comparison depend on the fiscal year end. It must not be assumed.", whoCanAnswer: "CPA", blocksCapabilities: ["tax_calendar", "tax_workpapers", "period_close"] },
  { key: "accounting_method", fieldKey: "accounting_policies.accounting_method", label: "Accounting method (cash vs accrual)", whyItMatters: "Cash and accrual books produce different revenue, expense and AR/AP timing. The ledger cannot be interpreted correctly until the method is confirmed.", whoCanAnswer: "CPA", blocksCapabilities: ["financial_statements", "tax_workpapers", "budget_variance"] },
  { key: "cpa_identity", fieldKey: "cpa.identity", label: "CPA identity", whyItMatters: "Escalations, CPA packages and professional-guidance intake need a named professional to route to.", whoCanAnswer: "OWNER", blocksCapabilities: ["cpa_package"] },
  { key: "cpa_responsibilities", fieldKey: "cpa.responsibilities", label: "CPA responsibilities", whyItMatters: "Whether the CPA files payroll returns, prepares the 1120-S, or only advises decides which obligations the system must track itself.", whoCanAnswer: "CPA", blocksCapabilities: ["tax_calendar", "cpa_package", "payroll_monitoring"] },
  { key: "bank_accounts", fieldKey: "bank_accounts.accounts", label: "Bank accounts", whyItMatters: "Every reconciliation and cash forecast starts from the list of accounts. Without it there is no cash position.", whoCanAnswer: "OWNER", blocksCapabilities: ["bank_reconciliation", "transaction_categorization", "thirteen_week_cash", "financial_statements"] },
  { key: "cards", fieldKey: "cards.cards", label: "Cards", whyItMatters: "Card spend is where personal and business mixing most often happens. Unknown cards mean uncategorized liabilities.", whoCanAnswer: "OWNER", blocksCapabilities: ["transaction_categorization", "bank_reconciliation", "missing_document_alerts"] },
  { key: "payroll_provider", fieldKey: "payroll_provider.provider", label: "Payroll provider", whyItMatters: "Payroll reports, tax deposits and filings are produced by the provider; the system reconciles against them and must know who files what.", whoCanAnswer: "OWNER", blocksCapabilities: ["payroll_monitoring", "tax_calendar"] },
  { key: "employee_compensation", fieldKey: "employees.allocation_basis", label: "Employee compensation (incl. the ~$8,000/month basis question)", whyItMatters: "A figure without a basis (gross, net, contractor fee or employer cost) cannot be reconciled to payroll or forecast. The basis changes employer cost materially.", whoCanAnswer: "OWNER", blocksCapabilities: ["payroll_monitoring", "thirteen_week_cash", "budget_variance"] },
  { key: "china_worker_classification", fieldKey: "international_workforce.china_worker_classification", label: "China worker classification", whyItMatters: "Cross-border worker status drives withholding, documentation and possible foreign obligations. It is a professional decision, never an AI decision.", whoCanAnswer: "CPA", blocksCapabilities: ["worker_classification", "payroll_monitoring", "tax_workpapers"] },
  { key: "invoicing_process", fieldKey: "customers.invoicing_process", label: "Invoicing process", whyItMatters: "AR aging, revenue recognition and payment matching depend on when and how invoices are issued.", whoCanAnswer: "OWNER", blocksCapabilities: ["ar_management", "financial_statements"] },
  { key: "customer_entity", fieldKey: "customers.primary_customer_entity", label: "Customer entity", whyItMatters: "The paying entity must be identified for contracts, related-party disclosure and information-return decisions.", whoCanAnswer: "OWNER", blocksCapabilities: ["ar_management", "related_party_disclosure", "cpa_package"] },
  { key: "payment_terms", fieldKey: "customers.payment_terms", label: "Payment terms", whyItMatters: "Terms define when receivables are overdue and shape the 13-week cash forecast.", whoCanAnswer: "OWNER", blocksCapabilities: ["ar_management", "thirteen_week_cash"] },
  { key: "formal_service_agreement", fieldKey: "customers.formal_service_agreement", label: "Formal service agreement", whyItMatters: "A related-party revenue stream without a written agreement is a disclosure and substantiation risk the CPA must know about.", whoCanAnswer: "OWNER", blocksCapabilities: ["related_party_disclosure", "cpa_package"] },
  { key: "business_insurance", fieldKey: "insurance.business_insurance", label: "Business insurance", whyItMatters: "Insurance premiums are recurring prepaid expenses and workers' compensation coverage is tied to having employees.", whoCanAnswer: "OWNER", blocksCapabilities: ["budget_variance", "risk_assessment"] },
  { key: "tax_payment_history", fieldKey: "tax_calendar.tax_payment_history", label: "Tax payment history", whyItMatters: "Prior payments determine what is already satisfied and what is outstanding; the calendar is incomplete without them.", whoCanAnswer: "CPA", blocksCapabilities: ["tax_calendar", "tax_workpapers"] },
  { key: "prior_tax_returns", fieldKey: "tax_calendar.prior_tax_returns", label: "Prior tax returns", whyItMatters: "Prior returns establish the accounting method, fiscal year, basis, depreciation history and carryforwards.", whoCanAnswer: "CPA", blocksCapabilities: ["tax_workpapers", "cpa_package", "fixed_asset_depreciation"] },
  { key: "opening_balances", fieldKey: "accounting_policies.opening_balances", label: "Opening balances", whyItMatters: "The ledger cannot produce a balance sheet that ties to reality without confirmed opening balances.", whoCanAnswer: "CPA", blocksCapabilities: ["financial_statements", "bank_reconciliation", "period_close"] },
  { key: "fixed_assets", fieldKey: "accounting_policies.fixed_assets", label: "Fixed assets", whyItMatters: "Existing equipment must be on the register for depreciation and for the tax workpapers.", whoCanAnswer: "OWNER", blocksCapabilities: ["fixed_asset_depreciation", "tax_workpapers"] },
  { key: "loans", fieldKey: "accounting_policies.loans", label: "Loans", whyItMatters: "Loans to or from the shareholder affect basis, interest and the balance sheet, and are related-party items.", whoCanAnswer: "OWNER", blocksCapabilities: ["financial_statements", "related_party_disclosure", "distribution_planning"] },
  { key: "owner_basis_information", fieldKey: "ownership.owner_basis", label: "Owner basis information", whyItMatters: "Distributions beyond basis have tax consequences; the system cannot evaluate a distribution without basis data from the CPA.", whoCanAnswer: "CPA", blocksCapabilities: ["distribution_planning", "tax_workpapers"] },
  { key: "chart_of_accounts", fieldKey: "chart_of_accounts.confirmed_chart", label: "Chart of accounts", whyItMatters: "Categorization confidence depends on an agreed chart; the lab template is a proposal until the CPA confirms it.", whoCanAnswer: "CPA", blocksCapabilities: ["transaction_categorization", "financial_statements"] },
  { key: "reimbursement_rules", fieldKey: "reimbursement_policy.rules", label: "Reimbursement rules", whyItMatters: "Without rules the system cannot tell a legitimate reimbursement from a personal draw.", whoCanAnswer: "OWNER", blocksCapabilities: ["transaction_categorization", "ap_management"] },
  { key: "approval_thresholds", fieldKey: "approval_matrix.thresholds", label: "Approval thresholds", whyItMatters: "Dollar thresholds decide when a proposed action needs the owner or a professional; defaults are placeholders until confirmed.", whoCanAnswer: "OWNER", blocksCapabilities: ["risk_assessment", "ap_management"] },
];

/** The "Complete the Finance Setup" checklist: exactly the 26 setup items, with live status. */
export function unknownsRegistry(fields: ConfigField[]): UnknownItem[] {
  return UNKNOWN_ITEM_SPECS.map((spec) => {
    const f = getField(fields, spec.fieldKey);
    const section = f?.section ?? sectionOf(spec.fieldKey);
    if (!section) throw new Error(`Unknown item ${spec.key} references a key with no section: ${spec.fieldKey}`);
    return {
      key: spec.key,
      fieldKey: spec.fieldKey,
      label: spec.label,
      section: section as BibleSection,
      status: f?.status ?? "UNCONFIRMED",
      whyItMatters: spec.whyItMatters,
      whoCanAnswer: spec.whoCanAnswer,
      blocksCapabilities: spec.blocksCapabilities,
    };
  });
}

/** Capabilities currently blocked by unresolved setup items. */
export function blockedCapabilities(fields: ConfigField[]): Record<CapabilityKey, string[]> {
  const out = {} as Record<CapabilityKey, string[]>;
  for (const item of unknownsRegistry(fields)) {
    if (item.status === "CONFIRMED") continue;
    for (const c of item.blocksCapabilities) (out[c] ??= []).push(item.key);
  }
  return out;
}
