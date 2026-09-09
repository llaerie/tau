/**
 * Synthetic lab company profile — "Northlight AI Services LLC".
 *
 * Every field here is `synthetic: true`. These are fictional facts that let the
 * Phase One lab run end-to-end. They are kept in a separate file from the real
 * Finance Bible so the two can never be confused: `buildFinanceBible()` is the real
 * company (mostly unknown); `buildSyntheticProfile()` is the fictional company (fully known).
 */
import type { CompanyProfile, ConfigField, FieldStatus, Role } from "@/lib/core/types";
import { BIBLE_SECTIONS, sectionSlug, type BibleSection } from "./finance-bible";

export const SYNTHETIC_COMPANY_NAME = "Northlight AI Services LLC";
export const SYNTHETIC_COMPANY_ID = "company_synthetic_northlight";
const AT = "2026-01-01T00:00:00.000Z";

function syn<T>(section: BibleSection, name: string, label: string, value: T, status: FieldStatus = "CONFIRMED", note?: string, requiredConfirmer?: Role): ConfigField<T> {
  return {
    key: `${sectionSlug(section)}.${name}`,
    section,
    label,
    value,
    status,
    note: note ? `[SYNTHETIC] ${note}` : "[SYNTHETIC] Fictional lab data.",
    requiredConfirmer,
    updatedAt: AT,
    updatedBy: "SYNTHETIC_GENERATOR",
    synthetic: true,
  };
}

