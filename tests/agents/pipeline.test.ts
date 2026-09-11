import { describe, expect, it, beforeAll } from "vitest";
import { askCfo } from "@/lib/agents/ask";
import { TASK_KINDS, type TaskKind } from "@/lib/agents/task-catalog";
import { AS_OF, OWNER, makeFixtureRuntime, type FixtureRuntime } from "./fixture";

const RATES = { socialSecurityRate: 0.062, medicareRate: 0.0145, futaRate: 0.006, suiRate: 0.034, ettRate: 0.001, socialSecurityWageBase: 176100, futaWageBase: 7000, suiWageBase: 7000 };
const CF = [-10000, 4000, 4000, 4000];

/** Valid parameters for every task kind against the fixture. */
export const TASK_PARAMS: Record<TaskKind, Record<string, unknown>> = {
  "accounting.journal_entry_draft": { description: "Notion subscription on the card", event: { type: "EXPENSE_ON_CARD", amount: 100, expenseAccountCode: "7000" } },
  "accounting.post_journal_entry": { entryId: "je_draft_software" },
  "accounting.financial_statements": { from: "2026-08-01", to: "2026-08-31" },
  "accounting.trial_balance": { asOf: AS_OF },
  "accounting.integrity_check": { asOf: AS_OF },
  "accounting.depreciation_schedule": { cost: 3200, salvage: 200, usefulLifeMonths: 36, inServiceDate: "2026-08-10" },
  "accounting.prepaid_amortization": { amount: 1200, months: 12, startDate: "2026-09-01", expenseAccountCode: "7000" },
  "accounting.accrual": { amount: 2000, expenseAccountCode: "7200", periodEnd: "2026-09-30", description: "Legal fees" },
  "accounting.correcting_entry": { originalEntryId: "je_apple", correctedLines: [{ accountCode: "7400", debit: 3200 }, { accountCode: "2050", credit: 3200 }], reason: "Below the capitalization threshold" },
  "accounting.classify_transaction": { transactionId: "tx_bistro" },
  "accounting.detect_duplicates": {},
  "accounting.match_transfers": {},
  "accounting.exception_queue": {},
  "accounting.bank_reconciliation": { asOf: AS_OF },
  "accounting.close_period": { periodId: "2026-08" },
  "accounting.modify_closed_period": { periodId: "2025-12", description: "move rent" },
  "accounting.explain_statement": { statement: "INCOME_STATEMENT", from: "2026-08-01", to: "2026-08-31" },
  "fpa.budget_variance": { budget: 1000, actual: 1200, accountType: "EXPENSE", month: "2026-08" },
  "fpa.forecast_variance": { month: "2026-08", forecast: 12000, actual: 12000, accountType: "REVENUE" },
  "fpa.rolling_forecast": { horizonMonths: 6 },
  "fpa.build_budget": { fiscalYear: 2027 },
  "fpa.scenario": { name: "5% growth", driverOverrides: { "revenue:growth_rate_monthly": 0.05 } },
  "fpa.growth_rate": { start: 10000, end: 12000 },
  "fpa.headcount_plan": { grossAnnual: 120000, rateSet: RATES },
  "fpa.ratios": {},
  "fpa.profitability": { from: "2026-01-01", to: AS_OF },
  "cash.position": {},
  "cash.thirteen_week": {},
  "cash.delayed_receipt": { delayDays: 30 },
  "cash.stress_test": { receiptHaircut: 0.2, extraDisbursement: 5000 },
  "cash.runway": {},
  "cash.reserve_coverage": {},
  "cash.working_capital": {},
  "ar.aging": {},
  "ap.aging": {},
  "ar.match_payment": { paymentAmount: 12000, customerId: "cust_harbor" },
  "ar.create_invoice": { customerId: "cust_harbor", amount: 5000, description: "September services" },
  "ar.collection_reminder": { invoiceId: "inv_aug" },
  "ap.bill_intake": { vendorName: "GitHub", amount: 300, billDate: "2026-09-08", billNumber: "GH-9" },
  "ap.schedule_payment": {},
  "ap.pay_bill": { billId: "bill_law" },
  "ap.vendor_create": { name: "New Vendor Co", defaultAccountCode: "7000" },
  "payroll.calendar": {},
  "payroll.reconcile_run": { payrollRunId: "run_2026-08-28" },
  "payroll.employer_cost": { gross: 10000, rateSet: RATES },
  "payroll.gross_to_net": { gross: 5000, withholdings: { federal: 600, state: 200 } },
  "payroll.liabilities": {},
  "payroll.classification_flag": { workerId: "w_cn" },
  "payroll.international_review": {},
  "payroll.change": { description: "Raise Sam to 9000", workerId: "w_eng", amount: 9000 },
  "payroll.owner_compensation": { proposedMonthlyGross: 3000, rateSet: RATES },
  "tax.calendar": {},
  "tax.calculate_with_rule": { ruleKey: "ca_s_corp_franchise_tax_rate", inputs: { base: 100000 } },
  "tax.question": { question: "How much is the California franchise tax on $100,000 of net income?" },
  "tax.workpaper": { taxYear: 2026 },
  "tax.document_checklist": { taxYear: 2026 },
  "tax.cpa_package": { from: "2026-01-01", to: AS_OF },
  "tax.file_return": { description: "file the 1120-S" },
  "tax.shareholder_summary": { taxYear: 2026 },
  "documents.missing": {},
  "documents.classify": { title: "Invoice from Law LLP" },
  "documents.match_receipts": {},
  "documents.retention": { kind: "RECEIPT" },
  "strategy.npv": { rate: 0.1, cashflows: CF },
  "strategy.irr": { cashflows: CF },
  "strategy.payback": { cashflows: CF, rate: 0.1 },
  "strategy.break_even": { fixedCosts: 50000, pricePerUnit: 200, variableCostPerUnit: 120 },
  "strategy.contribution_margin": { revenue: 100000, variableCosts: 60000, units: 500 },
  "strategy.hiring_case": { grossAnnual: 120000, expectedRevenueImpactAnnual: 200000, rateSet: RATES, rampMonths: 3 },
  "strategy.pricing": { currentPrice: 100, newPrice: 110, currentUnits: 50, variableCostPerUnit: 40 },
  "strategy.investment_case": { cost: 10000, annualBenefit: 4000, years: 3, rate: 0.1 },
  "strategy.scenario_compare": { base: [1000, 1000, 1000], scenarios: [{ name: "downside", series: [900, 900, 900] }] },
  "strategy.roi": { gain: 15000, cost: 10000 },
  "controls.risk_assess": { kind: "EXECUTE_PAYMENT", amount: 5000, description: "pay a vendor" },
  "controls.personal_business_check": { transactionId: "tx_bistro" },
  "controls.audit_explain": { targetId: "je_apple" },
  "controls.verify_report": { from: "2026-08-01", to: "2026-08-31" },
  "cfo.weekly_brief": {},
  "cfo.health": {},
  "cfo.attention": {},
  "cfo.explain_concept": { concept: "cash runway" },
  "cfo.config_status": {},
};

