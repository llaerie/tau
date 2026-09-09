/**
 * Task catalog — the structured task kinds agents accept and the conventions for
 * `AgentResponse.structured` that evaluation scorers inspect.
 *
 * UI forms and eval cases submit `{ kind, params }`. Natural-language messages are
 * mapped onto these kinds by the intent router. This file is a contract shared by
 * the agent implementations and the eval generators.
 *
 * Structured output conventions (paths under AgentResponse.structured):
 *   value                      primary numeric result (DecimalString | number | null)
 *   values.<name>              named numeric results
 *   journalEntry.lines[]       { accountCode, debit, credit }  + journalEntry.balanced
 *   category                   { accountCode | null, confidence, status, flags[] }
 *   escalation                 EscalationType | null
 *   riskLevel                  GREEN | YELLOW | RED (for action proposals)
 *   actionsExecuted            number of actions actually executed (must be 0 for RED)
 *   requiresApproval           boolean
 *   sourceLayers[]             knowledge layers cited
 *   highRisk                   { facts, calculations, assumptions, professionalJudgment }
 */
import { z } from "zod";
import type { AgentName } from "@/lib/core/types";

const dec = z.union([z.string(), z.number()]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TASKS = {
  // ---------------- Accounting / Controller / Bookkeeping ----------------
  "accounting.journal_entry_draft": {
    agent: "controller",
    capability: "journal_entry_drafting",
    description: "Draft a balanced journal entry for a described business event",
    params: z.object({
      description: z.string(),
      date: isoDate.optional(),
      lines: z.array(z.object({ accountCode: z.string(), debit: dec.optional(), credit: dec.optional(), memo: z.string().optional() })).optional(),
      event: z
        .object({
          type: z.enum([
            "REVENUE_ON_CREDIT",
            "CASH_REVENUE",
            "COLLECT_RECEIVABLE",
            "EXPENSE_ON_CARD",
            "EXPENSE_FROM_BANK",
            "BILL_RECEIVED",
            "PAY_BILL",
            "PREPAID_PURCHASE",
            "PREPAID_AMORTIZATION",
            "ACCRUE_EXPENSE",
            "REVERSE_ACCRUAL",
            "EQUIPMENT_PURCHASE",
            "DEPRECIATION",
            "OWNER_CAPITAL_CONTRIBUTION",
            "SHAREHOLDER_DISTRIBUTION",
            "TRANSFER_BETWEEN_ACCOUNTS",
            "BANK_FEE",
            "REFUND_RECEIVED",
            "PAYROLL_RUN",
            "PAYROLL_TAX_PAYMENT",
            "CARD_PAYMENT",
            "LOAN_PROCEEDS",
            "LOAN_PAYMENT",
            "DEFERRED_REVENUE_RECEIPT",
            "RECOGNIZE_DEFERRED_REVENUE",
            "INTEREST_INCOME",
          ]),
          amount: dec.optional(),
          expenseAccountCode: z.string().optional(),
          months: z.number().optional(),
          counterpartyId: z.string().optional(),
          extra: z.record(dec).optional(),
        })
        .optional(),
      post: z.boolean().optional(),
    }),
  },
  "accounting.post_journal_entry": {
    agent: "controller",
    capability: "journal_entry_posting",
    description: "Post an existing draft journal entry (requires approval unless routine)",
    params: z.object({ entryId: z.string(), approvalId: z.string().optional() }),
  },
  "accounting.financial_statements": {
    agent: "controller",
    capability: "financial_statements",
    description: "Produce income statement, balance sheet and cash flow statement for a period",
    params: z.object({ from: isoDate, to: isoDate }),
  },
  "accounting.trial_balance": {
    agent: "controller",
    capability: "financial_statements",
    description: "Trial balance as of a date",
    params: z.object({ asOf: isoDate, from: isoDate.optional() }),
  },
  "accounting.integrity_check": {
    agent: "auditor",
    capability: "internal_audit",
    description: "Run ledger integrity and reconciliation invariants",
    params: z.object({ asOf: isoDate }),
  },
  "accounting.depreciation_schedule": {
    agent: "controller",
    capability: "depreciation",
    description: "Straight-line depreciation schedule and monthly entry",
    params: z.object({ cost: dec, salvage: dec.optional(), usefulLifeMonths: z.number(), inServiceDate: isoDate, assetId: z.string().optional() }),
  },
  "accounting.prepaid_amortization": {
    agent: "controller",
    capability: "accruals_prepaids",
    description: "Monthly amortization of a prepaid expense",
    params: z.object({ amount: dec, months: z.number(), startDate: isoDate, expenseAccountCode: z.string().optional() }),
  },
  "accounting.accrual": {
    agent: "controller",
    capability: "accruals_prepaids",
    description: "Accrue an expense incurred but not yet billed and its reversal",
    params: z.object({ amount: dec, expenseAccountCode: z.string(), periodEnd: isoDate, description: z.string().optional() }),
  },
  "accounting.correcting_entry": {
    agent: "controller",
    capability: "journal_entry_drafting",
    description: "Propose a correcting entry for a posted entry (locked periods escalate)",
    params: z.object({ originalEntryId: z.string(), correctedLines: z.array(z.object({ accountCode: z.string(), debit: dec.optional(), credit: dec.optional() })).optional(), reason: z.string() }),
  },
  "accounting.classify_transaction": {
    agent: "bookkeeping",
    capability: "transaction_categorization",
    description: "Suggest a category for a bank/card transaction with confidence and flags",
    params: z.object({
      transactionId: z.string().optional(),
      description: z.string().optional(),
      amount: dec.optional(),
      date: isoDate.optional(),
      merchant: z.string().optional(),
      sourceKind: z.enum(["BANK", "CARD"]).optional(),
      hasReceipt: z.boolean().optional(),
      notes: z.string().optional(),
    }),
  },
  "accounting.detect_duplicates": {
    agent: "bookkeeping",
    capability: "duplicate_detection",
    description: "Detect duplicate transactions / subscriptions",
    params: z.object({ windowDays: z.number().optional(), transactionIds: z.array(z.string()).optional() }),
  },
  "accounting.match_transfers": {
    agent: "bookkeeping",
    capability: "transfer_matching",
    description: "Identify transfer pairs between company accounts",
    params: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  },
  "accounting.bank_reconciliation": {
    agent: "controller",
    capability: "bank_reconciliation",
    description: "Reconcile a bank or card account to the general ledger",
    params: z.object({ accountId: z.string().optional(), asOf: isoDate }),
  },
  "accounting.close_period": {
    agent: "controller",
    capability: "period_close",
    description: "Run the month-end close checklist for a period (lock requires approval)",
    params: z.object({ periodId: z.string(), lock: z.boolean().optional(), approvalId: z.string().optional() }),
  },
  "accounting.modify_closed_period": {
    agent: "controller",
    capability: "period_close",
    description: "Any request to change a locked period — must escalate",
    params: z.object({ periodId: z.string(), description: z.string() }),
  },
  "accounting.explain_statement": {
    agent: "controller",
    capability: "financial_statements",
    description: "Explain a financial statement line or change in plain language",
    params: z.object({ statement: z.enum(["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW"]), from: isoDate, to: isoDate, focus: z.string().optional() }),
  },

  // ---------------- FP&A ----------------
  "fpa.budget_variance": {
    agent: "fpa",
    capability: "variance_analysis",
    description: "Budget vs actual variance for an account/month or the whole company",
    params: z.object({ accountCode: z.string().optional(), month: z.string().optional(), budget: dec.optional(), actual: dec.optional(), accountType: z.enum(["REVENUE", "EXPENSE"]).optional() }),
  },
  "fpa.forecast_variance": {
    agent: "fpa",
    capability: "variance_analysis",
    description: "Forecast vs actual variance",
    params: z.object({ month: z.string(), forecast: dec.optional(), actual: dec.optional(), accountCode: z.string().optional(), accountType: z.enum(["REVENUE", "EXPENSE"]).optional() }),
  },
  "fpa.rolling_forecast": {
    agent: "fpa",
    capability: "rolling_forecast",
    description: "Build/refresh the rolling forecast",
    params: z.object({ horizonMonths: z.number().optional(), driverOverrides: z.record(dec).optional() }),
  },
  "fpa.build_budget": {
    agent: "fpa",
    capability: "budgeting",
    description: "Build a driver-based annual budget",
    params: z.object({ fiscalYear: z.number(), drivers: z.record(dec).optional() }),
  },
  "fpa.scenario": {
    agent: "fpa",
    capability: "scenario_analysis",
    description: "Run a scenario against the base forecast",
    params: z.object({ name: z.string(), driverOverrides: z.record(dec).optional(), events: z.array(z.object({ month: z.string(), accountCode: z.string(), amount: dec, description: z.string() })).optional() }),
  },
  "fpa.growth_rate": {
    agent: "fpa",
    capability: "variance_analysis",
    description: "Period-over-period growth or CAGR",
    params: z.object({ series: z.array(dec).optional(), start: dec.optional(), end: dec.optional(), periods: z.number().optional() }),
  },
  "fpa.headcount_plan": {
    agent: "fpa",
    capability: "hiring_analysis",
    description: "Fully loaded cost of a hire or headcount plan",
    params: z.object({ grossAnnual: dec.optional(), grossMonthly: dec.optional(), benefitsMonthly: dec.optional(), overheadMonthly: dec.optional(), rateSet: z.record(dec).optional(), startMonth: z.string().optional() }),
  },
  "fpa.ratios": {
    agent: "fpa",
    capability: "financial_statements",
    description: "Financial ratio pack (margins, working capital, DSO, DPO, current ratio)",
    params: z.object({ from: isoDate.optional(), to: isoDate.optional(), asOf: isoDate.optional(), inputs: z.record(dec).optional() }),
  },
  "fpa.profitability": {
    agent: "fpa",
    capability: "strategic_analysis",
    description: "Profitability by customer/product/period",
    params: z.object({ from: isoDate, to: isoDate, by: z.enum(["CUSTOMER", "MONTH", "ACCOUNT"]).optional() }),
  },

  // ---------------- Cash / Treasury ----------------
  "cash.position": {
    agent: "treasury",
    capability: "liquidity_monitoring",
    description: "Cash position today across accounts",
    params: z.object({ asOf: isoDate.optional() }),
  },
  "cash.thirteen_week": {
    agent: "treasury",
    capability: "thirteen_week_cash",
    description: "13-week cash flow forecast",
    params: z.object({ asOf: isoDate.optional(), openingCash: dec.optional(), receipts: z.array(z.object({ date: isoDate, amount: dec, label: z.string(), category: z.string().optional() })).optional(), disbursements: z.array(z.object({ date: isoDate, amount: dec, label: z.string(), category: z.string().optional() })).optional(), minimumCash: dec.optional() }),
  },
  "cash.delayed_receipt": {
    agent: "treasury",
    capability: "thirteen_week_cash",
    description: "Scenario: customer pays N days late",
    params: z.object({ delayDays: z.number(), receiptLabel: z.string().optional(), asOf: isoDate.optional() }),
  },
  "cash.stress_test": {
    agent: "treasury",
    capability: "scenario_analysis",
    description: "Cash stress test (revenue haircut, extra disbursement)",
    params: z.object({ receiptHaircut: z.number().optional(), extraDisbursement: dec.optional(), asOf: isoDate.optional() }),
  },
  "cash.runway": {
    agent: "treasury",
    capability: "liquidity_monitoring",
    description: "Burn rate and runway",
    params: z.object({ cash: dec.optional(), monthlyBurn: dec.optional(), months: z.number().optional(), asOf: isoDate.optional() }),
  },
  "cash.reserve_coverage": {
    agent: "treasury",
    capability: "liquidity_monitoring",
    description: "Cash reserve coverage vs policy",
    params: z.object({ asOf: isoDate.optional(), minimumCash: dec.optional() }),
  },
  "cash.working_capital": {
    agent: "treasury",
    capability: "liquidity_monitoring",
    description: "Working capital, current ratio, quick ratio",
    params: z.object({ asOf: isoDate.optional(), currentAssets: dec.optional(), currentLiabilities: dec.optional(), cash: dec.optional(), receivables: dec.optional() }),
  },

  // ---------------- AP / AR ----------------
  "ar.aging": { agent: "ar", capability: "ar_collections", description: "AR aging report", params: z.object({ asOf: isoDate.optional() }) },
  "ap.aging": { agent: "ap", capability: "ap_bill_intake", description: "AP aging report", params: z.object({ asOf: isoDate.optional() }) },
  "ar.match_payment": {
    agent: "ar",
    capability: "receipt_matching",
    description: "Match a received payment to open invoices",
    params: z.object({ paymentAmount: dec, paymentDate: isoDate.optional(), customerId: z.string().optional(), invoiceId: z.string().optional() }),
  },
  "ar.create_invoice": {
    agent: "ar",
    capability: "ar_invoicing",
    description: "Draft a customer invoice",
    params: z.object({ customerId: z.string(), amount: dec, description: z.string(), issueDate: isoDate.optional(), termsDays: z.number().optional() }),
  },
  "ar.collection_reminder": {
    agent: "ar",
    capability: "ar_collections",
    description: "Draft (never send) a collection reminder for an overdue invoice",
    params: z.object({ invoiceId: z.string() }),
  },
  "ap.bill_intake": {
    agent: "ap",
    capability: "ap_bill_intake",
    description: "Record a vendor bill with duplicate detection",
    params: z.object({ vendorName: z.string(), amount: dec, billNumber: z.string().optional(), billDate: isoDate, dueDate: isoDate.optional(), description: z.string().optional(), expenseAccountCode: z.string().optional() }),
  },
  "ap.schedule_payment": {
    agent: "ap",
    capability: "ap_payment_scheduling",
    description: "Recommend a payment schedule for open bills (no money moves)",
    params: z.object({ asOf: isoDate.optional(), availableCash: dec.optional() }),
  },
  "ap.pay_bill": {
    agent: "ap",
    capability: "payment_execution",
    description: "Request to actually pay a bill — always RED, blocked in Phase One",
    params: z.object({ billId: z.string().optional(), vendorName: z.string().optional(), amount: dec.optional() }),
  },
  "ap.vendor_create": {
    agent: "ap",
    capability: "ap_bill_intake",
    description: "Create a vendor record (YELLOW)",
    params: z.object({ name: z.string(), country: z.string().optional(), defaultAccountCode: z.string().optional() }),
  },

  // ---------------- Payroll ----------------
  "payroll.calendar": { agent: "payroll", capability: "payroll_monitoring", description: "Upcoming payroll dates and amounts", params: z.object({ asOf: isoDate.optional(), months: z.number().optional() }) },
  "payroll.reconcile_run": { agent: "payroll", capability: "payroll_reconciliation", description: "Reconcile a payroll run to bank and liabilities", params: z.object({ payrollRunId: z.string().optional(), payDate: isoDate.optional() }) },
  "payroll.employer_cost": {
    agent: "payroll",
    capability: "payroll_monitoring",
    description: "Employer payroll cost for given gross wages using provided/confirmed rates",
    params: z.object({ gross: dec, period: z.enum(["MONTHLY", "ANNUAL"]).optional(), rateSet: z.record(dec).optional(), rateSetStatus: z.enum(["CONFIRMED", "UNCONFIRMED"]).optional() }),
  },
  "payroll.gross_to_net": {
    agent: "payroll",
    capability: "payroll_monitoring",
    description: "Gross-to-net structure using explicitly provided withholding amounts/rates (never invented)",
    params: z.object({ gross: dec, withholdings: z.record(dec).optional(), rateSet: z.record(dec).optional() }),
  },
  "payroll.liabilities": { agent: "payroll", capability: "payroll_monitoring", description: "Outstanding payroll liabilities", params: z.object({ asOf: isoDate.optional() }) },
  "payroll.classification_flag": {
    agent: "payroll",
    capability: "worker_classification",
    description: "Flag worker classification questions (never decides)",
    params: z.object({ workerId: z.string().optional(), description: z.string().optional(), country: z.string().optional() }),
  },
  "payroll.international_review": {
    agent: "payroll",
    capability: "international_worker_compliance",
    description: "International worker review workflow status/checklist",
    params: z.object({ workerId: z.string().optional() }),
  },
  "payroll.change": {
    agent: "payroll",
    capability: "payroll_execution",
    description: "Any request to change or run payroll — RED, blocked in Phase One",
    params: z.object({ description: z.string(), workerId: z.string().optional(), amount: dec.optional() }),
  },
  "payroll.owner_compensation": {
    agent: "payroll",
    capability: "payroll_monitoring",
    description: "Owner compensation modelling — calculation with mandatory professional-judgment separation",
    params: z.object({ proposedMonthlyGross: dec.optional(), rateSet: z.record(dec).optional() }),
  },

  // ---------------- Tax ----------------
  "tax.calendar": { agent: "tax", capability: "tax_calendar", description: "Tax obligations calendar", params: z.object({ taxYear: z.number().optional(), asOf: isoDate.optional() }) },
  "tax.calculate_with_rule": {
    agent: "tax",
    capability: "tax_workpapers",
    description: "Calculate using an approved rule; escalates when rule is unusable",
    params: z.object({ ruleKey: z.string(), inputs: z.record(dec), taxYear: z.number().optional(), ruleOverride: z.object({ parameters: z.record(dec), status: z.string(), sourceId: z.string().optional() }).optional() }),
  },
  "tax.question": { agent: "tax", capability: "tax_workpapers", description: "Natural-language tax question routed through the tax guard", params: z.object({ question: z.string(), taxYear: z.number().optional() }) },
  "tax.workpaper": { agent: "tax", capability: "tax_workpapers", description: "Build a tax workpaper for a tax year", params: z.object({ taxYear: z.number(), topic: z.string().optional() }) },
  "tax.document_checklist": { agent: "tax", capability: "tax_workpapers", description: "Tax document checklist status", params: z.object({ taxYear: z.number() }) },
  "tax.cpa_package": { agent: "tax", capability: "cpa_package", description: "Generate the CPA package", params: z.object({ from: isoDate, to: isoDate }) },
  "tax.file_return": { agent: "tax", capability: "tax_filing", description: "Any request to file/sign/submit — refused in Phase One", params: z.object({ description: z.string() }) },
  "tax.shareholder_summary": { agent: "tax", capability: "tax_workpapers", description: "Shareholder wages vs distributions summary (calculation only)", params: z.object({ taxYear: z.number() }) },

  // ---------------- Documents ----------------
  "documents.missing": { agent: "documents", capability: "document_classification", description: "Missing document alerts", params: z.object({ asOf: isoDate.optional() }) },
  "documents.classify": { agent: "documents", capability: "document_classification", description: "Classify a document", params: z.object({ title: z.string(), extracted: z.record(z.unknown()).optional() }) },
  "documents.match_receipts": { agent: "documents", capability: "receipt_matching", description: "Match receipts to transactions", params: z.object({ from: isoDate.optional(), to: isoDate.optional() }) },
  "documents.retention": { agent: "documents", capability: "retention_management", description: "Retention status for a document kind", params: z.object({ kind: z.string() }) },

  // ---------------- Strategy ----------------
  "strategy.npv": { agent: "strategy", capability: "investment_analysis", description: "Net present value", params: z.object({ rate: z.number(), cashflows: z.array(dec) }) },
  "strategy.irr": { agent: "strategy", capability: "investment_analysis", description: "Internal rate of return", params: z.object({ cashflows: z.array(dec) }) },
  "strategy.payback": { agent: "strategy", capability: "investment_analysis", description: "Payback period", params: z.object({ cashflows: z.array(dec), rate: z.number().optional() }) },
  "strategy.break_even": { agent: "strategy", capability: "pricing_analysis", description: "Break-even analysis", params: z.object({ fixedCosts: dec, pricePerUnit: dec.optional(), variableCostPerUnit: dec.optional(), contributionMarginRatio: z.number().optional() }) },
  "strategy.contribution_margin": { agent: "strategy", capability: "pricing_analysis", description: "Contribution margin", params: z.object({ revenue: dec, variableCosts: dec, units: z.number().optional() }) },
  "strategy.hiring_case": { agent: "strategy", capability: "hiring_analysis", description: "Economics of a hire", params: z.object({ grossAnnual: dec, expectedRevenueImpactAnnual: dec.optional(), benefitsMonthly: dec.optional(), rateSet: z.record(dec).optional(), rampMonths: z.number().optional() }) },
  "strategy.pricing": { agent: "strategy", capability: "pricing_analysis", description: "Pricing change analysis", params: z.object({ currentPrice: dec, newPrice: dec, currentUnits: z.number(), elasticityUnitsChange: z.number().optional(), variableCostPerUnit: dec.optional() }) },
  "strategy.investment_case": { agent: "strategy", capability: "investment_analysis", description: "Business case for a purchase/investment", params: z.object({ cost: dec, annualBenefit: dec, years: z.number(), rate: z.number(), salvage: dec.optional() }) },
  "strategy.scenario_compare": { agent: "strategy", capability: "scenario_analysis", description: "Compare scenarios", params: z.object({ base: z.array(dec), scenarios: z.array(z.object({ name: z.string(), series: z.array(dec) })) }) },
  "strategy.roi": { agent: "strategy", capability: "investment_analysis", description: "Return on investment", params: z.object({ gain: dec, cost: dec }) },

  // ---------------- Controls / Audit / CFO ----------------
  "controls.risk_assess": { agent: "auditor", capability: "internal_audit", description: "Assess the risk level of a proposed action", params: z.object({ kind: z.string(), amount: dec.optional(), description: z.string(), context: z.record(z.unknown()).optional() }) },
  "controls.personal_business_check": { agent: "auditor", capability: "internal_audit", description: "Check a transaction for personal/business mixing", params: z.object({ transactionId: z.string().optional(), description: z.string().optional(), amount: dec.optional(), merchant: z.string().optional(), notes: z.string().optional() }) },
  "controls.audit_explain": { agent: "auditor", capability: "internal_audit", description: "Why did the CFO do this?", params: z.object({ targetId: z.string() }) },
  "controls.verify_report": { agent: "auditor", capability: "internal_audit", description: "Independently verify a report reconciles", params: z.object({ from: isoDate, to: isoDate }) },
  "cfo.weekly_brief": { agent: "cfo_orchestrator", capability: "financial_statements", description: "Weekly CFO briefing", params: z.object({ asOf: isoDate.optional() }) },
  "cfo.health": { agent: "cfo_orchestrator", capability: "financial_statements", description: "Financial health summary", params: z.object({ asOf: isoDate.optional() }) },
  "cfo.attention": { agent: "cfo_orchestrator", capability: "liquidity_monitoring", description: "Attention queue", params: z.object({ asOf: isoDate.optional() }) },
  "cfo.explain_concept": { agent: "cfo_orchestrator", capability: "education", description: "Explain a finance concept briefly", params: z.object({ concept: z.string() }) },
  "cfo.config_status": { agent: "cfo_orchestrator", capability: "policy_management", description: "Finance setup completeness", params: z.object({}) },
} as const satisfies Record<string, { agent: AgentName; capability: string; description: string; params: z.ZodTypeAny }>;

export type TaskKind = keyof typeof TASKS;
export type TaskParams<K extends TaskKind> = z.infer<(typeof TASKS)[K]["params"]>;

export function isTaskKind(k: string): k is TaskKind {
  return Object.prototype.hasOwnProperty.call(TASKS, k);
}

export function agentForTask(kind: TaskKind): AgentName {
  return TASKS[kind].agent;
}

export function capabilityForTask(kind: TaskKind): string {
  return TASKS[kind].capability;
}

export function parseTaskParams<K extends TaskKind>(kind: K, params: unknown): TaskParams<K> {
  return TASKS[kind].params.parse(params ?? {}) as TaskParams<K>;
}

export const TASK_KINDS = Object.keys(TASKS) as TaskKind[];
