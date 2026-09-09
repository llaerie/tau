/**
 * Tau AI CFO — core domain types.
 *
 * These types are the shared contract for every subsystem (accounting engine,
 * finance calculation engine, agents, evaluation harness, UI, persistence).
 *
 * Money is NEVER represented as a binary floating point number. All monetary
 * values are `DecimalString` (e.g. "1234.56") and are manipulated through
 * `lib/core/money.ts` (decimal.js). Persistence uses NUMERIC(19,4).
 *
 * Unknown facts about the real company are represented explicitly with
 * `FieldStatus` and `null` values — never as zero and never as a guess.
 */

export type ID = string;
/** YYYY-MM-DD */
export type ISODate = string;
/** ISO 8601 date-time with timezone */
export type ISODateTime = string;
/** Decimal number encoded as a string, e.g. "1234.5600" */
export type DecimalString = string;
export type CurrencyCode = "USD" | "CNY" | "EUR" | "GBP" | (string & {});

export interface Money {
  amount: DecimalString;
  currency: CurrencyCode;
}

// ---------------------------------------------------------------------------
// Configuration / knowledge status
// ---------------------------------------------------------------------------

export type FieldStatus =
  | "CONFIRMED"
  | "UNCONFIRMED"
  | "PROFESSIONAL_REVIEW_REQUIRED"
  | "SUPERSEDED";

export interface ConfigField<T = unknown> {
  key: string;
  section: string;
  label: string;
  /** null means UNKNOWN. Never coerce to zero. */
  value: T | null;
  status: FieldStatus;
  note?: string;
  /** Who must confirm this field (e.g. CPA, OWNER) */
  requiredConfirmer?: Role;
  updatedAt?: ISODateTime;
  updatedBy?: string;
  sourceIds?: ID[];
  /** true when this is synthetic lab data rather than a real company fact */
  synthetic?: boolean;
}

export interface Assumption {
  key: string;
  description: string;
  value: unknown;
  status: FieldStatus;
  sourceId?: ID;
  /** Whether a human/professional must review before this assumption may drive an action */
  requiresProfessionalReview?: boolean;
}

// ---------------------------------------------------------------------------
// Roles, actors, risk
// ---------------------------------------------------------------------------

export type Role =
  | "OWNER"
  | "FINANCE_OPERATOR"
  | "CPA"
  | "PAYROLL_PROFESSIONAL"
  | "ATTORNEY"
  | "AUDITOR"
  | "VIEWER"
  | "SYSTEM"
  | "AGENT";

export interface Actor {
  type: "USER" | "AGENT" | "SYSTEM";
  id: string;
  role: Role;
  displayName?: string;
}

export type RiskLevel = "GREEN" | "YELLOW" | "RED";

export type AgentName =
  | "cfo_orchestrator"
  | "controller"
  | "bookkeeping"
  | "fpa"
  | "treasury"
  | "ap"
  | "ar"
  | "payroll"
  | "tax"
  | "documents"
  | "strategy"
  | "auditor";

// ---------------------------------------------------------------------------
// Chart of accounts and ledger
// ---------------------------------------------------------------------------

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type NormalBalance = "DEBIT" | "CREDIT";

export type AccountSubtype =
  | "CASH"
  | "ACCOUNTS_RECEIVABLE"
  | "PREPAID"
  | "OTHER_CURRENT_ASSET"
  | "FIXED_ASSET"
  | "ACCUMULATED_DEPRECIATION"
  | "OTHER_ASSET"
  | "ACCOUNTS_PAYABLE"
  | "CREDIT_CARD"
  | "ACCRUED_LIABILITY"
  | "PAYROLL_LIABILITY"
  | "TAX_LIABILITY"
  | "DEFERRED_REVENUE"
  | "OTHER_CURRENT_LIABILITY"
  | "LONG_TERM_DEBT"
  | "OWNER_EQUITY"
  | "SHAREHOLDER_DISTRIBUTIONS"
  | "RETAINED_EARNINGS"
  | "OPERATING_REVENUE"
  | "OTHER_INCOME"
  | "COST_OF_REVENUE"
  | "PAYROLL_EXPENSE"
  | "PAYROLL_TAX_EXPENSE"
  | "OPERATING_EXPENSE"
  | "DEPRECIATION_EXPENSE"
  | "INTEREST_EXPENSE"
  | "TAX_EXPENSE"
  | "OTHER_EXPENSE"
  | "SUSPENSE";