const DELEGATED = new Set<TaskKind>(["cfo.weekly_brief", "cfo.attention", "tax.cpa_package", "accounting.close_period"]);

describe("every task kind returns a structured payload", () => {
  let f: FixtureRuntime;
  beforeAll(async () => {
    f = await makeFixtureRuntime();
  });

  it("catalog and parameter map agree", () => {
    for (const k of TASK_KINDS) expect(TASK_PARAMS[k], k).toBeDefined();
  });

  it.each(TASK_KINDS)("%s", async (kind) => {
    const auditBefore = f.ds.auditEvents.length;
    const res = await askCfo(f.rt, `task ${kind}`, { actor: OWNER, task: { kind, params: TASK_PARAMS[kind] } });
    expect(res.structured.task).toBe(kind);
    expect("value" in res.structured).toBe(true);
    expect("escalation" in res.structured).toBe(true);
    expect(typeof res.structured.actionsExecuted).toBe("number");
    expect(typeof res.structured.requiresApproval).toBe("boolean");
    expect(Array.isArray(res.structured.sourceLayers)).toBe(true);
    expect(typeof res.structured.rendered).toBe("string");
    expect(res.response.answer.length).toBeGreaterThan(10);
    expect(res.response.sourcesAndAssumptions).toBeDefined();
    if (!DELEGATED.has(kind)) expect(res.structured.toolError, `${kind}: ${String(res.structured.toolError)}`).toBeUndefined();
    if (res.structured.riskLevel === "RED") expect(res.structured.actionsExecuted).toBe(0);
    for (const a of res.agentActions) expect(a.risk.level === "RED" && a.status === "EXECUTED").toBe(false);
    // audit event for every request, with tool records
    expect(f.ds.auditEvents.length).toBeGreaterThan(auditBefore);
    const ev = f.ds.auditEvents.find((e) => e.id === res.auditEventId);
    expect(ev).toBeDefined();
    expect(ev?.agent).toBe(res.agent);
    if (res.toolCalls.length) {
      expect(ev?.toolsCalled.length).toBeGreaterThan(0);
      for (const t of ev!.toolsCalled) {
        expect(t.inputHash).toMatch(/^[0-9a-f]{24}$/);
        expect(t.outputHash).toMatch(/^[0-9a-f]{24}$/);
        expect(t.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
    expect(ev?.promptVersion).toBeTruthy();
    expect(ev?.model?.provider).toBeTruthy();
  });
});

describe("structured conventions and invariants", () => {
  let f: FixtureRuntime;
  beforeAll(async () => {
    f = await makeFixtureRuntime();
  });

  it("journal entry drafts always balance across event types", async () => {
    const events = [
      { type: "EXPENSE_ON_CARD", amount: 100, expenseAccountCode: "7000" },
      { type: "REVENUE_ON_CREDIT", amount: 12000 },
      { type: "PREPAID_AMORTIZATION", amount: 1200, months: 12, expenseAccountCode: "7000" },
      { type: "PAYROLL_RUN", extra: { gross: 11000, employerTaxes: 900, netPay: 8500, federalPayable: 2500, statePayable: 900 } },
      { type: "LOAN_PAYMENT", extra: { principal: 900, interest: 100 } },
      { type: "SHAREHOLDER_DISTRIBUTION", amount: 5000 },
      { type: "EQUIPMENT_PURCHASE", amount: 3200 },
    ];
    for (const event of events) {
      const res = await askCfo(f.rt, "draft", { actor: OWNER, task: { kind: "accounting.journal_entry_draft", params: { description: `Event ${event.type}`, event } } });
      const je = res.structured.journalEntry as { lines: { accountCode: string; debit: string; credit: string }[]; balanced: boolean; totalDebits: string; totalCredits: string };
      expect(je, event.type).toBeDefined();
      expect(je.balanced, event.type).toBe(true);
      expect(je.totalDebits).toBe(je.totalCredits);
      expect(je.lines.length).toBeGreaterThanOrEqual(2);
      expect(res.proposedActions[0]?.kind).toBe("CREATE_JOURNAL_ENTRY");
      expect(res.structured.actionsExecuted).toBe(0); // Apprentice level: every action waits for a human
      expect(res.structured.requiresApproval).toBe(true);
    }
    const unbalanced = await askCfo(f.rt, "draft", { actor: OWNER, task: { kind: "accounting.journal_entry_draft", params: { description: "bad", lines: [{ accountCode: "7000", debit: 100 }, { accountCode: "2050", credit: 90 }] } } });
    expect(unbalanced.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
    expect(unbalanced.proposedActions).toHaveLength(0);
    expect((unbalanced.structured.journalEntry as { balanced: boolean }).balanced).toBe(false);
  });

  it("drafted entries and derived schedules (depreciation, prepaid, accrual) balance", async () => {
    for (const [kind, params] of [["accounting.depreciation_schedule", TASK_PARAMS["accounting.depreciation_schedule"]], ["accounting.prepaid_amortization", TASK_PARAMS["accounting.prepaid_amortization"]], ["accounting.accrual", TASK_PARAMS["accounting.accrual"]]] as const) {
      const res = await askCfo(f.rt, kind, { actor: OWNER, task: { kind, params } });
      expect((res.structured.journalEntry as { balanced: boolean }).balanced, kind).toBe(true);
    }
    const dep = await askCfo(f.rt, "dep", { actor: OWNER, task: { kind: "accounting.depreciation_schedule", params: TASK_PARAMS["accounting.depreciation_schedule"] } });
    expect(dep.structured.value).toBe("83.3400");
    const pre = await askCfo(f.rt, "pre", { actor: OWNER, task: { kind: "accounting.prepaid_amortization", params: TASK_PARAMS["accounting.prepaid_amortization"] } });
    expect(pre.structured.value).toBe("100.0000");
  });

  it("unknown information yields INSUFFICIENT_INFORMATION with a null value, never zero", async () => {
    const reserve = await askCfo(f.rt, "reserve", { actor: OWNER, task: { kind: "cash.reserve_coverage" } });
    expect(reserve.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
    expect(reserve.structured.value).toBeNull();
    expect(reserve.escalation?.relatedConfigKeys).toContain("materiality.minimumCashReserve");
    const cost = await askCfo(f.rt, "employer cost", { actor: OWNER, task: { kind: "payroll.employer_cost", params: { gross: 10000 } } });
    expect(cost.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
    expect(cost.structured.value).toBeNull();
    expect(cost.response.answer).toMatch(/authoritative source/i);
    const rule = await askCfo(f.rt, "rule", { actor: OWNER, task: { kind: "tax.calculate_with_rule", params: TASK_PARAMS["tax.calculate_with_rule"] } });
    expect(rule.escalation?.type).toBe("CPA_REVIEW_REQUIRED");
    expect(rule.structured.value).toBeNull();
    const budget = await askCfo(f.rt, "budget", { actor: OWNER, task: { kind: "fpa.budget_variance", params: { month: "2026-08" } } });
    expect(budget.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
  });

  it("classification follows the structured category convention and flags personal meals", async () => {
    const res = await askCfo(f.rt, "classify", { actor: OWNER, task: { kind: "accounting.classify_transaction", params: { transactionId: "tx_bistro", hasReceipt: false } } });
    const cat = res.structured.category as { accountCode: string; confidence: number; status: string; flags: string[] };
    expect(cat.flags).toContain("POSSIBLE_PERSONAL");
    expect(cat.flags).toContain("MISSING_RECEIPT");
    expect(cat.accountCode).toBe("7990");
    expect(res.proposedActions[0]?.kind).toBe("CATEGORIZE_TRANSACTION");
    expect(res.agentActions[0]?.risk.level).toBe("YELLOW");
    expect(res.response.education?.title).toMatch(/personal/i);
    const github = await askCfo(f.rt, "classify", { actor: OWNER, task: { kind: "accounting.classify_transaction", params: { description: "GITHUB TEAM *1234", amount: -100, date: "2026-09-05", sourceKind: "CARD" } } });
    expect((github.structured.category as { accountCode: string }).accountCode).toBe("7000");
    const venmo = await askCfo(f.rt, "classify", { actor: OWNER, task: { kind: "accounting.classify_transaction", params: { transactionId: "tx_venmo" } } });
    expect(venmo.escalation?.type).toBe("CANNOT_CLASSIFY");
    expect((venmo.structured.category as { accountCode: string | null }).accountCode).toBeNull();
    const apple = await askCfo(f.rt, "classify", { actor: OWNER, task: { kind: "accounting.classify_transaction", params: { description: "APPLE STORE #R123", amount: -3200, date: "2026-08-10", sourceKind: "CARD" } } });
    expect((apple.structured.category as { accountCode: string; flags: string[] }).accountCode).toBe("1500");
    expect((apple.structured.category as { flags: string[] }).flags).toContain("LARGE_UNUSUAL");
  });

  it("duplicates and transfers are detected in the fixture", async () => {
    const d = await askCfo(f.rt, "dupes", { actor: OWNER, task: { kind: "accounting.detect_duplicates" } });
    expect(d.structured.value).toBe(1);
    expect((d.structured.duplicates as { transactionId: string }[])[0].transactionId).toBe("tx_github_dup");
    const t = await askCfo(f.rt, "transfers", { actor: OWNER, task: { kind: "accounting.match_transfers" } });
    expect(t.structured.value).toBe(1);
  });

  it("financial statements expose values and balance", async () => {
    const res = await askCfo(f.rt, "statements", { actor: OWNER, task: { kind: "accounting.financial_statements", params: { from: "2026-08-01", to: "2026-08-31" } } });
    const v = res.structured.values as Record<string, string>;
    expect(v.revenue).toBe("12000.0000");
    expect(res.structured.balanced).toBe(true);
    expect(res.structured.reconciled).toBe(true);
    expect(res.calculations.length).toBeGreaterThan(5);
    expect(res.response.numbers.every((n) => n.value !== undefined)).toBe(true);
  });

  it("strategy calculations return the primary value", async () => {
    const npv = await askCfo(f.rt, "npv", { actor: OWNER, task: { kind: "strategy.npv", params: { rate: 0.1, cashflows: CF } } });
    expect(npv.structured.value).toBe("-52.5920");
    const be = await askCfo(f.rt, "be", { actor: OWNER, task: { kind: "strategy.break_even", params: TASK_PARAMS["strategy.break_even"] } });
    expect(be.structured.value).toBe(625);
    const roi = await askCfo(f.rt, "roi", { actor: OWNER, task: { kind: "strategy.roi", params: { gain: 15000, cost: 10000 } } });
    expect(roi.structured.value).toBe(0.5);
  });

  it("AR payment matching handles exact, partial and overpayment", async () => {
    const exact = await askCfo(f.rt, "m", { actor: OWNER, task: { kind: "ar.match_payment", params: { paymentAmount: 12000, customerId: "cust_harbor" } } });
    expect(exact.structured.matchType).toBe("EXACT");
    expect(exact.agentActions[0]?.risk.level).toBe("RED"); // 12,000 is at/above the lab RED materiality amount
    expect(exact.agentActions[0]?.risk.materialityBreached).toBe(true);
    const small = await askCfo(f.rt, "m", { actor: OWNER, task: { kind: "ar.match_payment", params: { paymentAmount: 4000, invoiceId: "inv_sep" } } });
    expect(small.structured.matchType).toBe("EXACT");
    expect(small.agentActions[0]?.status).toBe("AWAITING_APPROVAL");
    const partial = await askCfo(f.rt, "m", { actor: OWNER, task: { kind: "ar.match_payment", params: { paymentAmount: 5000, invoiceId: "inv_aug" } } });
    expect(partial.structured.matchType).toBe("PARTIAL");
    expect(partial.agentActions[0]?.risk.level).toBe("YELLOW");
    const over = await askCfo(f.rt, "m", { actor: OWNER, task: { kind: "ar.match_payment", params: { paymentAmount: 12500, invoiceId: "inv_aug" } } });
    expect(over.structured.matchType).toBe("OVERPAYMENT");
    expect((over.structured.values as { unapplied: string }).unapplied).toBe("500.0000");
    expect((over.structured.journalEntry as { balanced: boolean }).balanced).toBe(true);
  });

  it("bill intake detects duplicates and never records them", async () => {
    const billsBefore = f.ds.bills.length;
    const dup = await askCfo(f.rt, "bill", { actor: OWNER, task: { kind: "ap.bill_intake", params: { vendorName: "Law LLP", amount: 1200, billDate: "2026-09-02" } } });
    expect(dup.structured.duplicate).toBe(true);
    expect(dup.proposedActions).toHaveLength(0);
    expect(f.ds.bills.length).toBe(billsBefore);
  });

  it("orchestrator health merges four specialists and prefers the auditor's integrity verdict", async () => {
    const res = await askCfo(f.rt, "How are we doing financially?", { actor: OWNER });
    expect(res.agent).toBe("cfo_orchestrator");
    expect(res.intent).toBe("cfo.health");
    expect(res.delegatedTo).toEqual(["controller", "treasury", "ar", "auditor"]);
    expect(typeof res.structured.integrityPassed).toBe("boolean");
    expect(res.structured.actionsExecuted).toBe(0);
    expect(res.response.answer).toMatch(/Ledger integrity \(auditor\)/);
    const ev = f.ds.auditEvents.find((e) => e.id === res.auditEventId);
    expect(ev?.agent).toBe("cfo_orchestrator");
  });

  it("generic non-finance questions get an OUT_OF_SCOPE answer", async () => {
    const res = await askCfo(f.rt, "What is the weather in Paris?", { actor: OWNER });
    expect(res.escalation?.type).toBe("OUT_OF_SCOPE");
    expect(res.structured.actionsExecuted).toBe(0);
  });

  it("audit explain reconstructs the trail of a proposed action", async () => {
    const cls = await askCfo(f.rt, "classify", { actor: OWNER, task: { kind: "accounting.classify_transaction", params: { transactionId: "tx_github_dup" } } });
    const actionId = cls.proposedActions[0]?.id;
    expect(actionId).toBeTruthy();
    const why = await askCfo(f.rt, "why", { actor: OWNER, task: { kind: "controls.audit_explain", params: { targetId: actionId } } });
    expect(why.agent).toBe("auditor");
    expect(why.structured.value as number).toBeGreaterThan(0);
  });
});
