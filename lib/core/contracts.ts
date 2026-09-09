/**
 * Cross-subsystem interfaces. Implementations live in their own folders;
 * everything else programs against these contracts.
 */
import type { z } from "zod";
import type {
  Account,
  Actor,
  AgentAction,
  AgentName,
  ApprovalRequest,
  Assumption,
  AuditEvent,
  AutonomyLevel,
  CalcResult,
  CollectionName,
  CompanyDataset,
  CompetencyDomain,
  ConfigField,
  DecimalString,
  ID,
  ISODate,
  ISODateTime,
  JournalEntry,
  JournalSource,
  ModelInfo,
  Period,
  ProposedAction,
  RiskAssessment,
  RiskLevel,
  Role,
  ToolCallRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export type Entity<K extends CollectionName> = CompanyDataset[K][number];

export interface DataStore {
  readonly kind: "memory" | "postgres";
  /** Load (or return the already-loaded) live dataset. Engines mutate this object and call upsert/persist. */
  load(): Promise<CompanyDataset>;
  upsert<K extends CollectionName>(collection: K, entity: Entity<K>): Promise<void>;
  upsertMany<K extends CollectionName>(collection: K, entities: Entity<K>[]): Promise<void>;
  /** Audit events are append-only; implementations must reject updates. */
  appendAudit(event: AuditEvent): Promise<void>;
  /** Replace the entire dataset (seeding / reset). Audit history is retained by postgres implementations. */
  reset(dataset: CompanyDataset): Promise<void>;
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ledger (accounting engine)
// ---------------------------------------------------------------------------

export interface NewJournalLineInput {
  accountId?: ID;
  accountCode?: string;
  debit?: DecimalString | number;
  credit?: DecimalString | number;
  memo?: string;
  entityRef?: JournalEntry["lines"][number]["entityRef"];
}

export interface NewJournalEntryInput {
  date: ISODate;
  description: string;
  memo?: string;
  source: JournalSource;
  lines: NewJournalLineInput[];
  sourceIds?: ID[];
  tags?: string[];
  /** Post immediately (default false → DRAFT). Posting into locked periods is always rejected. */
  post?: boolean;
  approvalId?: ID;
  id?: ID;
}

export interface TrialBalanceRow {
  accountId: ID;
  code: string;
  name: string;
  type: Account["type"];
  subtype: Account["subtype"];
  debit: DecimalString;
  credit: DecimalString;
  balance: DecimalString; // signed in normal-balance convention (positive = normal)
}

export interface TrialBalance {
  asOfDate: ISODate;
  fromDate?: ISODate;
  rows: TrialBalanceRow[];
  totalDebits: DecimalString;
  totalCredits: DecimalString;
  balanced: boolean;
}

export interface StatementLine {
  accountId?: ID;
  code?: string;
  label: string;
  amount: DecimalString;
  level: number;
  isTotal?: boolean;
  sourceAccountIds?: ID[];
}

export interface IncomeStatement {
  kind: "INCOME_STATEMENT";
  fromDate: ISODate;
  toDate: ISODate;
  lines: StatementLine[];
  revenue: DecimalString;
  costOfRevenue: DecimalString;
  grossProfit: DecimalString;
  operatingExpenses: DecimalString;
  operatingIncome: DecimalString;
  otherIncomeExpense: DecimalString;
  netIncome: DecimalString;
  calcIds: ID[];
}

export interface BalanceSheet {
  kind: "BALANCE_SHEET";
  asOfDate: ISODate;
  lines: StatementLine[];
  totalAssets: DecimalString;
  totalLiabilities: DecimalString;
  totalEquity: DecimalString;
  currentAssets: DecimalString;
  currentLiabilities: DecimalString;
  cash: DecimalString;
  /** Net income not yet closed to retained earnings (current-year earnings) */
  currentYearEarnings: DecimalString;
  balanced: boolean;
  difference: DecimalString;
}

export interface CashFlowStatement {
  kind: "CASH_FLOW_STATEMENT";
  fromDate: ISODate;
  toDate: ISODate;
  method: "INDIRECT";
  netIncome: DecimalString;
  operatingAdjustments: StatementLine[];
  operating: DecimalString;
  investingLines: StatementLine[];
  investing: DecimalString;
  financingLines: StatementLine[];
  financing: DecimalString;
  netChange: DecimalString;
  openingCash: DecimalString;
  closingCash: DecimalString;
  /** opening + netChange == closingCash (from the balance sheet) */
  reconciled: boolean;
  difference: DecimalString;
}

export interface IntegrityCheck {
  key: string;
  label: string;
  passed: boolean;
  details?: string;
  severity: "ERROR" | "WARNING";
}

export interface IntegrityReport {
  asOfDate: ISODate;
  checks: IntegrityCheck[];
  passed: boolean;
}

export interface LedgerEngine {
  readonly dataset: CompanyDataset;
  getAccount(idOrCode: string): Account | undefined;
  requireAccount(idOrCode: string): Account;
  getPeriod(date: ISODate): Period;
  ensurePeriod(date: ISODate): Period;
  createEntry(input: NewJournalEntryInput, actor: Actor): JournalEntry;
  postEntry(entryId: ID, actor: Actor, approvalId?: ID): JournalEntry;
  reverseEntry(entryId: ID, reversalDate: ISODate, actor: Actor, reason: string, approvalId?: ID): JournalEntry;
  voidDraft(entryId: ID, actor: Actor): JournalEntry;
  accountBalance(accountId: ID, asOf: ISODate, from?: ISODate): DecimalString;
  trialBalance(asOf: ISODate, from?: ISODate): TrialBalance;
  incomeStatement(from: ISODate, to: ISODate): IncomeStatement;
  balanceSheet(asOf: ISODate): BalanceSheet;
  cashFlowStatement(from: ISODate, to: ISODate): CashFlowStatement;
  runIntegrityChecks(asOf: ISODate): IntegrityReport;
  lockPeriod(periodId: ID, actor: Actor, approvalId: ID): Period;
  unlockPeriod(periodId: ID, actor: Actor, approvalId: ID, reason: string): Period;
  softClosePeriod(periodId: ID, actor: Actor): Period;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export interface MaterialityThresholds {
  /** Single transaction amount above which YELLOW is forced */
  transactionReviewAmount: DecimalString;
  /** Single action amount above which RED is forced regardless of kind */
  redAmount: DecimalString;
  /** Forecast change (absolute $) considered material */
  forecastChangeAmount: DecimalString;
  /** Forecast change (ratio) considered material */
  forecastChangeRatio: number;
  /** Variance % considered material for budget vs actual */
  varianceRatio: number;
  /** Minimum cash reserve policy (null = unknown/unconfirmed) */
  minimumCashReserve: DecimalString | null;
  status: ConfigField["status"];
}

export interface RiskEngine {
  assess(action: ProposedAction, ctx: { thresholds: MaterialityThresholds; capabilityLevel?: AutonomyLevel }): RiskAssessment;
}

export interface ApprovalEngine {
  request(action: ProposedAction, risk: RiskAssessment, requestedBy: Actor): Promise<ApprovalRequest>;
  decide(approvalId: ID, decision: "APPROVED" | "REJECTED", actor: Actor, comment?: string): Promise<ApprovalRequest>;
  get(approvalId: ID): ApprovalRequest | undefined;
  pending(): ApprovalRequest[];
  /** True when the action may execute now (GREEN and auto-executable, or an APPROVED approval exists). */
  canExecute(action: ProposedAction, risk: RiskAssessment, approvalId?: ID): { allowed: boolean; reason: string };
}

export interface AuditLogInput {
  actor: Actor;
  agent?: AgentName;
  model?: ModelInfo;
  workflowVersion: string;
  promptVersion?: string;
  eventType: string;
  toolsCalled?: ToolCallRecord[];
  sourceDocumentIds?: ID[];
  calculationIds?: ID[];
  proposedActionId?: ID;
  finalAction?: string;
  approvalIds?: ID[];
  confidence?: number;
  explanation: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
}

export interface AuditLog {
  record(input: AuditLogInput): Promise<AuditEvent>;
  list(filter?: { agent?: AgentName; eventType?: string; since?: ISODateTime; limit?: number }): AuditEvent[];
  verifyChain(): { valid: boolean; brokenAtSeq?: number; count: number };
}

export interface CapabilityMatrix {
  getLevel(capabilityKey: string): AutonomyLevel;
  setLevel(capabilityKey: string, level: AutonomyLevel, actor: Actor, reason: string): void;
  list(): { capabilityKey: string; domain: CompetencyDomain; level: AutonomyLevel; label: string }[];
  /** Whether an agent may perform this action kind autonomously at its current level */
  mayAutoExecute(capabilityKey: string, risk: RiskLevel): boolean;
}

// ---------------------------------------------------------------------------
// Models (provider-agnostic)
// ---------------------------------------------------------------------------

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools?: ModelToolSpec[];
  /** When set, the model must return JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  metadata?: Record<string, string>;
}

export interface ModelToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  json?: unknown;
  toolCalls: ModelToolCall[];
  model: ModelInfo;
  usage?: { inputTokens: number; outputTokens: number };
  stopReason: "end" | "tool_use" | "max_tokens" | "refusal" | "error";
  latencyMs: number;
}

export interface ReasoningModel {
  readonly info: ModelInfo;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export interface ClassifyRequest {
  text: string;
  labels: { key: string; description?: string }[];
  context?: Record<string, unknown>;
}
export interface ClassifyResponse {
  label: string | null;
  confidence: number;
  reason: string;
  model: ModelInfo;
}
export interface FastClassificationModel {
  readonly info: ModelInfo;
  classify(req: ClassifyRequest): Promise<ClassifyResponse>;
  extract<T>(text: string, schema: z.ZodType<T>, instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }>;
}

export interface VerificationRequest {
  claim: string;
  evidence: { label: string; content: string }[];
  numbersToCheck?: { label: string; claimed: string; computed: string }[];
}
export interface VerificationResponse {
  verdict: "SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
  issues: string[];
  confidence: number;
  model: ModelInfo;
}
export interface VerificationModel {
  readonly info: ModelInfo;
  verify(req: VerificationRequest): Promise<VerificationResponse>;
}

export interface EmbeddingProvider {
  readonly info: ModelInfo;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ModelRegistry {
  reasoning: ReasoningModel;
  fast: FastClassificationModel;
  verification: VerificationModel;
  embedding: EmbeddingProvider;
  describe(): { reasoning: ModelInfo; fast: ModelInfo; verification: ModelInfo; embedding: ModelInfo; provider: string };
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface RetrievalDoc {
  id: ID;
  layer: "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "HISTORICAL_DECISION" | "EDUCATION" | "DOCUMENT" | "FINANCIAL_RECORD";
  title: string;
  text: string;
  tags: string[];
  metadata: Record<string, unknown>;
  status?: "CURRENT" | "STALE" | "PENDING_RETRIEVAL" | "SUPERSEDED";
}

export interface RetrievalHit {
  doc: RetrievalDoc;
  score: number;
  snippet: string;
  provenance: { sourceId: ID; layer: RetrievalDoc["layer"]; title: string; url?: string; status?: RetrievalDoc["status"] };
}

export interface Retriever {
  index(docs: RetrievalDoc[]): Promise<void>;
  search(query: string, opts?: { k?: number; layers?: RetrievalDoc["layer"][]; tags?: string[] }): Promise<RetrievalHit[]>;
  size(): number;
}

// ---------------------------------------------------------------------------
// Agents & tools
// ---------------------------------------------------------------------------

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  calcs?: CalcResult[];
  sourceIds?: ID[];
  assumptions?: Assumption[];
  error?: string;
  /** Actions the tool wants to take that require the governance pipeline */
  proposedActions?: ProposedAction[];
}

export interface ToolContext {
  dataset: CompanyDataset;
  store: DataStore;
  ledger: LedgerEngine;
  audit: AuditLog;
  risk: RiskEngine;
  approvals: ApprovalEngine;
  capabilities: CapabilityMatrix;
  models: ModelRegistry;
  retriever: Retriever;
  thresholds: MaterialityThresholds;
  actor: Actor;
  asOfDate: ISODate;
  agent: AgentName;
  /** Lab flag: when true, nothing may leave the system (no payments, no filings). Always true in Phase One. */
  simulationOnly: true;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  /** Capability key used for the competency matrix */
  capabilityKey: string;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

export type EscalationType =
  | "INSUFFICIENT_INFORMATION"
  | "CPA_REVIEW_REQUIRED"
  | "CANNOT_CLASSIFY"
  | "APPROVAL_REQUIRED"
  | "PROFESSIONAL_REVIEW_REQUIRED"
  | "REFUSED_CONTROL_VIOLATION"
  | "OUT_OF_SCOPE";

export interface Escalation {
  type: EscalationType;
  message: string;
  requiredRole?: Role;
  missingItems?: string[];
  relatedConfigKeys?: string[];
}

export interface KeyFigure {
  label: string;
  value: string;
  calcId?: ID;
  note?: string;
}

export interface SourceRef {
  id: ID;
  kind: "DOCUMENT" | "TRANSACTION" | "JOURNAL_ENTRY" | "CALCULATION" | "KNOWLEDGE" | "POLICY" | "CONFIG" | "GUIDANCE" | "TAX_RULE" | "OTHER";
  label: string;
  status?: string;
  url?: string;
}

export interface HighRiskBreakdown {
  facts: string[];
  calculations: string[];
  assumptions: string[];
  professionalJudgment: string[];
}

export interface ExecutiveResponse {
  answer: string;
  numbers: KeyFigure[];
  why: string[];
  whatChanges: string[];
  risks: string[];
  recommendation: string;
  needsApproval: { actionId: ID; description: string; approverRoles: Role[]; riskLevel: RiskLevel }[];
  sourcesAndAssumptions: string[];
  education?: { title: string; text: string };
  /** Mandatory for high-risk questions */
  highRisk?: HighRiskBreakdown;
}

export interface AgentRequest {
  message: string;
  /** Structured task submitted by a UI form or an eval case; takes precedence over NL parsing when present. */
  task?: { kind: string; params?: Record<string, unknown> };
  conversationId?: ID;
  actor: Actor;
  asOfDate?: ISODate;
  /** Hint from orchestrator about which agent should handle */
  targetAgent?: AgentName;
}

export interface AgentResponse {
  agent: AgentName;
  delegatedTo?: AgentName[];
  intent: string;
  response: ExecutiveResponse;
  toolCalls: ToolCallRecord[];
  calculations: CalcResult[];
  sources: SourceRef[];
  assumptions: Assumption[];
  escalation?: Escalation;
  proposedActions: ProposedAction[];
  agentActions: AgentAction[];
  confidence: number;
  auditEventId: ID;
  model: ModelInfo;
  /** Structured payload that eval scorers inspect (numbers, journal entries, classifications) */
  structured: Record<string, unknown>;
  durationMs: number;
}

export interface Agent {
  readonly name: AgentName;
  readonly description: string;
  readonly tools: Tool[];
  handle(req: AgentRequest, ctx: ToolContext): Promise<AgentResponse>;
  /** Returns 0..1 how confident this agent is that it should handle the request (used for routing). */
  canHandle(req: AgentRequest): number;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type EvalDirectory =
  | "accounting"
  | "fpa"
  | "cash"
  | "tax"
  | "payroll"
  | "ap_ar"
  | "strategy"
  | "compliance"
  | "adversarial";

export interface ExpectedNumber {
  path: string; // dotted path into AgentResponse.structured
  value: DecimalString | number;
  tolerance?: DecimalString | number;
  relativeTolerance?: number;
}

export interface ExpectedJournalLine {
  accountCode: string;
  debit?: DecimalString | number;
  credit?: DecimalString | number;
}

export interface RubricItem {
  key: string;
  description: string;
  weight: number;
  /** machine scorer key; "manual" items are reported but not auto-scored */
  scorer: "number" | "journal" | "escalation" | "prohibited" | "source" | "text_includes" | "text_excludes" | "structured_equals" | "risk_level" | "no_action_executed" | "manual";
  params?: Record<string, unknown>;
}

export interface EvalCase {
  id: ID;
  directory: EvalDirectory;
  domain: CompetencyDomain;
  competency: string;
  capabilityKey: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  title: string;
  scenario: string;
  request: { message: string; task?: AgentRequest["task"]; actorRole?: Role; targetAgent?: AgentName };
  /** "synthetic-default" uses the shared lab company; otherwise a named fixture */
  fixture: "synthetic-default" | "empty" | string;
  sourceDocumentIds?: ID[];
  expected: {
    numbers?: ExpectedNumber[];
    journalEntry?: { lines: ExpectedJournalLine[]; mustBalance: true };
    escalation?: EscalationType | null;
    prohibitedActions?: string[];
    requiredSourceLayer?: "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "ANY";
    riskLevel?: RiskLevel;
    mustInclude?: string[];
    mustNotInclude?: string[];
    structured?: Record<string, unknown>;
    noActionExecuted?: boolean;
  };
  rubric: RubricItem[];
  tags: string[];
  generatedFrom?: string;
}

export interface EvalCaseResult {
  caseId: ID;
  passed: boolean;
  score: number; // 0..1 weighted rubric
  rubricResults: { key: string; passed: boolean; weight: number; detail: string }[];
  failures: string[];
  agent: AgentName;
  durationMs: number;
  actualSummary: string;
  expectedSummary: string;
  escalation?: EscalationType;
  executedActions: number;
}

export interface EvalRunSummary {
  runId: ID;
  ranAt: ISODateTime;
  model: ModelInfo;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byDirectory: Record<string, { total: number; passed: number; passRate: number }>;
  byDomain: Record<string, { total: number; passed: number; passRate: number }>;
  byCapability: Record<string, { total: number; passed: number; passRate: number; failureCaseIds: ID[] }>;
  metrics: Record<string, number>;
  failedCaseIds: ID[];
  durationMs: number;
}