/** How movements in a balance-sheet account are classified in the indirect cash flow statement. */
export type CashFlowSection = "CASH" | "OPERATING" | "INVESTING" | "FINANCING";

export interface Account {
  id: ID;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  normalBalance: NormalBalance;
  cashFlowSection?: CashFlowSection;
  parentId?: ID;
  isActive: boolean;
  description?: string;
  /** Requires elevated approval to post to (e.g. distributions, prior-period corrections) */
  restricted?: boolean;
}

export type JournalEntryStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "REVERSED" | "VOID";

export type JournalSource =
  | "OPENING_BALANCE"
  | "BANK_IMPORT"
  | "CARD_IMPORT"
  | "PAYROLL"
  | "AR"
  | "AP"
  | "MANUAL"
  | "AGENT"
  | "ADJUSTING"
  | "CLOSING"
  | "CORRECTING"
  | "REVERSAL"
  | "DEPRECIATION"
  | "SYSTEM";

export interface EntityRef {
  type: "VENDOR" | "CUSTOMER" | "EMPLOYEE" | "CONTRACTOR" | "OWNER" | "TAX_AUTHORITY" | "BANK" | "OTHER";
  id: ID;
}

export interface JournalLine {
  id: ID;
  accountId: ID;
  debit: DecimalString;
  credit: DecimalString;
  currency: CurrencyCode;
  memo?: string;
  entityRef?: EntityRef;
}

export interface JournalEntry {
  id: ID;
  entryNumber: number;
  date: ISODate;
  periodId: ID;
  description: string;
  memo?: string;
  status: JournalEntryStatus;
  source: JournalSource;
  lines: JournalLine[];
  /** Transactions, documents, payroll runs, invoices, bills that support this entry */
  sourceIds: ID[];
  createdBy: string;
  createdAt: ISODateTime;
  postedAt?: ISODateTime;
  approvalId?: ID;
  reversesEntryId?: ID;
  reversedByEntryId?: ID;
  tags?: string[];
}

export type PeriodStatus = "OPEN" | "SOFT_CLOSED" | "LOCKED";

export interface Period {
  id: ID; // e.g. "2026-03"
  year: number;
  month: number;
  startDate: ISODate;
  endDate: ISODate;
  status: PeriodStatus;
  lockedAt?: ISODateTime;
  lockedBy?: string;
  lockApprovalId?: ID;
  closeChecklistId?: ID;
}

// ---------------------------------------------------------------------------
// Bank / card / transactions
// ---------------------------------------------------------------------------

export interface BankAccount {
  id: ID;
  name: string;
  institution: string;
  accountType: "CHECKING" | "SAVINGS" | "MONEY_MARKET";
  last4: string;
  currency: CurrencyCode;
  glAccountId: ID;
  isSynthetic: boolean;
  openedDate?: ISODate;
}

export interface Card {
  id: ID;
  name: string;
  issuer: string;
  last4: string;
  currency: CurrencyCode;
  glAccountId: ID;
  isSynthetic: boolean;
  statementCloseDay?: number;
  paymentDueDay?: number;
}

export type TransactionFlag =
  | "POSSIBLE_DUPLICATE"
  | "POSSIBLE_PERSONAL"
  | "MISSING_RECEIPT"
  | "TRANSFER"
  | "REFUND"
  | "LARGE_UNUSUAL"
  | "NEW_MERCHANT"
  | "UNCATEGORIZED"
  | "REVIEW_REQUIRED"
  | "RELATED_PARTY"
  | "INTERNATIONAL"
  | "SPLIT";

export type CategoryStatus = "UNCATEGORIZED" | "SUGGESTED" | "APPROVED" | "REJECTED";

