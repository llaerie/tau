/**
 * Tiny hand-built dataset that touches every collection in CompanyDataset. Used to exercise the
 * mappers (no DB) and the PrismaStore round-trip (DB). Values are deliberately awkward: 4-dp
 * decimals, large magnitudes, negatives, nulls-that-mean-unknown, nested JSON.
 *
 * Conventions that make the round-trip exact: timestamps use millisecond ISO form (`.000Z`),
 * decimals are canonical 4-dp strings, optional array fields are written as `[]` not omitted.
 */
import type { AuditEvent, CompanyDataset, JournalEntry, ProposedAction, RiskAssessment } from "@/lib/core/types";
import { emptyDataset } from "@/lib/core/types";

export const ACC = {
  cash: "acct_1000",
  ar: "acct_1100",
  ap: "acct_2000",
  equity: "acct_3000",
  revenue: "acct_4000",
  software: "acct_7300",
} as const;

export function makeJournalEntries(): JournalEntry[] {
  return [
    {
      id: "je_0001",
      entryNumber: 1,
      date: "2026-01-01",
      periodId: "2026-01",
      description: "Opening balance",
      status: "POSTED",
      source: "OPENING_BALANCE",
      lines: [
        { id: "jl_0001_1", accountId: ACC.cash, debit: "123456789012.3456", credit: "0.0000", currency: "USD" },
        { id: "jl_0001_2", accountId: ACC.equity, debit: "0.0000", credit: "123456789012.3456", currency: "USD", memo: "owner capital" },
      ],
      sourceIds: [],
      createdBy: "system",
      createdAt: "2026-01-01T00:00:00.000Z",
      postedAt: "2026-01-01T00:00:01.000Z",
      tags: ["opening"],
    },
    {
      id: "je_0002",
      entryNumber: 2,
      date: "2026-02-14",
      periodId: "2026-02",
      description: "SaaS subscription",
      memo: "monthly",
      status: "DRAFT",
      source: "CARD_IMPORT",
      lines: [
        {
          id: "jl_0002_1",
          accountId: ACC.software,
          debit: "49.9900",
          credit: "0.0000",
          currency: "USD",
          entityRef: { type: "VENDOR", id: "vendor_saas" },
        },
        { id: "jl_0002_2", accountId: ACC.ap, debit: "0.0000", credit: "49.9800", currency: "USD" },
        { id: "jl_0002_3", accountId: ACC.ap, debit: "0.0000", credit: "0.0100", currency: "USD", memo: "rounding" },
      ],
      sourceIds: ["txn_0002"],
      createdBy: "agent:bookkeeping",
      createdAt: "2026-02-14T09:30:00.000Z",
      tags: [],
    },
  ];
}

const action: ProposedAction = {
  id: "act_0001",
  kind: "CATEGORIZE_TRANSACTION",
  agent: "bookkeeping",
  description: "Categorize SaaS charge",
  amount: { amount: "49.9900", currency: "USD" },
  targetIds: ["txn_0002"],
  payload: { accountId: ACC.software },
  reason: "Recurring vendor",
  sourceDocumentIds: [],
  confidence: 0.92,
  reversible: true,
  createdAt: "2026-02-14T09:31:00.000Z",
  context: { isRecurringApproved: true },
};
const risk: RiskAssessment = {
  actionId: "act_0001",
  level: "GREEN",
  reasons: ["recurring approved vendor"],
  requiredApproverRoles: [],
  materialityBreached: false,
  autoExecutable: true,
  policyRefs: ["policy_categorization_v1"],
  assessedAt: "2026-02-14T09:31:00.000Z",
};

export function makeAuditEvent(seq: number, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `aud_${String(seq).padStart(4, "0")}`,
    seq,
    timestamp: "2026-02-14T09:31:05.000Z",
    actor: { type: "AGENT", id: "bookkeeping", role: "AGENT", displayName: "Bookkeeping Agent" },
    agent: "bookkeeping",
    model: { provider: "local", model: "deterministic", deterministic: true },
    workflowVersion: "1.0.0",
    eventType: "ACTION_PROPOSED",
    toolsCalled: [{ name: "categorize", inputHash: "in1", outputHash: "out1", riskLevel: "GREEN", durationMs: 3, ok: true }],
    sourceDocumentIds: [],
    calculationIds: ["calc_0001"],
    proposedActionId: "act_0001",
    approvalIds: [],
    confidence: 0.92,
    explanation: "Proposed categorization",
    beforeState: { status: "UNCATEGORIZED" },
    afterState: { status: "SUGGESTED" },
    previousHash: seq === 1 ? "GENESIS" : `hash_${String(seq - 1).padStart(4, "0")}`,
    hash: `hash_${String(seq).padStart(4, "0")}`,
    ...overrides,
  };
}

