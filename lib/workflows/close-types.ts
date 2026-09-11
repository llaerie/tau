/**
 * Month-end close contracts: the 21-step checklist, step results and the run context.
 *
 * Exception convention: every exception string starts with `ERROR:` (blocks the close / lock) or
 * `WARNING:` (reported, does not block). `isBlockingException` is the single source of truth.
 */
import type { BalanceSheet, CashFlowStatement, IncomeStatement, NewJournalEntryInput } from "@/lib/core/contracts";
import type { Actor, ID, ISODate, ISODateTime, Period, PeriodStatus, ProposedAction, RiskAssessment } from "@/lib/core/types";
import type { Ledger } from "@/lib/accounting/ledger";
import type { LabRuntime } from "@/lib/db/runtime";
import type { CalcCollector } from "./shared";

export const MONTH_END_CLOSE_VERSION = "month-end-close:v1";

export type CloseStepStatus = "PASSED" | "WARNING" | "FAILED" | "SKIPPED" | "NEEDS_APPROVAL";

export interface CloseStep {
  step: number;
  key: string;
  title: string;
  status: CloseStepStatus;
  details: string[];
  proposedEntries?: NewJournalEntryInput[];
  /** Ids of DRAFT journal entries created (or already present) for this step. */
  draftedEntryIds?: ID[];
  exceptions: string[];
  calcIds: ID[];
}

export interface CloseStepSpec {
  step: number;
  key: string;
  title: string;
}

export const CLOSE_STEPS: readonly CloseStepSpec[] = Object.freeze([
  { step: 1, key: "bank_card_data_imported", title: "Confirm bank and card data imported through period end" },
  { step: 2, key: "reconcile_cash", title: "Reconcile cash accounts" },
  { step: 3, key: "reconcile_cards", title: "Reconcile credit cards" },
  { step: 4, key: "resolve_uncategorized", title: "Resolve uncategorized transactions and suspense" },
  { step: 5, key: "match_invoices_receipts", title: "Match invoices and receipts" },
  { step: 6, key: "review_ar", title: "Review accounts receivable" },
  { step: 7, key: "review_ap", title: "Review accounts payable" },
  { step: 8, key: "reconcile_payroll", title: "Reconcile payroll" },
  { step: 9, key: "review_accruals", title: "Review accruals" },
  { step: 10, key: "review_prepaids", title: "Review prepaids" },
  { step: 11, key: "review_fixed_assets", title: "Review fixed assets and depreciation" },
  { step: 12, key: "review_shareholder_transactions", title: "Review shareholder transactions" },
  { step: 13, key: "review_personal_business_separation", title: "Review business / personal separation" },
  { step: 14, key: "ledger_integrity", title: "Run ledger integrity tests" },
  { step: 15, key: "preliminary_statements", title: "Produce preliminary financial statements" },
  { step: 16, key: "controller_review", title: "Controller review (statement sanity checks)" },
  { step: 17, key: "internal_auditor_review", title: "Internal auditor review (independent recomputation)" },
  { step: 18, key: "resolve_exceptions", title: "Resolve exceptions" },
  { step: 19, key: "lock_period", title: "Lock period (approval required)" },
  { step: 20, key: "management_report", title: "Management report" },
  { step: 21, key: "cpa_package", title: "CPA package" },
]);

export const ERROR_PREFIX = "ERROR:";
export const WARNING_PREFIX = "WARNING:";

export const err = (msg: string): string => `${ERROR_PREFIX} ${msg}`;
export const warn = (msg: string): string => `${WARNING_PREFIX} ${msg}`;
export const isBlockingException = (s: string): boolean => s.startsWith(ERROR_PREFIX);

export interface CloseContext {
  rt: LabRuntime;
  periodId: ID;
  period: Period;
  start: ISODate;
  end: ISODate;
  /** YYYY-MM */
  month: string;
  actor: Actor;
  calcs: CalcCollector;
  /** Read-only ledger view over the same dataset for pure builders that need the concrete class. */
  helperLedger: Ledger;
  draftedEntryIds: ID[];
}

export interface ManagementReport {
  periodId: ID;
  from: ISODate;
  to: ISODate;
  statements: { revenue: string; costOfRevenue: string; grossProfit: string; operatingExpenses: string; netIncome: string; totalAssets: string; totalLiabilities: string; totalEquity: string; cash: string; closingCash: string };
  ratios: Record<string, { value: number | string | null; calcId: ID; formula: string }>;
  variances: { budgetId?: ID; flagged: { accountCode?: string; accountName?: string; month: string; actual: string; budget: string; variance: string; favorable: boolean | null }[]; note?: string; calcId?: ID };
  /** `total` is null (UNKNOWN — no bank data) when nothing has been posted. */
  cashPosition: { total: string | null; calcId: ID };
  arOverdue: { total: string; count: number; calcId: ID };
  apOpen: { total: string; count: number; calcId: ID };
  calcIds: ID[];
}

export interface CloseResult {
  periodId: ID;
  periodStart: ISODate;
  periodEnd: ISODate;
  statusBefore: PeriodStatus;
  statusAfter: PeriodStatus;
  steps: CloseStep[];
  exceptions: string[];
  /** Blocking (ERROR-level) exceptions only. */
  blockers: string[];
  /** True when no blocking exception remains (the lock gate is clean). */
  passed: boolean;
  /** Alias of `steps` for callers that expect a checklist. */
  checklist: CloseStep[];
  locked: boolean;
  needsApproval?: { action: ProposedAction; risk: RiskAssessment; reason: string };
  statements: { incomeStatement: IncomeStatement; balanceSheet: BalanceSheet; cashFlowStatement: CashFlowStatement } | null;
  managementReport: ManagementReport | null;
  cpaPackageId?: ID;
  auditEventId: ID;
  draftedEntryIds: ID[];
  calcIds: ID[];
  generatedAt: ISODateTime;
}

export interface CloseOptions {
  lock?: boolean;
  approvalId?: string;
  skipSteps?: string[];
}
