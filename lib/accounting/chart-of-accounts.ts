/**
 * Standard small-business S-corporation chart of accounts used by the lab.
 * Codes are stable identifiers referenced throughout the system (evals, synthetic data, agents).
 * The real company's chart of accounts is an UNCONFIRMED configuration item; this template
 * is the lab default and a proposal, not a confirmed fact.
 */
import type { Account, AccountSubtype, AccountType, CashFlowSection, NormalBalance } from "@/lib/core/types";

interface CoaTemplateRow {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  cashFlowSection?: CashFlowSection;
  restricted?: boolean;
  description?: string;
}

const normalFor = (t: AccountType): NormalBalance => (t === "ASSET" || t === "EXPENSE" ? "DEBIT" : "CREDIT");

export const COA_TEMPLATE: CoaTemplateRow[] = [
  // ---- Assets (1000)
  { code: "1000", name: "Operating Checking", type: "ASSET", subtype: "CASH", cashFlowSection: "CASH" },
  { code: "1010", name: "Business Savings / Reserve", type: "ASSET", subtype: "CASH", cashFlowSection: "CASH" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET", subtype: "ACCOUNTS_RECEIVABLE", cashFlowSection: "OPERATING" },
  { code: "1200", name: "Prepaid Expenses", type: "ASSET", subtype: "PREPAID", cashFlowSection: "OPERATING" },
  { code: "1250", name: "Employee Advances & Receivables", type: "ASSET", subtype: "OTHER_CURRENT_ASSET", cashFlowSection: "OPERATING" },
  { code: "1260", name: "Due from Shareholder", type: "ASSET", subtype: "OTHER_CURRENT_ASSET", cashFlowSection: "OPERATING", restricted: true },
  { code: "1500", name: "Computer Equipment", type: "ASSET", subtype: "FIXED_ASSET", cashFlowSection: "INVESTING" },
  { code: "1510", name: "Furniture & Fixtures", type: "ASSET", subtype: "FIXED_ASSET", cashFlowSection: "INVESTING" },
  { code: "1590", name: "Accumulated Depreciation", type: "ASSET", subtype: "ACCUMULATED_DEPRECIATION", cashFlowSection: "OPERATING" },
  { code: "1800", name: "Security Deposits", type: "ASSET", subtype: "OTHER_ASSET", cashFlowSection: "INVESTING" },
  // ---- Liabilities (2000)
  { code: "2000", name: "Accounts Payable", type: "LIABILITY", subtype: "ACCOUNTS_PAYABLE", cashFlowSection: "OPERATING" },
  { code: "2050", name: "Business Credit Card", type: "LIABILITY", subtype: "CREDIT_CARD", cashFlowSection: "OPERATING" },
  { code: "2100", name: "Accrued Expenses", type: "LIABILITY", subtype: "ACCRUED_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2150", name: "Accrued Payroll", type: "LIABILITY", subtype: "PAYROLL_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2200", name: "Federal Payroll Taxes Payable", type: "LIABILITY", subtype: "PAYROLL_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2210", name: "State Payroll Taxes Payable", type: "LIABILITY", subtype: "PAYROLL_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2220", name: "Federal Unemployment Tax Payable", type: "LIABILITY", subtype: "PAYROLL_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2230", name: "State Unemployment & ETT Payable", type: "LIABILITY", subtype: "PAYROLL_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2300", name: "Income Taxes Payable", type: "LIABILITY", subtype: "TAX_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2310", name: "CA Franchise / Entity Tax Payable", type: "LIABILITY", subtype: "TAX_LIABILITY", cashFlowSection: "OPERATING" },
  { code: "2400", name: "Deferred Revenue", type: "LIABILITY", subtype: "DEFERRED_REVENUE", cashFlowSection: "OPERATING" },
  { code: "2500", name: "Due to Shareholder", type: "LIABILITY", subtype: "OTHER_CURRENT_LIABILITY", cashFlowSection: "FINANCING", restricted: true },
  { code: "2700", name: "Loans Payable", type: "LIABILITY", subtype: "LONG_TERM_DEBT", cashFlowSection: "FINANCING" },
  // ---- Equity (3000)
  { code: "3000", name: "Shareholder Capital / Paid-in Capital", type: "EQUITY", subtype: "OWNER_EQUITY", cashFlowSection: "FINANCING", restricted: true },
  { code: "3100", name: "Shareholder Distributions", type: "EQUITY", subtype: "SHAREHOLDER_DISTRIBUTIONS", cashFlowSection: "FINANCING", restricted: true },
  { code: "3900", name: "Retained Earnings", type: "EQUITY", subtype: "RETAINED_EARNINGS", cashFlowSection: "FINANCING", restricted: true },
  // ---- Revenue (4000)
  { code: "4000", name: "Service Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4100", name: "Consulting Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4900", name: "Other Income", type: "REVENUE", subtype: "OTHER_INCOME" },
  { code: "4910", name: "Interest Income", type: "REVENUE", subtype: "OTHER_INCOME" },
  // ---- Cost of revenue (5000)
  { code: "5000", name: "Cloud & Compute (Cost of Revenue)", type: "EXPENSE", subtype: "COST_OF_REVENUE" },
  { code: "5100", name: "AI Model / API Usage (Cost of Revenue)", type: "EXPENSE", subtype: "COST_OF_REVENUE" },
  { code: "5200", name: "Subcontractors (Cost of Revenue)", type: "EXPENSE", subtype: "COST_OF_REVENUE" },
  // ---- Payroll (6000)
  { code: "6000", name: "Salaries & Wages", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6010", name: "Officer Compensation", type: "EXPENSE", subtype: "PAYROLL_EXPENSE", restricted: true },
  { code: "6050", name: "Contractor Payments (Domestic)", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6060", name: "International Worker Payments (Classification Pending)", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6100", name: "Employer Payroll Taxes", type: "EXPENSE", subtype: "PAYROLL_TAX_EXPENSE" },
  { code: "6150", name: "Employee Benefits", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6190", name: "Payroll Service Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  // ---- Operating expenses (7000)
  { code: "7000", name: "Software Subscriptions", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7010", name: "Cloud Hosting (Non-COGS)", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7100", name: "Rent & Coworking", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7150", name: "Utilities & Internet", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7200", name: "Professional Fees (Legal & Accounting)", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7250", name: "Insurance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7300", name: "Meals (Business)", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7310", name: "Travel", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7350", name: "Marketing & Advertising", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7400", name: "Office Supplies & Small Equipment", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7450", name: "Telephone & Communications", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7500", name: "Bank Fees & Merchant Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7550", name: "Education & Training", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7600", name: "Licenses, Permits & Filing Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7650", name: "Dues & Subscriptions (Non-Software)", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "7700", name: "Depreciation Expense", type: "EXPENSE", subtype: "DEPRECIATION_EXPENSE" },
  { code: "7800", name: "Interest Expense", type: "EXPENSE", subtype: "INTEREST_EXPENSE" },
  { code: "7900", name: "State Franchise / Entity Taxes", type: "EXPENSE", subtype: "TAX_EXPENSE" },
  { code: "7950", name: "Other Operating Expense", type: "EXPENSE", subtype: "OTHER_EXPENSE" },
  { code: "7990", name: "Non-Deductible / Personal Expense (Review)", type: "EXPENSE", subtype: "OTHER_EXPENSE", restricted: true, description: "Holding account for expenses flagged as personal or non-deductible pending review. Never treated as deductible." },
  // ---- Suspense (9000)
  { code: "9999", name: "Uncategorized / Suspense", type: "EXPENSE", subtype: "SUSPENSE", description: "Temporary. Must be zero before a period may lock." },
];

export function accountIdForCode(code: string): string {
  return `acct_${code}`;
}

export function buildChartOfAccounts(): Account[] {
  return COA_TEMPLATE.map((row) => ({
    id: accountIdForCode(row.code),
    code: row.code,
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    normalBalance: normalFor(row.type),
    cashFlowSection: row.cashFlowSection,
    isActive: true,
    restricted: row.restricted ?? false,
    description: row.description,
  }));
}

/** Commonly referenced codes, exported so callers never hard-code strings in many places. */
export const ACCT = {
  CHECKING: "1000",
  SAVINGS: "1010",
  AR: "1100",
  PREPAID: "1200",
  DUE_FROM_SHAREHOLDER: "1260",
  COMPUTER_EQUIPMENT: "1500",
  ACCUM_DEPR: "1590",
  AP: "2000",
  CREDIT_CARD: "2050",
  ACCRUED_EXPENSES: "2100",
  ACCRUED_PAYROLL: "2150",
  FED_PAYROLL_TAX_PAYABLE: "2200",
  STATE_PAYROLL_TAX_PAYABLE: "2210",
  FUTA_PAYABLE: "2220",
  SUI_PAYABLE: "2230",
  INCOME_TAX_PAYABLE: "2300",
  CA_FRANCHISE_PAYABLE: "2310",
  DEFERRED_REVENUE: "2400",
  DUE_TO_SHAREHOLDER: "2500",
  LOANS: "2700",
  CAPITAL: "3000",
  DISTRIBUTIONS: "3100",
  RETAINED_EARNINGS: "3900",
  SERVICE_REVENUE: "4000",
  CONSULTING_REVENUE: "4100",
  OTHER_INCOME: "4900",
  INTEREST_INCOME: "4910",
  COGS_CLOUD: "5000",
  COGS_AI_API: "5100",
  COGS_SUBCONTRACT: "5200",
  SALARIES: "6000",
  OFFICER_COMP: "6010",
  CONTRACTORS_DOMESTIC: "6050",
  INTL_WORKERS: "6060",
  EMPLOYER_PAYROLL_TAX: "6100",
  BENEFITS: "6150",
  PAYROLL_FEES: "6190",
  SOFTWARE: "7000",
  HOSTING: "7010",
  RENT: "7100",
  UTILITIES: "7150",
  PROFESSIONAL_FEES: "7200",
  INSURANCE: "7250",
  MEALS: "7300",
  TRAVEL: "7310",
  MARKETING: "7350",
  OFFICE_SUPPLIES: "7400",
  TELECOM: "7450",
  BANK_FEES: "7500",
  EDUCATION: "7550",
  LICENSES: "7600",
  DUES: "7650",
  DEPRECIATION: "7700",
  INTEREST_EXPENSE: "7800",
  STATE_TAXES: "7900",
  OTHER_OPEX: "7950",
  PERSONAL_REVIEW: "7990",
  SUSPENSE: "9999",
} as const;