export interface TransactionCategory {
  accountId: ID | null;
  status: CategoryStatus;
  confidence: number; // 0..1
  reason?: string;
  suggestedBy?: AgentName | "RULE" | "USER";
  approvedBy?: string;
  /** For split transactions */
  splits?: { accountId: ID; amount: DecimalString; memo?: string }[];
}

export interface Transaction {
  id: ID;
  sourceKind: "BANK" | "CARD";
  sourceAccountId: ID; // BankAccount.id or Card.id
  externalId: string;
  date: ISODate;
  postedDate: ISODate;
  /** Signed. Negative = money leaving the account / charge on the card. */
  amount: DecimalString;
  currency: CurrencyCode;
  descriptionRaw: string;
  merchantNormalized?: string;
  counterpartyRef?: EntityRef;
  category: TransactionCategory;
  journalEntryId?: ID;
  documentIds: ID[];
  transferPairId?: ID;
  duplicateOfId?: ID;
  flags: TransactionFlag[];
  importBatchId: string;
  /** Free-form structured facts used by the lab (e.g. synthetic ground-truth tags). Never used by the ledger. */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Counterparties, AR/AP
// ---------------------------------------------------------------------------

export interface Vendor {
  id: ID;
  name: string;
  normalizedNames: string[];
  defaultAccountId?: ID;
  paymentTermsDays?: number;
  isRecurring: boolean;
  category?: string;
  country: string;
  taxDocStatus: "NOT_REQUIRED" | "REQUESTED" | "ON_FILE" | "UNKNOWN";
  active: boolean;
  createdAt: ISODateTime;
  approvedBy?: string;
}

export interface Customer {
  id: ID;
  name: string;
  paymentTermsDays: number;
  country: string;
  relatedParty: boolean;
  relatedPartyNote?: string;
  contractDocumentId?: ID;
  active: boolean;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID";

export interface InvoiceLine {
  id: ID;
  description: string;
  quantity: DecimalString;
  unitPrice: DecimalString;
  amount: DecimalString;
  revenueAccountId: ID;
}

export interface Invoice {
  id: ID;
  number: string;
  customerId: ID;
  issueDate: ISODate;
  dueDate: ISODate;
  servicePeriodStart?: ISODate;
  servicePeriodEnd?: ISODate;
  currency: CurrencyCode;
  total: DecimalString;
  amountPaid: DecimalString;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  journalEntryId?: ID;
  documentId?: ID;
  paymentIds: ID[];
}

export type BillStatus = "RECEIVED" | "APPROVED" | "SCHEDULED" | "PAID" | "DISPUTED" | "DUPLICATE" | "VOID";

export interface Bill {
  id: ID;
  vendorId: ID;
  number: string;
  receivedDate: ISODate;
  billDate: ISODate;
  dueDate: ISODate;
  currency: CurrencyCode;
  total: DecimalString;
  amountPaid: DecimalString;
  status: BillStatus;
  expenseAccountId: ID;
  description: string;
  documentId?: ID;
  journalEntryId?: ID;
  paymentIds: ID[];
  duplicateOfId?: ID;
  approvalId?: ID;
}

export interface PaymentApplication {
  targetType: "INVOICE" | "BILL";
  targetId: ID;
  amount: DecimalString;
}

export interface Payment {
  id: ID;
  direction: "IN" | "OUT";
  date: ISODate;
  amount: DecimalString;
  currency: CurrencyCode;
  method: "ACH" | "WIRE" | "CARD" | "CHECK" | "OTHER";
  counterpartyRef?: EntityRef;
  applications: PaymentApplication[];
  transactionId?: ID;
  journalEntryId?: ID;
  memo?: string;
}

// ---------------------------------------------------------------------------
// Workforce & payroll
// ---------------------------------------------------------------------------

export type WorkerType = "EMPLOYEE" | "CONTRACTOR" | "UNRESOLVED";

export interface Compensation {
  type: "SALARY" | "HOURLY" | "CONTRACT";
  amount: DecimalString;
  currency: CurrencyCode;
  period: "MONTHLY" | "ANNUAL" | "HOURLY";
  /** Whether this figure is gross, net, employer cost, or unknown */
  basis: "GROSS" | "NET" | "EMPLOYER_COST" | "CONTRACT_FEE" | "UNKNOWN";
  status: FieldStatus;
  note?: string;
}

export interface Worker {
  id: ID;
  displayName: string;
  roleTitle: string;
  country: string;
  workerType: WorkerType;
  classificationStatus: "CONFIRMED" | "UNRESOLVED_PROFESSIONAL_REVIEW";
  compensation: Compensation;
  startDate: ISODate;
  endDate?: ISODate;
  isOwner: boolean;
  relatedParty: boolean;
  relatedPartyNote?: string;
  payMethod?: "PAYROLL_PROVIDER" | "ACH" | "WIRE" | "INTERNATIONAL_PLATFORM" | "UNKNOWN";
  documentIds: ID[];
  /** Cross-border compliance workflow — required for non-US workers */
  internationalReview?: InternationalWorkerReview;
  isSynthetic: boolean;
}

export interface InternationalWorkerReview {
  status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED" | "IN_REVIEW" | "REVIEWED";
  fields: ConfigField[];
  reviewerRole: Role;
  notes?: string[];
}

export interface PayrollLine {
  workerId: ID;
  gross: DecimalString;
  federalIncomeTaxWithheld: DecimalString;
  stateIncomeTaxWithheld: DecimalString;
  socialSecurityEmployee: DecimalString;
  medicareEmployee: DecimalString;
  stateDisabilityEmployee: DecimalString;
  otherDeductions: DecimalString;
  netPay: DecimalString;
  socialSecurityEmployer: DecimalString;
  medicareEmployer: DecimalString;
  federalUnemploymentEmployer: DecimalString;
  stateUnemploymentEmployer: DecimalString;
  stateTrainingTaxEmployer: DecimalString;
  otherEmployerCosts: DecimalString;
  totalEmployerCost: DecimalString;
}

export interface PayrollTotals {
  gross: DecimalString;
  employeeTaxes: DecimalString;
  otherDeductions: DecimalString;
  netPay: DecimalString;
  employerTaxes: DecimalString;
  totalEmployerCost: DecimalString;
}

export interface PayrollRun {
  id: ID;
  periodStart: ISODate;
  periodEnd: ISODate;
  payDate: ISODate;
  currency: CurrencyCode;
  providerRef?: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "RECONCILED" | "EXCEPTION";
  lines: PayrollLine[];
  totals: PayrollTotals;
  journalEntryId?: ID;
  netPayTransactionIds: ID[];
  /** Rates used for synthetic withholding. Labelled synthetic; never authoritative. */
  rateAssumptionSetId?: ID;
  reconciliation?: {
    status: "MATCHED" | "VARIANCE" | "UNRECONCILED";
    varianceAmount?: DecimalString;
    notes?: string[];
  };
}

export type PayrollLiabilityKind =
  | "FEDERAL_WITHHOLDING_AND_FICA"
  | "FEDERAL_UNEMPLOYMENT"
  | "STATE_WITHHOLDING_AND_SDI"
  | "STATE_UNEMPLOYMENT_AND_ETT"
  | "OTHER";

export interface PayrollLiability {
  id: ID;
  payrollRunId: ID;
  kind: PayrollLiabilityKind;
  amount: DecimalString;
  currency: CurrencyCode;
  accruedDate: ISODate;
  dueDate: ISODate | null;
  status: "ACCRUED" | "PAID" | "UNKNOWN";
  paidTransactionId?: ID;
  glAccountId: ID;
  dueDateSourceRuleId?: ID;
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export type Jurisdiction = "FEDERAL" | "CALIFORNIA" | "OTHER_STATE" | "CHINA" | "OTHER";

export interface TaxObligation {
  id: ID;
  jurisdiction: Jurisdiction;
  kind: string; // e.g. "FORM_1120S", "CA_FORM_100S", "FORM_941", "CA_DE9", "ESTIMATED_TAX", "CA_LLC_FEE", "1099_NEC"
  title: string;
  description: string;
  taxYear: number;
  periodLabel?: string;
  dueDate: ISODate | null;
  amount: DecimalString | null;
  currency: CurrencyCode;
  status: "UPCOMING" | "DUE" | "PAID" | "FILED" | "UNKNOWN" | "NOT_APPLICABLE_PENDING_REVIEW";
  ruleSourceId?: ID;
  requiresCpaReview: boolean;
  documentIds: ID[];
  workpaperId?: ID;
  notes?: string[];
}

export interface TaxRule {
  id: ID;
  jurisdiction: Jurisdiction;
  taxYear: number | null;
  key: string;
  title: string;
  normalizedRule: string;
  /** Machine-usable parameters when the rule is a rate/limit/date; absent when unknown. */
  parameters?: Record<string, string | number | boolean | null>;
  sourceId: ID;
  status: "CURRENT" | "STALE" | "PENDING_RETRIEVAL" | "SUPERSEDED" | "PROFESSIONAL_REVIEW_REQUIRED";
  confidence: number;
  effectiveDate?: ISODate;
  reviewBy: ISODate;
  approvedBy?: string;
}

export interface TaxWorkpaper {
  id: ID;
  title: string;
  taxYear: number;
  jurisdiction: Jurisdiction;
  obligationId?: ID;
  facts: { label: string; value: unknown; sourceIds: ID[] }[];
  calculations: ID[]; // CalcResult ids
  assumptions: Assumption[];
  professionalJudgmentItems: string[];
  confidence: number;
  cpaReviewRequired: boolean;
  cpaReviewStatus: "NOT_REQUESTED" | "REQUESTED" | "REVIEWED" | "REJECTED";
  createdAt: ISODateTime;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Assets & documents
// ---------------------------------------------------------------------------

export interface FixedAsset {
  id: ID;
  name: string;
  acquiredDate: ISODate;
  cost: DecimalString;
  salvageValue: DecimalString;
  usefulLifeMonths: number;
  method: "STRAIGHT_LINE";
  assetAccountId: ID;
  accumulatedDepreciationAccountId: ID;
  depreciationExpenseAccountId: ID;
  inServiceDate: ISODate;
  disposedDate?: ISODate;
  sourceTransactionId?: ID;
  documentId?: ID;
  /** Tax depreciation treatment is a professional judgment; book uses straight-line. */
  taxTreatmentStatus: FieldStatus;
}

export type DocumentKind =
  | "RECEIPT"
  | "CUSTOMER_INVOICE"
  | "VENDOR_BILL"
  | "BANK_STATEMENT"
  | "CARD_STATEMENT"
  | "CONTRACT"
  | "PAYROLL_REPORT"
  | "TAX_NOTICE"
  | "TAX_RETURN"
  | "W9"
  | "W8"
  | "ENTITY_DOCUMENT"
  | "INSURANCE"
  | "CPA_CORRESPONDENCE"
  | "OTHER";

export interface Document {
  id: ID;
  kind: DocumentKind;
  title: string;
  date: ISODate;
  vendorId?: ID;
  customerId?: ID;
  workerId?: ID;
  amount?: DecimalString;
  currency?: CurrencyCode;
  linkedTransactionIds: ID[];
  linkedJournalEntryIds: ID[];
  storagePath: string; // object-storage key; synthetic docs use "synthetic://..."
  mimeType: string;
  extracted?: Record<string, unknown>;
  classificationConfidence: number;
  retention: { policyKey: string; retainUntil: ISODate | null };
  isSynthetic: boolean;
  tags: string[];
  uploadedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface BudgetLine {
  accountId: ID;
  month: string; // YYYY-MM
  amount: DecimalString;
  driverKey?: string;
  note?: string;
}

export interface Budget {
  id: ID;
  name: string;
  fiscalYear: number;
  version: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  lines: BudgetLine[];
  assumptions: Assumption[];
  approvedBy?: string;
  approvedAt?: ISODateTime;
  createdAt: ISODateTime;
}

export interface DriverAssumption {
  key: string;
  label: string;
  value: DecimalString | number;
  unit: string;
  status: FieldStatus;
  sourceId?: ID;
  note?: string;
}

export interface ForecastLine {
  accountId: ID;
  month: string; // YYYY-MM
  amount: DecimalString;
  basis: "ACTUAL" | "FORECAST";
  driverKeys?: string[];
}

export interface Forecast {
  id: ID;
  name: string;
  asOfDate: ISODate;
  horizonMonths: number;
  drivers: Record<string, DriverAssumption>;
  lines: ForecastLine[];
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  version: number;
  createdAt: ISODateTime;
  createdBy: string;
  calcIds: ID[];
}

export interface Scenario {
  id: ID;
  name: string;
  description: string;
  baseForecastId: ID;
  driverOverrides: Record<string, DecimalString | number>;
  /** Explicit one-off events e.g. { month, accountId, amount, description } */
  events: { month: string; accountId: ID; amount: DecimalString; description: string }[];
  createdAt: ISODateTime;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Calculations (deterministic engine outputs)
// ---------------------------------------------------------------------------

export type CalcUnit = "USD" | "CURRENCY" | "RATIO" | "PERCENT" | "MONTHS" | "WEEKS" | "DAYS" | "COUNT" | "TABLE" | "OBJECT";

export interface CalcResult<T = unknown> {
  id: ID;
  name: string;
  value: T;
  unit: CalcUnit;
  formula: string;
  inputs: Record<string, unknown>;
  sourceIds: ID[];
  assumptions: Assumption[];
  asOfDate: ISODate;
  notes?: string[];
  /** Deterministic hash of inputs + formula, for audit reproducibility */
  fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Governance: risk, approvals, actions, audit
// ---------------------------------------------------------------------------

export type ActionKind =
  | "CALCULATE"
  | "GENERATE_REPORT"
  | "RUN_RECONCILIATION"
  | "UPDATE_FORECAST"
  | "CATEGORIZE_TRANSACTION"
  | "MATCH_PAYMENT"
  | "FLAG_MISSING_RECEIPT"
  | "CREATE_JOURNAL_ENTRY"
  | "POST_JOURNAL_ENTRY"
  | "REVERSE_JOURNAL_ENTRY"
  | "CREATE_VENDOR"
  | "CREATE_CUSTOMER"
  | "RECORD_BILL"
  | "RECORD_INVOICE"
  | "SCHEDULE_PAYMENT"
  | "EXECUTE_PAYMENT"
  | "REIMBURSEMENT"
  | "PROPOSE_DISTRIBUTION"
  | "RUN_PAYROLL"
  | "CHANGE_PAYROLL"
  | "SET_COMPENSATION_POLICY"
  | "FILE_TAX_RETURN"
  | "PAY_TAX"
  | "RESPOND_TO_TAX_AUTHORITY"
  | "CHANGE_ACCOUNTING_POLICY"
  | "CHANGE_ENTITY"
  | "CLASSIFY_INTERNATIONAL_WORKER"
  | "DELETE_RECORD"
  | "MODIFY_CLOSED_PERIOD"
  | "LOCK_PERIOD"
  | "UNLOCK_PERIOD"
  | "SEND_COLLECTION_REMINDER"
  | "UPDATE_POLICY"
  | "UPDATE_CONFIG"
  | "SIGN_DOCUMENT"
  | "OTHER";

export interface ProposedAction {
  id: ID;
  kind: ActionKind;
  agent: AgentName | "USER";
  description: string;
  amount?: Money;
  targetIds: ID[];
  payload: Record<string, unknown>;
  reason: string;
  financialImpact?: string;
  sourceDocumentIds: ID[];
  confidence: number;
  alternatives?: string[];
  reversible: boolean;
  rollbackPlan?: string;
  createdAt: ISODateTime;
  /** Context flags that affect risk classification */
  context?: {
    isNewCategory?: boolean;
    isNewVendor?: boolean;
    isRecurringApproved?: boolean;
    isPersonalMixed?: boolean;
    isNonStandard?: boolean;
    isMaterialForecastChange?: boolean;
    isNewRecurringExpense?: boolean;
    periodStatus?: PeriodStatus;
    touchesPayroll?: boolean;
    touchesTax?: boolean;
    touchesEquity?: boolean;
    movesMoney?: boolean;
    involvesRelatedParty?: boolean;
  };
}

export interface RiskAssessment {
  actionId: ID;
  level: RiskLevel;
  reasons: string[];
  requiredApproverRoles: Role[];
  materialityBreached: boolean;
  autoExecutable: boolean;
  policyRefs: string[];
  assessedAt: ISODateTime;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "WITHDRAWN";

export interface ApprovalRequest {
  id: ID;
  action: ProposedAction;
  risk: RiskAssessment;
  requestedApproverRoles: Role[];
  status: ApprovalStatus;
  requestedAt: ISODateTime;
  decidedAt?: ISODateTime;
  decidedBy?: string;
  decidedByRole?: Role;
  decisionComment?: string;
  expiresAt?: ISODateTime;
  auditEventIds: ID[];
}

export type AgentActionStatus =
  | "PROPOSED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTED"
  | "SIMULATED"
  | "REJECTED"
  | "BLOCKED"
  | "FAILED"
  | "ROLLED_BACK";

export interface AgentAction {
  id: ID;
  action: ProposedAction;
  risk: RiskAssessment;
  status: AgentActionStatus;
  approvalId?: ID;
  auditEventId?: ID;
  executedAt?: ISODateTime;
  result?: Record<string, unknown>;
  blockedReason?: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  version?: string;
  deterministic: boolean;
}

export interface ToolCallRecord {
  name: string;
  inputHash: string;
  outputHash: string;
  riskLevel: RiskLevel;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface AuditEvent {
  id: ID;
  seq: number;
  timestamp: ISODateTime;
  actor: Actor;
  agent?: AgentName;
  model?: ModelInfo;
  workflowVersion: string;
  promptVersion?: string;
  eventType: string;
  toolsCalled: ToolCallRecord[];
  sourceDocumentIds: ID[];
  calculationIds: ID[];
  proposedActionId?: ID;
  finalAction?: string;
  approvalIds: ID[];
  confidence?: number;
  explanation: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export type KnowledgeLayer = "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "HISTORICAL_DECISION" | "EDUCATION";

export interface KnowledgeSource {
  id: ID;
  layer: KnowledgeLayer;
  title: string;
  url?: string;
  publisher?: string;
  jurisdiction?: Jurisdiction;
  effectiveDate?: ISODate;
  retrievedAt?: ISODateTime;
  taxYear?: number;
  excerpt: string;
  normalizedRule?: string;
  confidence: number;
  reviewBy: ISODate | null;
  status: "CURRENT" | "STALE" | "PENDING_RETRIEVAL" | "SUPERSEDED";
  tags: string[];
  /** Cryptographic hash of the excerpt, to detect drift */
  contentHash?: string;
}

export interface ProfessionalGuidance {
  id: ID;
  authorRole: Role;
  authorName?: string;
  title: string;
  body: string;
  receivedAt: ISODateTime;
  approvedAt?: ISODateTime;
  approvedBy?: string;
  appliesTo: string[]; // policy keys / topics
  status: "PENDING_APPROVAL" | "ACTIVE" | "SUPERSEDED" | "REJECTED";
  supersedesId?: ID;
  documentId?: ID;
}

export interface Policy {
  id: ID;
  key: string;
  title: string;
  body: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  effectiveDate: ISODate;
  approvedBy?: string;
  sourceGuidanceId?: ID;
  parameters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Academy / evaluation
// ---------------------------------------------------------------------------

export type CompetencyDomain =
  | "ACCOUNTING_FOUNDATIONS"
  | "ADVANCED_ACCOUNTING"
  | "FINANCIAL_STATEMENT_ANALYSIS"
  | "FPA"
  | "CASH_MANAGEMENT"
  | "CORPORATE_FINANCE"
  | "VALUATION"
  | "TAX_OPERATIONS"
  | "PAYROLL_WORKFORCE"
  | "AP_AR"
  | "FINANCIAL_CONTROLS"
  | "CFO_STRATEGY";

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface EvalMetrics {
  exactCalculationAccuracy: number;
  reconciliationAccuracy: number;
  classificationAccuracy: number;
  hallucinationRate: number;
  unsupportedSourceRate: number;
  escalationAccuracy: number;
  falseActionRate: number;
  toolSelectionAccuracy: number;
  statementReconciliationRate: number;
  varianceExplanationQuality: number;
}

export interface CompetencyScore {
  capabilityKey: string;
  domain: CompetencyDomain;
  label: string;
  currentLevel: AutonomyLevel;
  maxAllowedLevel: AutonomyLevel;
  passRate: number;
  metrics: Partial<EvalMetrics>;
  evaluationCount: number;
  consecutivePassingRuns: number;
  lastTestedAt?: ISODateTime;
  failureCaseIds: ID[];
  promotionEligible: boolean;
  promotionBlockers: string[];
}

export interface EvaluationRecord {
  id: ID;
  runId: ID;
  caseId: ID;
  domain: CompetencyDomain;
  competency: string;
  capabilityKey: string;
  agent: AgentName;
  passed: boolean;
  score: number;
  failures: string[];
  expectedSummary: string;
  actualSummary: string;
  model: ModelInfo;
  durationMs: number;
  ranAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// Aggregate dataset (what a store holds)
// ---------------------------------------------------------------------------

export interface CompanyProfile {
  id: ID;
  displayName: string;
  isSynthetic: boolean;
  entityType: ConfigField<string>;
  taxElection: ConfigField<string>;
  state: ConfigField<string>;
  fiscalYearEnd: ConfigField<string>;
  accountingMethod: ConfigField<"CASH" | "ACCRUAL">;
  functionalCurrency: CurrencyCode;
  asOfDate: ISODate;
}

export interface CompanyDataset {
  profile: CompanyProfile;
  accounts: Account[];
  periods: Period[];
  journalEntries: JournalEntry[];
  bankAccounts: BankAccount[];
  cards: Card[];
  transactions: Transaction[];
  vendors: Vendor[];
  customers: Customer[];
  invoices: Invoice[];
  bills: Bill[];
  payments: Payment[];
  workers: Worker[];
  payrollRuns: PayrollRun[];
  payrollLiabilities: PayrollLiability[];
  taxObligations: TaxObligation[];
  taxRules: TaxRule[];
  taxWorkpapers: TaxWorkpaper[];
  fixedAssets: FixedAsset[];
  documents: Document[];
  budgets: Budget[];
  forecasts: Forecast[];
  scenarios: Scenario[];
  approvals: ApprovalRequest[];
  agentActions: AgentAction[];
  auditEvents: AuditEvent[];
  policies: Policy[];
  knowledgeSources: KnowledgeSource[];
  professionalGuidance: ProfessionalGuidance[];
  configFields: ConfigField[];
  evaluations: EvaluationRecord[];
  competencyScores: CompetencyScore[];
  calculations: CalcResult[];
}

export type CollectionName = Exclude<keyof CompanyDataset, "profile">;

export function emptyDataset(profile: CompanyProfile): CompanyDataset {
  return {
    profile,
    accounts: [],
    periods: [],
    journalEntries: [],
    bankAccounts: [],
    cards: [],
    transactions: [],
    vendors: [],
    customers: [],
    invoices: [],
    bills: [],
    payments: [],
    workers: [],
    payrollRuns: [],
    payrollLiabilities: [],
    taxObligations: [],
    taxRules: [],
    taxWorkpapers: [],
    fixedAssets: [],
    documents: [],
    budgets: [],
    forecasts: [],
    scenarios: [],
    approvals: [],
    agentActions: [],
    auditEvents: [],
    policies: [],
    knowledgeSources: [],
    professionalGuidance: [],
    configFields: [],
    evaluations: [],
    competencyScores: [],
    calculations: [],
  };
}
