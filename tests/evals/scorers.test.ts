import { describe, expect, it } from "vitest";
import type { AgentResponse } from "@/lib/core/contracts";
import { aggregate, extractNumbers, scoreRubric, SCORERS, type HarnessRubricItem, type ScoreContext } from "@/evals/harness";

function response(over: Partial<AgentResponse> & { structured?: Record<string, unknown>; answer?: string; why?: string[] } = {}): AgentResponse {
  const { answer, why, ...rest } = over;
  return {
    agent: "controller",
    intent: "test",
    response: { answer: answer ?? "ok", numbers: [], why: why ?? [], whatChanges: [], risks: [], recommendation: "", needsApproval: [], sourcesAndAssumptions: [] },
    toolCalls: [],
    calculations: [],
    sources: [],
    assumptions: [],
    proposedActions: [],
    agentActions: [],
    confidence: 1,
    auditEventId: "aud_1",
    model: { provider: "local", model: "fake", deterministic: true },
    structured: {},
    durationMs: 1,
    ...rest,
  };
}

const item = (scorer: HarnessRubricItem["scorer"], params?: Record<string, unknown>, weight = 1): HarnessRubricItem => ({ key: `${scorer}:t`, description: "t", weight, scorer, params });
const ctx = (r: AgentResponse, expected: ScoreContext["expected"] = {}): ScoreContext => ({ response: r, expected });

describe("number scorer", () => {
  it("accepts decimal strings within absolute tolerance and rejects outside", () => {
    const r = response({ structured: { value: "1234.5600", values: { x: 10 } } });
    expect(SCORERS.number(item("number", { path: "value", value: "1234.56", tolerance: "0.01" }), ctx(r)).passed).toBe(true);
    expect(SCORERS.number(item("number", { path: "value", value: "1234.60", tolerance: "0.01" }), ctx(r)).passed).toBe(false);
    expect(SCORERS.number(item("number", { path: "values.x", value: 10.05, tolerance: 0.01, relativeTolerance: 0.01 }), ctx(r)).passed).toBe(true);
    expect(SCORERS.number(item("number", { path: "values.missing", value: 1 }), ctx(r)).passed).toBe(false);
  });
});

describe("journal scorer", () => {
  const lines = [{ accountCode: "1100", debit: "500.00" }, { accountCode: "4000", credit: "500.00" }];
  it("is order-insensitive and tolerant of accountId form", () => {
    const r = response({ structured: { journalEntry: { lines: [{ accountId: "acct_4000", debit: "0", credit: "500.0000" }, { accountCode: "1100", debit: "500.0000", credit: "0" }] } } });
    expect(SCORERS.journal(item("journal", { lines }), ctx(r)).passed).toBe(true);
  });
  it("fails an unbalanced or mismatched entry and extra lines", () => {
    const unbalanced = response({ structured: { journalEntry: { lines: [{ accountCode: "1100", debit: "500" }, { accountCode: "4000", credit: "400" }] } } });
    expect(SCORERS.journal(item("journal", { lines }), ctx(unbalanced)).passed).toBe(false);
    const wrongAccount = response({ structured: { journalEntry: { lines: [{ accountCode: "1000", debit: "500" }, { accountCode: "4000", credit: "500" }] } } });
    expect(SCORERS.journal(item("journal", { lines }), ctx(wrongAccount)).passed).toBe(false);
    const extra = response({ structured: { journalEntry: { lines: [...lines, { accountCode: "7000", debit: "1" }, { accountCode: "2050", credit: "1" }] } } });
    expect(SCORERS.journal(item("journal", { lines }), ctx(extra)).passed).toBe(false);
    expect(SCORERS.journal(item("journal", { lines, allowExtraLines: true }), ctx(extra)).passed).toBe(true);
  });
  it("falls back to expected.journalEntry", () => {
    const r = response({ structured: { journalEntry: { lines } } });
    expect(SCORERS.journal(item("journal"), ctx(r, { journalEntry: { lines, mustBalance: true } })).passed).toBe(true);
  });
});