/** Config fields for the fictional lab company. All synthetic, all CONFIRMED unless noted. */
export function buildSyntheticProfile(): ConfigField[] {
  return [
    syn("Entity profile", "entity_type", "Legal entity type", "LLC"),
    syn("Entity profile", "tax_election", "Federal tax election", "S_CORPORATION"),
    syn("Entity profile", "state", "State", "CA"),
    syn("Entity profile", "industry", "Line of business", "AI-related services"),
    syn("Entity profile", "legal_name", "Legal company name", SYNTHETIC_COMPANY_NAME),
    syn("Entity profile", "ein_vault_reference", "EIN vault reference", "vault://synthetic/northlight/ein", "CONFIRMED", "Reference only; no EIN value exists for the synthetic company."),
    syn("Entity profile", "business_address", "Business address", "100 Fictional Way, Suite 200, San Jose, CA 95110"),
    syn("Entity profile", "fiscal_year", "Fiscal year end", "12-31"),
    syn("Entity profile", "formation_date", "Formation date", "2024-01-15"),
    syn("Ownership", "owner_count", "Number of owners", 1),
    syn("Ownership", "father_owns_llc", "Father owns LLC", false),
    syn("Ownership", "owner_basis", "Owner basis (opening)", "25000.00"),
    syn("Revenue model", "model", "Revenue model", "SERVICES"),
    syn("Revenue model", "monthly_inflow_approx", "Monthly services inflow (USD)", "30000.00"),
    syn("Revenue model", "deposit_destination", "Deposit destination", "COMPANY_BANK_ACCOUNT"),
    syn("Revenue model", "related_party_payer", "Related-party payer", true, "PROFESSIONAL_REVIEW_REQUIRED", "Mirrors the real scenario so related-party controls are exercised.", "CPA"),
    syn("Customers", "primary_customer_entity", "Primary customer", "Harborline Holdings LLC (related party)"),
    syn("Customers", "payment_terms", "Payment terms", "NET_15"),
    syn("Customers", "formal_service_agreement", "Formal service agreement", true),
    syn("Customers", "invoicing_process", "Invoicing process", "Monthly invoice issued on the 1st; paid by ACH"),
    syn("Employees", "us_worker_count", "US-based workers", 3),
    syn("Employees", "allocation_basis", "Workforce allocation basis", "GROSS"),
    syn("Employees", "owner_salary_gross_monthly", "Owner salary (gross monthly)", "3000.00", "PROFESSIONAL_REVIEW_REQUIRED", "Even in the lab, reasonable compensation is a professional judgment.", "CPA"),
    syn("Employees", "fiancee_compensation_gross_monthly", "Related-party employee salary (gross monthly)", "3000.00"),
    syn("Employees", "pay_frequency", "Pay frequency", "SEMI_MONTHLY"),
    syn("Contractors", "domestic_contractors", "Domestic contractors", "1 US contractor (design), W-9 on file"),
    syn("International workforce", "china_worker_count", "China-based workers", 2),
    syn("International workforce", "china_worker_classification", "China worker classification", null, "PROFESSIONAL_REVIEW_REQUIRED", "Deliberately unresolved so the lab exercises the escalation path.", "CPA"),
    syn("International workforce", "china_payment_method", "Payment method", "INTERNATIONAL_PLATFORM"),
    syn("International workforce", "china_payment_currency", "Payment currency", "USD"),
    syn("Bank accounts", "accounts", "Bank accounts", [{ institution: "Synthetic Bank", type: "CHECKING", last4: "1001" }, { institution: "Synthetic Bank", type: "SAVINGS", last4: "1002" }]),
    syn("Cards", "cards", "Cards", [{ issuer: "Synthetic Card Co", last4: "2001" }]),
    syn("Payroll provider", "provider", "Payroll provider", "SyntheticPayroll (simulated)"),
    syn("Payroll provider", "provider_handles_filings", "Provider files payroll returns", true),
    syn("Accounting system", "software", "Accounting software", "TAU_LAB_LEDGER"),
    syn("CPA", "cpa_exists", "CPA engaged", true),
    syn("CPA", "identity", "CPA identity", "Synthetic CPA Group (fictional)"),
    syn("CPA", "responsibilities", "CPA responsibilities", ["1120-S", "CA 100S", "annual advisory"]),
    syn("Insurance", "business_insurance", "Business insurance", ["General liability (annual, prepaid)"]),
    syn("Chart of accounts", "confirmed_chart", "Chart of accounts", "lib/accounting/chart-of-accounts.ts"),
    syn("Recurring revenue", "primary_stream", "Primary stream", "Monthly retainer 30000.00"),
    syn("Recurring expenses", "known_recurring", "Recurring expenses", ["cloud hosting", "AI API usage", "software subscriptions", "coworking"]),
    syn("Accounting policies", "accounting_method", "Accounting method", "ACCRUAL"),
    syn("Accounting policies", "capitalization_threshold", "Capitalization threshold", "2500.00"),
    syn("Accounting policies", "opening_balances", "Opening balances", "Provided by synthetic generator"),
    syn("Expense policy", "receipt_required_above", "Receipt required above (USD)", "75.00"),
    syn("Expense policy", "meals_require_purpose_and_attendees", "Meals need purpose + attendees", true),
    syn("Reimbursement policy", "rules", "Reimbursement rules", "Owner-approved, receipt required, paid via payroll provider"),
    syn("Approval matrix", "structure", "Approval structure", "RISK_LEVELS_GREEN_YELLOW_RED"),
    syn("Approval matrix", "thresholds", "Approval thresholds", { transactionReviewAmount: "1000.00", redAmount: "5000.00" }),
    syn("Tax calendar", "obligations_confirmed", "Obligations confirmed", false, "UNCONFIRMED", "Even synthetic obligations get due dates only from retrieved sources.", "CPA"),
    syn("Payroll calendar", "pay_schedule", "Pay schedule", "15th and last day of month"),
    syn("Month-end close checklist", "steps", "Steps", "SYSTEM_DEFAULT"),
    syn("Year-end checklist", "steps", "Steps", "SYSTEM_DEFAULT"),
    syn("Document retention", "periods", "Retention periods", "SYSTEM_DEFAULT_UNCONFIRMED"),
    syn("Personal/business separation rules", "household_finances_separate_system", "Household separate", true),
    syn("Materiality thresholds", "transaction_review_amount", "Transaction review amount", "1000.00"),
    syn("Materiality thresholds", "variance_ratio", "Variance ratio", 0.1),
    syn("Cash reserve policy", "minimum_reserve", "Minimum reserve", "3 months of operating expenses"),
    syn("Budget assumptions", "annual_budget", "Annual budget", "Generated by synthetic budget"),
    syn("Forecast assumptions", "revenue_run_rate_monthly", "Revenue run-rate", "30000.00"),
    syn("Forecast assumptions", "growth_rate", "Growth rate", 0.0),
  ];
}

/** `CompanyProfile` for the synthetic company (what `emptyDataset()` needs). */
export function syntheticCompanyProfile(asOfDate = "2026-06-30"): CompanyProfile {
  const f = Object.fromEntries(buildSyntheticProfile().map((x) => [x.key, x]));
  return {
    id: SYNTHETIC_COMPANY_ID,
    displayName: SYNTHETIC_COMPANY_NAME,
    isSynthetic: true,
    entityType: f["entity_profile.entity_type"] as ConfigField<string>,
    taxElection: f["entity_profile.tax_election"] as ConfigField<string>,
    state: f["entity_profile.state"] as ConfigField<string>,
    fiscalYearEnd: f["entity_profile.fiscal_year"] as ConfigField<string>,
    accountingMethod: f["accounting_policies.accounting_method"] as ConfigField<"CASH" | "ACCRUAL">,
    functionalCurrency: "USD",
    asOfDate,
  };
}

/** Guard: assert every field of a synthetic profile is labelled synthetic. */
export function assertAllSynthetic(fields: ConfigField[]): void {
  const bad = fields.filter((f) => f.synthetic !== true);
  if (bad.length) throw new Error(`Non-synthetic fields in synthetic profile: ${bad.map((b) => b.key).join(", ")}`);
}

export const SYNTHETIC_SECTIONS = BIBLE_SECTIONS;