export function makeTinyDataset(): CompanyDataset {
  const ds = emptyDataset({
    id: "co_tiny",
    displayName: "Tiny Synthetic Co",
    isSynthetic: true,
    entityType: { key: "entityType", section: "entity", label: "Entity type", value: "S_CORP", status: "CONFIRMED", synthetic: true },
    taxElection: { key: "taxElection", section: "entity", label: "Tax election", value: null, status: "UNCONFIRMED" },
    state: { key: "state", section: "entity", label: "State", value: "CA", status: "CONFIRMED", synthetic: true },
    fiscalYearEnd: { key: "fye", section: "entity", label: "Fiscal year end", value: "12-31", status: "CONFIRMED" },
    accountingMethod: { key: "method", section: "accounting", label: "Method", value: "ACCRUAL", status: "CONFIRMED" },
    functionalCurrency: "USD",
    asOfDate: "2026-06-30",
  });

  ds.accounts = [
    { id: ACC.cash, code: "1000", name: "Operating Checking", type: "ASSET", subtype: "CASH", normalBalance: "DEBIT", cashFlowSection: "CASH", isActive: true },
    { id: ACC.ar, code: "1100", name: "Accounts Receivable", type: "ASSET", subtype: "ACCOUNTS_RECEIVABLE", normalBalance: "DEBIT", cashFlowSection: "OPERATING", isActive: true },
    { id: ACC.ap, code: "2000", name: "Accounts Payable", type: "LIABILITY", subtype: "ACCOUNTS_PAYABLE", normalBalance: "CREDIT", cashFlowSection: "OPERATING", isActive: true },
    { id: ACC.equity, code: "3000", name: "Owner Equity", type: "EQUITY", subtype: "OWNER_EQUITY", normalBalance: "CREDIT", cashFlowSection: "FINANCING", isActive: true, restricted: true, description: "Contributions" },
    { id: ACC.revenue, code: "4000", name: "Service Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE", normalBalance: "CREDIT", isActive: true },
    { id: ACC.software, code: "7300", name: "Software", type: "EXPENSE", subtype: "OPERATING_EXPENSE", normalBalance: "DEBIT", isActive: true, parentId: undefined },
  ].map((a) => JSON.parse(JSON.stringify(a)));

  ds.periods = [
    { id: "2026-01", year: 2026, month: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "LOCKED", lockedAt: "2026-02-05T18:00:00.000Z", lockedBy: "owner", lockApprovalId: "apr_0001", tags: ["locked-by:owner"] },
    { id: "2026-02", year: 2026, month: 2, startDate: "2026-02-01", endDate: "2026-02-28", status: "OPEN", tags: [] },
  ];

  ds.journalEntries = makeJournalEntries();

  ds.bankAccounts = [{ id: "bank_checking", name: "Operating Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "1234", currency: "USD", glAccountId: ACC.cash, isSynthetic: true, openedDate: "2024-03-15" }];
  ds.cards = [{ id: "card_main", name: "Business Card", issuer: "Synthetic Card Co", last4: "9876", currency: "USD", glAccountId: ACC.ap, isSynthetic: true, statementCloseDay: 25, paymentDueDay: 20 }];

  ds.transactions = [
    {
      id: "txn_0001",
      sourceKind: "BANK",
      sourceAccountId: "bank_checking",
      externalId: "ext-1",
      date: "2026-01-15",
      postedDate: "2026-01-16",
      amount: "1500.0000",
      currency: "USD",
      descriptionRaw: "ACH CREDIT ACME",
      counterpartyRef: { type: "CUSTOMER", id: "cust_acme" },
      category: { accountId: ACC.ar, status: "APPROVED", confidence: 1, suggestedBy: "RULE", approvedBy: "owner" },
      documentIds: ["doc_0001"],
      flags: [],
      importBatchId: "batch_1",
    },
    {
      id: "txn_0002",
      sourceKind: "CARD",
      sourceAccountId: "card_main",
      externalId: "ext-2",
      date: "2026-02-14",
      postedDate: "2026-02-14",
      amount: "-49.9900",
      currency: "USD",
      descriptionRaw: "SAAS*SUBSCRIPTION",
      merchantNormalized: "SaaS Co",
      category: {
        accountId: null,
        status: "SUGGESTED",
        confidence: 0.92,
        reason: "recurring",
        suggestedBy: "bookkeeping",
        splits: [{ accountId: ACC.software, amount: "49.9900", memo: "all" }],
      },
      journalEntryId: "je_0002",
      documentIds: [],
      flags: ["MISSING_RECEIPT", "NEW_MERCHANT"],
      importBatchId: "batch_2",
      meta: { groundTruthAccount: ACC.software, nested: { ok: true, n: 1.5 } },
    },
  ];

  ds.vendors = [{ id: "vendor_saas", name: "SaaS Co", normalizedNames: ["saas co", "saas*subscription"], defaultAccountId: ACC.software, paymentTermsDays: 0, isRecurring: true, category: "software", country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2025-12-01T00:00:00.000Z" }];
  ds.customers = [{ id: "cust_acme", name: "Acme LLC", paymentTermsDays: 30, country: "US", relatedParty: false, active: true }];
  ds.invoices = [
    {
      id: "inv_0001",
      number: "INV-1001",
      customerId: "cust_acme",
      issueDate: "2026-01-05",
      dueDate: "2026-02-04",
      servicePeriodStart: "2026-01-01",
      servicePeriodEnd: "2026-01-31",
      currency: "USD",
      total: "1500.0000",
      amountPaid: "1500.0000",
      status: "PAID",
      lines: [
        { id: "il_0001_1", description: "Consulting", quantity: "10.0000", unitPrice: "125.0000", amount: "1250.0000", revenueAccountId: ACC.revenue },
        { id: "il_0001_2", description: "Support", quantity: "1.0000", unitPrice: "250.0000", amount: "250.0000", revenueAccountId: ACC.revenue },
      ],
      paymentIds: ["pay_0001"],
    },
  ];
  ds.bills = [{ id: "bill_0001", vendorId: "vendor_saas", number: "S-77", receivedDate: "2026-02-14", billDate: "2026-02-14", dueDate: "2026-02-14", currency: "USD", total: "49.9900", amountPaid: "0.0000", status: "RECEIVED", expenseAccountId: ACC.software, description: "Feb subscription", paymentIds: [] }];
  ds.payments = [{ id: "pay_0001", direction: "IN", date: "2026-01-15", amount: "1500.0000", currency: "USD", method: "ACH", counterpartyRef: { type: "CUSTOMER", id: "cust_acme" }, applications: [{ targetType: "INVOICE", targetId: "inv_0001", amount: "1500.0000" }], transactionId: "txn_0001" }];

  ds.workers = [
    {
      id: "wrk_owner",
      displayName: "Synthetic Owner",
      roleTitle: "CEO",
      country: "US",
      workerType: "EMPLOYEE",
      classificationStatus: "CONFIRMED",
      compensation: { type: "SALARY", amount: "120000.0000", currency: "USD", period: "ANNUAL", basis: "GROSS", status: "CONFIRMED" },
      startDate: "2024-01-01",
      isOwner: true,
      relatedParty: true,
      relatedPartyNote: "shareholder-employee",
      payMethod: "PAYROLL_PROVIDER",
      documentIds: [],
      isSynthetic: true,
    },
    {
      id: "wrk_cn",
      displayName: "Synthetic Contractor",
      roleTitle: "Engineer",
      country: "CN",
      workerType: "UNRESOLVED",
      classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW",
      compensation: { type: "CONTRACT", amount: "8000.0000", currency: "USD", period: "MONTHLY", basis: "UNKNOWN", status: "UNCONFIRMED", note: "basis not confirmed" },
      startDate: "2025-06-01",
      isOwner: false,
      relatedParty: false,
      documentIds: [],
      internationalReview: {
        status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED",
        fields: [{ key: "w8ben", section: "international", label: "W-8BEN on file", value: null, status: "UNCONFIRMED" }],
        reviewerRole: "CPA",
        notes: ["needs cross-border review"],
      },
      isSynthetic: true,
    },
  ];

  const line = {
    workerId: "wrk_owner",
    gross: "10000.0000",
    federalIncomeTaxWithheld: "1200.0000",
    stateIncomeTaxWithheld: "500.0000",
    socialSecurityEmployee: "620.0000",
    medicareEmployee: "145.0000",
    stateDisabilityEmployee: "110.0000",
    otherDeductions: "0.0000",
    netPay: "7425.0000",
    socialSecurityEmployer: "620.0000",
    medicareEmployer: "145.0000",
    federalUnemploymentEmployer: "42.0000",
    stateUnemploymentEmployer: "238.0000",
    stateTrainingTaxEmployer: "7.0000",
    otherEmployerCosts: "0.0000",
    totalEmployerCost: "11052.0000",
  };
  ds.payrollRuns = [
    {
      id: "pr_2026_01",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      payDate: "2026-01-31",
      currency: "USD",
      providerRef: "SYN-PR-1",
      status: "PAID",
      lines: [line],
      totals: { gross: "10000.0000", employeeTaxes: "2575.0000", otherDeductions: "0.0000", netPay: "7425.0000", employerTaxes: "1052.0000", totalEmployerCost: "11052.0000" },
      journalEntryId: undefined,
      netPayTransactionIds: [],
      rateAssumptionSetId: "rates_synthetic_2026",
      reconciliation: { status: "VARIANCE", varianceAmount: "-0.0100", notes: ["rounding"] },
    },
  ];
  ds.payrollRuns = JSON.parse(JSON.stringify(ds.payrollRuns));
  ds.payrollLiabilities = [{ id: "pl_0001", payrollRunId: "pr_2026_01", kind: "FEDERAL_WITHHOLDING_AND_FICA", amount: "2730.0000", currency: "USD", accruedDate: "2026-01-31", dueDate: null, status: "UNKNOWN", glAccountId: ACC.ap }];

  ds.knowledgeSources = [{ id: "ks_irs_941", layer: "AUTHORITATIVE", title: "IRS Form 941 instructions", url: "https://www.irs.gov/forms-pubs/about-form-941", publisher: "IRS", jurisdiction: "FEDERAL", effectiveDate: "2026-01-01", retrievedAt: "2026-01-10T00:00:00.000Z", taxYear: 2026, excerpt: "File quarterly.", confidence: 0.99, reviewBy: "2026-12-31", status: "CURRENT", tags: ["payroll", "federal"], contentHash: "sha256:abc" }];
  ds.taxRules = [{ id: "rule_941_due", jurisdiction: "FEDERAL", taxYear: 2026, key: "FORM_941_DUE_DATE", title: "941 due dates", normalizedRule: "Last day of month following quarter end", parameters: { q1: "2026-04-30", lateFee: null, applies: true, days: 30 }, sourceId: "ks_irs_941", status: "CURRENT", confidence: 0.98, effectiveDate: "2026-01-01", reviewBy: "2026-12-31" }];
  ds.taxObligations = [{ id: "tax_941_q1", jurisdiction: "FEDERAL", kind: "FORM_941", title: "Form 941 Q1 2026", description: "Quarterly payroll tax return", taxYear: 2026, periodLabel: "Q1", dueDate: null, amount: null, currency: "USD", status: "UNKNOWN", ruleSourceId: "ks_irs_941", requiresCpaReview: true, documentIds: [], notes: ["amount pending payroll reconciliation"] }];
  ds.taxWorkpapers = [{ id: "wp_0001", title: "Q1 941 workpaper", taxYear: 2026, jurisdiction: "FEDERAL", obligationId: "tax_941_q1", facts: [{ label: "Gross wages", value: "10000.0000", sourceIds: ["pr_2026_01"] }], calculations: ["calc_0001"], assumptions: [{ key: "rates", description: "synthetic rates", value: "2026-synthetic", status: "UNCONFIRMED", requiresProfessionalReview: true }], professionalJudgmentItems: ["deposit schedule"], confidence: 0.6, cpaReviewRequired: true, cpaReviewStatus: "REQUESTED", createdAt: "2026-04-02T00:00:00.000Z", createdBy: "agent:tax" }];

  ds.fixedAssets = [{ id: "fa_laptop", name: "Laptop", acquiredDate: "2026-01-10", cost: "2400.0000", salvageValue: "0.0000", usefulLifeMonths: 36, method: "STRAIGHT_LINE", assetAccountId: ACC.cash, accumulatedDepreciationAccountId: ACC.cash, depreciationExpenseAccountId: ACC.software, inServiceDate: "2026-01-10", taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED" }];
  ds.documents = [{ id: "doc_0001", kind: "CUSTOMER_INVOICE", title: "INV-1001.pdf", date: "2026-01-05", customerId: "cust_acme", amount: "1500.0000", currency: "USD", linkedTransactionIds: ["txn_0001"], linkedJournalEntryIds: [], storagePath: "synthetic://docs/inv-1001.pdf", mimeType: "application/pdf", extracted: { total: "1500.0000" }, classificationConfidence: 0.97, retention: { policyKey: "AR_7Y", retainUntil: null }, isSynthetic: true, tags: ["ar"], uploadedAt: "2026-01-05T10:00:00.000Z" }];

  ds.budgets = [{ id: "bud_2026", name: "FY2026 budget", fiscalYear: 2026, version: 1, status: "APPROVED", lines: [{ accountId: ACC.software, month: "2026-01", amount: "50.0000", driverKey: "seats" }], assumptions: [], approvedBy: "owner", approvedAt: "2025-12-20T00:00:00.000Z", createdAt: "2025-12-15T00:00:00.000Z" }];
  ds.forecasts = [{ id: "fc_2026", name: "Rolling forecast", asOfDate: "2026-02-28", horizonMonths: 12, drivers: { seats: { key: "seats", label: "Seats", value: 5, unit: "COUNT", status: "CONFIRMED" } }, lines: [{ accountId: ACC.software, month: "2026-03", amount: "49.9900", basis: "FORECAST", driverKeys: ["seats"] }], status: "ACTIVE", version: 2, createdAt: "2026-03-01T00:00:00.000Z", createdBy: "agent:fpa", calcIds: ["calc_0001"] }];
  ds.scenarios = [{ id: "sc_hire", name: "Hire engineer", description: "Add one hire in Q3", baseForecastId: "fc_2026", driverOverrides: { seats: 6, salary: "90000.0000" }, events: [{ month: "2026-07", accountId: ACC.software, amount: "-100.0000", description: "signing bonus" }], createdAt: "2026-03-02T00:00:00.000Z", createdBy: "owner" }];

  ds.approvals = [{ id: "apr_0001", action, risk, requestedApproverRoles: ["OWNER", "CPA"], status: "APPROVED", requestedAt: "2026-02-14T09:31:00.000Z", decidedAt: "2026-02-14T10:00:00.000Z", decidedBy: "owner", decidedByRole: "OWNER", decisionComment: "ok", auditEventIds: ["aud_0001"] }];
  ds.agentActions = [{ id: "aa_0001", action, risk, status: "EXECUTED", approvalId: "apr_0001", auditEventId: "aud_0002", executedAt: "2026-02-14T10:00:05.000Z", result: { categorized: true } }];
  ds.auditEvents = [makeAuditEvent(1), makeAuditEvent(2, { eventType: "ACTION_EXECUTED", finalAction: "categorized", approvalIds: ["apr_0001"] })];

  ds.policies = [{ id: "policy_categorization_v1", key: "categorization", title: "Categorization policy", body: "Recurring approved vendors auto-categorize.", version: 1, status: "ACTIVE", effectiveDate: "2026-01-01", approvedBy: "owner", parameters: { maxAmount: "500.0000" } }];
  ds.professionalGuidance = [{ id: "pg_0001", authorRole: "CPA", authorName: "Synthetic CPA", title: "Deposit schedule", body: "Monthly depositor for 2026.", receivedAt: "2026-01-20T00:00:00.000Z", approvedAt: "2026-01-21T00:00:00.000Z", approvedBy: "owner", appliesTo: ["payroll.deposits"], status: "ACTIVE" }];
  ds.configFields = [
    { key: "ein", section: "entity", label: "EIN", value: null, status: "UNCONFIRMED", requiredConfirmer: "OWNER", updatedAt: "2026-01-01T00:00:00.000Z", sourceIds: [] },
    { key: "payroll_provider", section: "payroll", label: "Payroll provider", value: "Synthetic Payroll", status: "CONFIRMED", note: "lab", updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "owner", sourceIds: ["doc_0001"], synthetic: true },
  ];
  ds.evaluations = [{ id: "ev_0001", runId: "run_1", caseId: "case_1", domain: "AP_AR", competency: "categorization", capabilityKey: "ap.categorize", agent: "bookkeeping", passed: true, score: 1, failures: [], expectedSummary: "7300", actualSummary: "7300", model: { provider: "local", model: "deterministic", deterministic: true }, durationMs: 12, ranAt: "2026-03-01T00:00:00.000Z" }];
  ds.competencyScores = [{ capabilityKey: "ap.categorize", domain: "AP_AR", label: "Categorize transactions", currentLevel: 2, maxAllowedLevel: 3, passRate: 0.98, metrics: { classificationAccuracy: 0.98 }, evaluationCount: 50, consecutivePassingRuns: 3, lastTestedAt: "2026-03-01T00:00:00.000Z", failureCaseIds: [], promotionEligible: false, promotionBlockers: ["needs 5 consecutive runs"] }];
  ds.calculations = [{ id: "calc_0001", name: "gross_wages_q1", value: "10000.0000", unit: "USD", formula: "sum(payroll.gross)", inputs: { runs: ["pr_2026_01"] }, sourceIds: ["pr_2026_01"], assumptions: [], asOfDate: "2026-03-31", notes: [], fingerprint: "fp_1" }];

  return ds;
}