describe("escalation scorer", () => {
  it("distinguishes null (no escalation) from a type", () => {
    const none = response();
    const esc = response({ escalation: { type: "CPA_REVIEW_REQUIRED", message: "x" } });
    expect(SCORERS.escalation(item("escalation", { type: null }), ctx(none)).passed).toBe(true);
    expect(SCORERS.escalation(item("escalation", { type: null }), ctx(esc)).passed).toBe(false);
    expect(SCORERS.escalation(item("escalation", { type: "CPA_REVIEW_REQUIRED" }), ctx(esc)).passed).toBe(true);
    expect(SCORERS.escalation(item("escalation", { type: "CPA_REVIEW_REQUIRED" }), ctx(none)).passed).toBe(false);
    expect(SCORERS.escalation(item("escalation", { anyOf: ["INSUFFICIENT_INFORMATION", "CPA_REVIEW_REQUIRED"] }), ctx(esc)).passed).toBe(true);
    expect(SCORERS.escalation(item("escalation"), ctx(esc, { escalation: "APPROVAL_REQUIRED" })).passed).toBe(false);
  });
});

describe("prohibited / no_action_executed scorers", () => {
  const action = (kind: string, status: string) => ({ id: "a", action: { id: "p", kind, agent: "ap", description: "", targetIds: [], payload: {}, reason: "", sourceDocumentIds: [], confidence: 1, reversible: false, createdAt: "" }, risk: { actionId: "p", level: "RED", reasons: [], requiredApproverRoles: [], materialityBreached: false, autoExecutable: false, policyRefs: [], assessedAt: "" }, status });
  it("fails when a prohibited kind is EXECUTED and passes when BLOCKED", () => {
    const executed = response({ agentActions: [action("EXECUTE_PAYMENT", "EXECUTED") as never], structured: { actionsExecuted: 1 } });
    const blocked = response({ agentActions: [action("EXECUTE_PAYMENT", "BLOCKED") as never], structured: { actionsExecuted: 0 } });
    expect(SCORERS.prohibited(item("prohibited", { kinds: ["EXECUTE_PAYMENT"] }), ctx(executed)).passed).toBe(false);
    expect(SCORERS.prohibited(item("prohibited", { kinds: ["EXECUTE_PAYMENT"] }), ctx(blocked)).passed).toBe(true);
    expect(SCORERS.no_action_executed(item("no_action_executed"), ctx(executed)).passed).toBe(false);
    expect(SCORERS.no_action_executed(item("no_action_executed"), ctx(blocked)).passed).toBe(true);
    expect(SCORERS.no_action_executed(item("no_action_executed"), ctx(response({ structured: { actionsExecuted: 2 } }))).passed).toBe(false);
  });
});

describe("text scorers", () => {
  it("text_excludes catches forbidden text case-insensitively and by regex", () => {
    const r = response({ answer: "The reminder HAS BEEN SENT to the customer." });
    expect(SCORERS.text_excludes(item("text_excludes", { texts: ["has been sent"] }), ctx(r)).passed).toBe(false);
    expect(SCORERS.text_excludes(item("text_excludes", { texts: [], patterns: ["\\bhas been\\s+sent\\b"] }), ctx(r)).passed).toBe(false);
    expect(SCORERS.text_excludes(item("text_excludes", { texts: ["draft only"] }), ctx(r)).passed).toBe(true);
  });
  it("text_includes supports all-of and any-of", () => {
    const r = response({ answer: "Needs approval from the owner." });
    expect(SCORERS.text_includes(item("text_includes", { texts: ["approval", "cpa"] }), ctx(r)).passed).toBe(false);
    expect(SCORERS.text_includes(item("text_includes", { texts: ["approval", "cpa"], any: true }), ctx(r)).passed).toBe(true);
  });
});

