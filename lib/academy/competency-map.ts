/**
 * CFO Academy — competency map. The curriculum the AI CFO must master AND the
 * evaluation framework's taxonomy. Each competency maps to a capability key in the
 * competency matrix (lib/academy/capabilities.ts) so evaluation results roll up to
 * autonomy decisions per capability, never globally.
 */
import type { CompetencyDomain } from "@/lib/core/types";

export interface Competency {
  key: string;
  label: string;
  domain: CompetencyDomain;
  capabilityKey: string;
  /** Curriculum subject areas (from the owners' original plan) this competency draws on */
  subjects: string[];
  highRisk?: boolean;
}

export interface DomainDefinition {
  domain: CompetencyDomain;
  title: string;
  description: string;
  evalDirectory: string;
  competencies: Competency[];
}

const c = (domain: CompetencyDomain, capabilityKey: string, key: string, label: string, subjects: string[], highRisk = false): Competency => ({
  key,
  label,
  domain,
  capabilityKey,
  subjects,
  highRisk,
});

export const DOMAINS: DomainDefinition[] = [
  {
    domain: "ACCOUNTING_FOUNDATIONS",
    title: "Domain 1 — Accounting Foundations",
    description: "The accounting equation, double entry, and the mechanics of the three statements.",
    evalDirectory: "accounting",
    competencies: [
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "accounting_equation", "Accounting equation", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "debits_credits", "Debits and credits", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "chart_of_accounts", "Chart of accounts", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "journal_entries", "Journal entries", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "financial_statements", "cash_vs_accrual", "Cash vs accrual accounting", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "revenue_recognition_basic", "Revenue", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "transaction_categorization", "expenses", "Expenses", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "ar_invoicing", "accounts_receivable", "Accounts receivable", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "ap_bill_intake", "accounts_payable", "Accounts payable", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "accruals_prepaids", "accruals", "Accruals", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "accruals_prepaids", "deferrals", "Deferrals", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "accruals_prepaids", "prepaids", "Prepaids", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "depreciation", "fixed_assets", "Fixed assets", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "depreciation", "depreciation", "Depreciation", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "equity", "Equity", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "period_close", "retained_earnings", "Retained earnings", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "payroll_reconciliation", "payroll_accounting", "Payroll accounting", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "owner_shareholder_transactions", "Owner / shareholder transactions", ["Accounting fundamentals"], true),
      c("ACCOUNTING_FOUNDATIONS", "financial_statements", "three_statements", "Three financial statements", ["Accounting fundamentals", "Excel / financial modeling fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "period_close", "closing_entries", "Closing entries", ["Accounting fundamentals"]),
      c("ACCOUNTING_FOUNDATIONS", "journal_entry_drafting", "correcting_entries", "Correcting entries", ["Accounting fundamentals"]),
    ],
  },
  {
    domain: "ADVANCED_ACCOUNTING",
    title: "Domain 2 — Intermediate / Advanced Accounting",
    description: "Leases, debt, stock compensation concepts, deferred taxes, impairment, policy and presentation.",
    evalDirectory: "accounting",
    competencies: [
      c("ADVANCED_ACCOUNTING", "journal_entry_drafting", "leases", "Leases", ["Advanced accounting"]),
      c("ADVANCED_ACCOUNTING", "journal_entry_drafting", "debt", "Debt", ["Advanced accounting"]),
      c("ADVANCED_ACCOUNTING", "journal_entry_drafting", "interest", "Interest", ["Advanced accounting"]),
      c("ADVANCED_ACCOUNTING", "policy_management", "stock_compensation_concepts", "Stock compensation concepts", ["Advanced accounting"], true),
      c("ADVANCED_ACCOUNTING", "tax_workpapers", "deferred_taxes", "Deferred taxes", ["Advanced accounting"], true),
      c("ADVANCED_ACCOUNTING", "policy_management", "impairment_concepts", "Impairment concepts", ["Advanced accounting"], true),
      c("ADVANCED_ACCOUNTING", "policy_management", "business_combinations_concepts", "Business combinations (conceptual)", ["Advanced accounting"], true),
      c("ADVANCED_ACCOUNTING", "accruals_prepaids", "complex_accruals", "Complex accruals", ["Advanced accounting"]),
      c("ADVANCED_ACCOUNTING", "policy_management", "accounting_policy", "Accounting policy", ["Advanced accounting"], true),
      c("ADVANCED_ACCOUNTING", "financial_statements", "statement_presentation", "Financial statement presentation", ["Advanced accounting"]),
      c("ADVANCED_ACCOUNTING", "financial_statements", "disclosure_awareness", "Disclosure awareness", ["Advanced accounting"]),
    ],
  },
  {
    domain: "FINANCIAL_STATEMENT_ANALYSIS",
    title: "Domain 3 — Financial Statement Analysis",
    description: "Interpreting statements, margins, liquidity, trends, ratios, quality of earnings.",
    evalDirectory: "accounting",
    competencies: [
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "pl_interpretation", "P&L interpretation", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "balance_sheet_interpretation", "Balance sheet interpretation", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "cash_flow_interpretation", "Cash flow interpretation", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "margins", "Margins", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "liquidity_monitoring", "working_capital", "Working capital", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "liquidity_monitoring", "liquidity", "Liquidity", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "liquidity_monitoring", "cash_conversion", "Cash conversion", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "variance_analysis", "expense_analysis", "Expense analysis", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "strategic_analysis", "profitability", "Profitability", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "variance_analysis", "trend_analysis", "Trend analysis", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "ratio_analysis", "Ratio analysis", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "financial_statements", "footnote_reading", "Footnote / disclosure reading", ["Financial statement analysis"]),
      c("FINANCIAL_STATEMENT_ANALYSIS", "internal_audit", "quality_of_earnings", "Quality-of-earnings concepts", ["Financial statement analysis"]),
    ],
  },
  {
    domain: "FPA",
    title: "Domain 4 — FP&A",
    description: "Planning, budgets, rolling forecasts, variance, scenarios, headcount, management reporting.",
    evalDirectory: "fpa",
    competencies: [
      c("FPA", "budgeting", "annual_planning", "Annual planning", ["FP&A"]),
      c("FPA", "budgeting", "driver_based_budgets", "Driver-based budgets", ["FP&A", "Excel / financial modeling fundamentals"]),
      c("FPA", "rolling_forecast", "rolling_forecast", "Rolling forecast", ["FP&A"]),
      c("FPA", "budgeting", "departmental_budgets", "Departmental budgets", ["FP&A"]),
      c("FPA", "rolling_forecast", "forecast_accuracy", "Forecast accuracy", ["FP&A"]),
      c("FPA", "variance_analysis", "budget_vs_actual", "Budget vs actual", ["FP&A"]),
      c("FPA", "variance_analysis", "variance_analysis", "Variance analysis", ["FP&A"]),
      c("FPA", "scenario_analysis", "scenario_planning", "Scenario planning", ["FP&A"]),
      c("FPA", "scenario_analysis", "sensitivity_analysis", "Sensitivity analysis", ["FP&A"]),
      c("FPA", "hiring_analysis", "headcount_planning", "Headcount planning", ["FP&A"]),
      c("FPA", "rolling_forecast", "operating_model", "Operating model", ["FP&A", "Financial & valuation modeling"]),
      c("FPA", "financial_statements", "management_reporting", "Management reporting", ["FP&A"]),
    ],
  },
  {
    domain: "CASH_MANAGEMENT",
    title: "Domain 5 — Cash Management",
    description: "13-week forecasting, timing, liquidity, runway, stress tests.",
    evalDirectory: "cash",
    competencies: [
      c("CASH_MANAGEMENT", "thirteen_week_cash", "thirteen_week_forecast", "13-week cash forecast", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "thirteen_week_cash", "receipt_timing", "Receipt timing", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "thirteen_week_cash", "payroll_timing", "Payroll timing", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "thirteen_week_cash", "ap_timing", "AP timing", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "liquidity_monitoring", "minimum_liquidity", "Minimum liquidity", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "liquidity_monitoring", "runway", "Runway", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "liquidity_monitoring", "working_capital_effects", "Working-capital effects", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "scenario_analysis", "delayed_revenue_scenarios", "Delayed-revenue scenarios", ["13-week cash forecasting"]),
      c("CASH_MANAGEMENT", "scenario_analysis", "cash_stress_tests", "Cash stress tests", ["13-week cash forecasting"]),
    ],
  },
  {
    domain: "CORPORATE_FINANCE",
    title: "Domain 6 — Corporate Finance",
    description: "Time value of money, NPV, IRR, payback, WACC, ROIC, capital allocation.",
    evalDirectory: "strategy",
    competencies: [
      c("CORPORATE_FINANCE", "investment_analysis", "time_value_of_money", "Time value of money", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "npv", "NPV", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "irr", "IRR", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "payback", "Payback", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "wacc", "WACC (conceptual / practical)", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "roic", "Return on invested capital", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "strategic_analysis", "capital_allocation", "Capital allocation", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "strategic_analysis", "opportunity_cost", "Opportunity cost", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "strategic_analysis", "financing_choices", "Financing choices", ["Corporate finance"]),
      c("CORPORATE_FINANCE", "investment_analysis", "investment_analysis", "Investment analysis", ["Corporate finance"]),
    ],
  },
  {
    domain: "VALUATION",
    title: "Domain 7 — Valuation",
    description: "Three-statement modeling, DCF, comparables, scenario valuation, limitations.",
    evalDirectory: "strategy",
    competencies: [
      c("VALUATION", "rolling_forecast", "three_statement_modeling", "Three-statement modeling", ["Financial & valuation modeling"]),
      c("VALUATION", "investment_analysis", "dcf", "DCF", ["Financial & valuation modeling"]),
      c("VALUATION", "strategic_analysis", "comparable_company_concepts", "Comparable-company concepts", ["Financial & valuation modeling"]),
      c("VALUATION", "scenario_analysis", "scenario_valuation", "Scenario valuation", ["Financial & valuation modeling"]),
      c("VALUATION", "scenario_analysis", "sensitivity_tables", "Sensitivity tables", ["Financial & valuation modeling"]),
      c("VALUATION", "strategic_analysis", "valuation_assumptions", "Valuation assumptions", ["Financial & valuation modeling"]),
      c("VALUATION", "strategic_analysis", "valuation_limitations", "Limitations of valuation", ["Financial & valuation modeling"]),
    ],
  },
  {
    domain: "TAX_OPERATIONS",
    title: "Domain 8 — Tax Operations",
    description: "Calendar, documents, S-corp basics, payroll-tax workflow, sourcing evidence, escalating.",
    evalDirectory: "tax",
    competencies: [
      c("TAX_OPERATIONS", "tax_calendar", "tax_calendar_management", "Tax-calendar management", ["AI and automation for finance"]),
      c("TAX_OPERATIONS", "tax_workpapers", "tax_document_organization", "Tax document organization", ["AI and automation for finance"]),
      c("TAX_OPERATIONS", "tax_workpapers", "s_corporation_basics", "S corporation basics", ["Accounting fundamentals"], true),
      c("TAX_OPERATIONS", "tax_workpapers", "wage_distribution_distinction", "Shareholder wage / distribution distinction", ["Accounting fundamentals"], true),
      c("TAX_OPERATIONS", "payroll_monitoring", "payroll_tax_workflow", "Payroll-tax workflow", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_calendar", "california_obligations", "California state obligations", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_calendar", "federal_obligations", "Federal obligations", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_workpapers", "information_return_workflow", "Information return workflow", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_workpapers", "estimated_tax_workflow", "Estimated-tax planning workflow", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_workpapers", "evidence_sourcing", "Evidence sourcing", ["AI and automation for finance"], true),
      c("TAX_OPERATIONS", "tax_workpapers", "cpa_escalation", "CPA escalation", ["AI and automation for finance"], true),
    ],
  },
  {
    domain: "PAYROLL_WORKFORCE",
    title: "Domain 9 — Payroll & Workforce Finance",
    description: "Gross-to-net, employer cost, liabilities, classification flags, international workers.",
    evalDirectory: "payroll",
    competencies: [
      c("PAYROLL_WORKFORCE", "payroll_monitoring", "gross_to_net_structure", "Gross-to-net structure", ["Accounting fundamentals"]),
      c("PAYROLL_WORKFORCE", "payroll_monitoring", "employer_payroll_cost", "Employer payroll cost", ["Accounting fundamentals"]),
      c("PAYROLL_WORKFORCE", "payroll_reconciliation", "payroll_reconciliation", "Payroll reconciliation", ["Accounting fundamentals"]),
      c("PAYROLL_WORKFORCE", "payroll_monitoring", "payroll_liabilities", "Payroll liabilities", ["Accounting fundamentals"]),
      c("PAYROLL_WORKFORCE", "worker_classification", "employee_vs_contractor_flags", "Employee vs contractor flags", ["AI and automation for finance"], true),
      c("PAYROLL_WORKFORCE", "payroll_monitoring", "us_employee_records", "U.S. employee records", ["AI and automation for finance"]),
      c("PAYROLL_WORKFORCE", "international_worker_compliance", "international_worker_flags", "International worker payment / compliance flags", ["AI and automation for finance"], true),
      c("PAYROLL_WORKFORCE", "hiring_analysis", "compensation_planning", "Compensation planning", ["FP&A"], true),
      c("PAYROLL_WORKFORCE", "hiring_analysis", "benefits_cost_modeling", "Benefits cost modeling", ["FP&A"]),
    ],
  },
  {
    domain: "AP_AR",
    title: "Domain 10 — AP / AR",
    description: "Invoice lifecycle, matching, vendors, duplicates, aging, collections, reconciliation.",
    evalDirectory: "ap_ar",
    competencies: [
      c("AP_AR", "ar_invoicing", "invoice_lifecycle", "Invoice lifecycle", ["Accounting fundamentals"]),
      c("AP_AR", "receipt_matching", "payment_matching", "Payment matching", ["Accounting fundamentals"]),
      c("AP_AR", "ap_bill_intake", "vendor_records", "Vendor records", ["Accounting fundamentals"]),
      c("AP_AR", "duplicate_detection", "duplicates", "Duplicates", ["AI and automation for finance"]),
      c("AP_AR", "ar_collections", "aging", "Aging", ["Accounting fundamentals"]),
      c("AP_AR", "ar_collections", "cash_collection", "Cash collection", ["13-week cash forecasting"]),
      c("AP_AR", "receipt_matching", "customer_payment_reconciliation", "Customer / payment reconciliation", ["Accounting fundamentals"]),
      c("AP_AR", "ap_payment_scheduling", "payment_scheduling", "Payment scheduling (recommendation only)", ["13-week cash forecasting"], true),
    ],
  },
  {
    domain: "FINANCIAL_CONTROLS",
    title: "Domain 11 — Financial Controls",
    description: "Segregation of duties, approvals, audit trail, evidence, access, fraud awareness, separation.",
    evalDirectory: "compliance",
    competencies: [
      c("FINANCIAL_CONTROLS", "internal_audit", "segregation_of_duties", "Segregation of duties", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "approvals", "Approvals", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "audit_trail", "Audit trail", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "document_classification", "source_evidence", "Source evidence", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "access_control", "Access control", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "unusual_transaction_detection", "Unusual-transaction detection", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "fraud_awareness", "Fraud awareness", ["AI and automation for finance"], true),
      c("FINANCIAL_CONTROLS", "internal_audit", "personal_business_separation", "Personal / business separation", ["Accounting fundamentals"], true),
      c("FINANCIAL_CONTROLS", "retention_management", "document_retention", "Document retention", ["AI and automation for finance"]),
      c("FINANCIAL_CONTROLS", "bank_reconciliation", "reconciliation_controls", "Reconciliation controls", ["Accounting fundamentals"]),
    ],
  },
  {
    domain: "CFO_STRATEGY",
    title: "Domain 12 — CFO Strategy",
    description: "Hiring, pricing, cost reduction, vendor evaluation, project economics, business cases, downside scenarios.",
    evalDirectory: "strategy",
    competencies: [
      c("CFO_STRATEGY", "hiring_analysis", "hiring_decisions", "Hiring decisions", ["Corporate finance", "FP&A"]),
      c("CFO_STRATEGY", "pricing_analysis", "pricing_decisions", "Pricing decisions", ["Corporate finance"]),
      c("CFO_STRATEGY", "strategic_analysis", "cost_reduction", "Cost reduction", ["FP&A"]),
      c("CFO_STRATEGY", "strategic_analysis", "vendor_evaluation", "Vendor evaluation", ["FP&A"]),
      c("CFO_STRATEGY", "investment_analysis", "new_project_economics", "New-project economics", ["Corporate finance"]),
      c("CFO_STRATEGY", "strategic_analysis", "profitability_strategy", "Profitability", ["Financial statement analysis"]),
      c("CFO_STRATEGY", "strategic_analysis", "resource_allocation", "Resource allocation", ["Corporate finance"]),
      c("CFO_STRATEGY", "investment_analysis", "business_case_preparation", "Business-case preparation", ["Financial & valuation modeling"]),
      c("CFO_STRATEGY", "scenario_analysis", "downside_scenarios", "Downside scenarios", ["FP&A"]),
    ],
  },
];

export const COMPETENCIES: Competency[] = DOMAINS.flatMap((d) => d.competencies);
export const COMPETENCY_BY_KEY: Record<string, Competency> = Object.fromEntries(COMPETENCIES.map((x) => [x.key, x]));

export function domainOf(domain: CompetencyDomain): DomainDefinition {
  const d = DOMAINS.find((x) => x.domain === domain);
  if (!d) throw new Error(`Unknown domain ${domain}`);
  return d;
}

export const CURRICULUM_SUBJECTS = [
  "Excel / financial modeling fundamentals",
  "Accounting fundamentals",
  "Advanced accounting",
  "Financial statement analysis",
  "FP&A",
  "Corporate finance",
  "Financial & valuation modeling",
  "13-week cash forecasting",
  "AI and automation for finance",
] as const;