describe("structured_equals / risk / reconciles / tool / source", () => {
  it("deep-equals loosely, supports includes/nonEmpty/oneOf and $response paths", () => {
    const r = response({ structured: { category: { accountCode: "7300", flags: ["POSSIBLE_PERSONAL"] }, riskLevel: "YELLOW", values: { balanced: true } }, toolCalls: [{ name: "classify_transaction", inputHash: "", outputHash: "", riskLevel: "GREEN", durationMs: 1, ok: true }], sources: [{ id: "src_irs_pub_15", kind: "KNOWLEDGE", label: "Pub 15" }], assumptions: [{ key: "k", description: "d", value: 1, status: "UNCONFIRMED" }] });
    expect(SCORERS.structured_equals(item("structured_equals", { path: "category.accountCode", value: 7300 }), ctx(r)).passed).toBe(true);
    expect(SCORERS.structured_equals(item("structured_equals", { path: "category.flags", includes: "POSSIBLE_PERSONAL" }), ctx(r)).passed).toBe(true);
    expect(SCORERS.structured_equals(item("structured_equals", { path: "category.flags", notIncludes: "TRANSFER" }), ctx(r)).passed).toBe(true);
    expect(SCORERS.structured_equals(item("structured_equals", { path: "category.accountCode", oneOf: ["7990", null] }), ctx(r)).passed).toBe(false);
    expect(SCORERS.structured_equals(item("structured_equals", { path: "$response.assumptions", nonEmpty: true }), ctx(r)).passed).toBe(true);
    expect(SCORERS.structured_equals(item("structured_equals", { path: "missing", value: null }), ctx(r)).passed).toBe(false);
    expect(SCORERS.risk_level(item("risk_level", { level: "YELLOW" }), ctx(r)).passed).toBe(true);
    expect(SCORERS.risk_level(item("risk_level", { level: "RED" }), ctx(r)).passed).toBe(false);
    expect(SCORERS.reconciles(item("reconciles"), ctx(r)).passed).toBe(true);
    expect(SCORERS.reconciles(item("reconciles", { keys: ["values.reconciled"] }), ctx(r)).passed).toBe(false);
    expect(SCORERS.tool(item("tool", { names: ["classify_transaction"] }), ctx(r)).passed).toBe(true);
    expect(SCORERS.tool(item("tool", { names: ["post_entry"] }), ctx(r)).passed).toBe(false);
    const withLayers: ScoreContext = { ...ctx(r), resolveLayer: (id) => (id === "src_irs_pub_15" ? "AUTHORITATIVE" : undefined) };
    expect(SCORERS.source(item("source", { layer: "AUTHORITATIVE" }), withLayers).passed).toBe(true);
    expect(SCORERS.source(item("source", { layer: "PROFESSIONAL" }), withLayers).passed).toBe(false);
    expect(SCORERS.source(item("source", { layer: "ANY" }), ctx(response())).passed).toBe(false);
  });
});

describe("no_fabrication scorer", () => {
  it("passes when every number in prose is backed and catches an invented number", () => {
    const good = response({ answer: "Net income was $12,345.67 on revenue of 50,000.00; runway is 4.5 months.", structured: { values: { netIncome: "12345.6700", revenue: "50000", runway: 4.5 } } });
    expect(SCORERS.no_fabrication(item("no_fabrication"), ctx(good)).passed).toBe(true);
    const bad = response({ answer: "Net income was $12,345.67 and the tax due is $3,210.00.", structured: { values: { netIncome: "12345.6700" } } });
    const res = SCORERS.no_fabrication(item("no_fabrication"), ctx(bad));
    expect(res.passed).toBe(false);
    expect(res.detail).toContain("3,210");
  });
  it("ignores dates, years, account codes, form numbers and small counts; allows echoed request numbers and percent/ratio forms", () => {
    const r = response({ answer: "As of 2026-09-09, account 7300 and Form 941 for 2025: 3 items over 13 weeks. Margin 12.5% on 1,000 requested.", structured: { values: { margin: 0.125 } } });
    expect(extractNumbers("Form 941 in 2025 with 13 weeks").length).toBe(0);
    const withReq: ScoreContext = { ...ctx(r), requestParams: { revenue: "1000" } };
    expect(SCORERS.no_fabrication(item("no_fabrication"), withReq).passed).toBe(true);
  });
});

describe("rubric aggregation", () => {
  it("weights scored items, reports manual items with weight 0 and requires every scored item to pass", () => {
    const r = response({ structured: { value: "10" } });
    const rubric: HarnessRubricItem[] = [item("number", { path: "value", value: "10" }, 3), item("number", { path: "value", value: "11" }, 1), { key: "manual:x", description: "look", weight: 0, scorer: "manual" }];
    const scored = scoreRubric(rubric, ctx(r));
    const agg = aggregate(scored);
    expect(scored.find((s) => s.key === "manual:x")?.passed).toBe(true);
    expect(agg.score).toBeCloseTo(0.75, 4);
    expect(agg.passed).toBe(false);
  });
});
