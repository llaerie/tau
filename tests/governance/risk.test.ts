import { describe, expect, it } from "vitest";
import { RuleBasedRiskEngine, PHASE_ONE_PROHIBITED_KINDS, isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { DEFAULT_MATERIALITY, thresholdsFromConfig, MATERIALITY_CONFIG_KEYS } from "@/lib/risk/materiality";
import type { ActionKind, ProposedAction, RiskLevel } from "@/lib/core/types";
import { action, usd } from "./helpers";

const engine = new RuleBasedRiskEngine({ restrictedAccountIds: ["acct_3100"], now: () => "2026-09-09T00:00:00.000Z" });
const t = DEFAULT_MATERIALITY;
const assess = (a: ProposedAction) => engine.assess(a, { thresholds: t });

describe("risk classification table (product spec examples)", () => {
  const table: [string, RiskLevel, ProposedAction][] = [
    ["GREEN calculate ratios", "GREEN", action("CALCULATE", { description: "current ratio" })],
    ["GREEN generate report", "GREEN", action("GENERATE_REPORT")],
    ["GREEN run reconciliation", "GREEN", action("RUN_RECONCILIATION")],
    ["GREEN categorize approved recurring merchant", "GREEN", action("CATEGORIZE_TRANSACTION", { amount: usd("120.00"), context: { isRecurringApproved: true } })],
    ["GREEN match exact payment", "GREEN", action("MATCH_PAYMENT", { payload: { exactMatch: true }, amount: usd("300.00") })],
    ["GREEN flag missing receipt", "GREEN", action("FLAG_MISSING_RECEIPT")],
    ["GREEN record bill known vendor under review amount", "GREEN", action("RECORD_BILL", { amount: usd("250.00") })],
    ["GREEN non-material forecast update", "GREEN", action("UPDATE_FORECAST")],
    ["YELLOW new category", "YELLOW", action("CATEGORIZE_TRANSACTION", { amount: usd("50.00"), context: { isNewCategory: true } })],
    ["YELLOW new vendor", "YELLOW", action("CREATE_VENDOR", { context: { isNewVendor: true } })],
    ["YELLOW reimbursement", "YELLOW", action("REIMBURSEMENT", { amount: usd("80.00") })],
    ["YELLOW distribution proposal", "YELLOW", action("PROPOSE_DISTRIBUTION", { amount: usd("2000.00") })],
    ["YELLOW mixed personal", "YELLOW", action("CATEGORIZE_TRANSACTION", { amount: usd("40.00"), context: { isRecurringApproved: true, isPersonalMixed: true } })],
    ["YELLOW nonstandard journal entry", "YELLOW", action("CREATE_JOURNAL_ENTRY", { context: { isNonStandard: true } })],
    ["YELLOW restricted account journal entry", "YELLOW", action("POST_JOURNAL_ENTRY", { payload: { lines: [{ accountId: "acct_3100" }] } })],
    ["YELLOW material forecast change", "YELLOW", action("UPDATE_FORECAST", { context: { isMaterialForecastChange: true } })],
    ["YELLOW new recurring expense", "YELLOW", action("RECORD_BILL", { amount: usd("99.00"), context: { isNewRecurringExpense: true } })],
    ["YELLOW collection reminder draft", "YELLOW", action("SEND_COLLECTION_REMINDER")],
    ["YELLOW update config", "YELLOW", action("UPDATE_CONFIG")],
    ["YELLOW lock period", "YELLOW", action("LOCK_PERIOD")],
    ["YELLOW inexact payment match", "YELLOW", action("MATCH_PAYMENT", { payload: { matchType: "PARTIAL" } })],
    ["RED filing taxes", "RED", action("FILE_TAX_RETURN")],
    ["RED paying tax", "RED", action("PAY_TAX")],
    ["RED moving money", "RED", action("EXECUTE_PAYMENT", { amount: usd("100.00") })],
    ["RED scheduling payment that moves money", "RED", action("SCHEDULE_PAYMENT", { context: { movesMoney: true } })],
    ["RED changing payroll", "RED", action("CHANGE_PAYROLL")],
    ["RED running payroll", "RED", action("RUN_PAYROLL")],
    ["RED compensation policy", "RED", action("SET_COMPENSATION_POLICY")],
    ["RED entity restructuring", "RED", action("CHANGE_ENTITY")],
    ["RED responding to government notice", "RED", action("RESPOND_TO_TAX_AUTHORITY")],
    ["RED deleting records", "RED", action("DELETE_RECORD")],
    ["RED changing closed periods", "RED", action("MODIFY_CLOSED_PERIOD")],
    ["RED journal entry into locked period", "RED", action("CREATE_JOURNAL_ENTRY", { context: { periodStatus: "LOCKED" } })],
    ["RED reversal in locked period", "RED", action("REVERSE_JOURNAL_ENTRY", { context: { periodStatus: "LOCKED" } })],
    ["RED unlock period", "RED", action("UNLOCK_PERIOD")],
    ["RED international classification", "RED", action("CLASSIFY_INTERNATIONAL_WORKER")],
    ["RED sign document", "RED", action("SIGN_DOCUMENT")],
    ["RED accounting policy change", "RED", action("CHANGE_ACCOUNTING_POLICY")],
    ["RED any action that moves money", "RED", action("CATEGORIZE_TRANSACTION", { context: { isRecurringApproved: true, movesMoney: true } })],
    ["RED unusual tax-touching action", "RED", action("CREATE_JOURNAL_ENTRY", { context: { touchesTax: true, isNonStandard: true } })],
  ];

  it.each(table)("%s", (_label, expected, a) => {
    const r = assess(a);
    expect(r.level).toBe(expected);
    expect(r.actionId).toBe(a.id);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.policyRefs.length).toBeGreaterThan(0);
    expect(r.policyRefs.every((p) => p.startsWith("risk-policy:v1:"))).toBe(true);
    expect(r.autoExecutable).toBe(expected === "GREEN");
  });

  it("YELLOW scheduling of a payment that does not move money", () => {
    expect(assess(action("SCHEDULE_PAYMENT")).level).toBe("YELLOW");
  });

  it("categorization of a merchant without an approved recurring pattern needs review", () => {
    expect(assess(action("CATEGORIZE_TRANSACTION", { amount: usd("20.00") })).level).toBe("YELLOW");
  });

  it("moves-money cites the moves-money policy ref", () => {
    const r = assess(action("EXECUTE_PAYMENT", { context: { movesMoney: true } }));
    expect(r.policyRefs).toContain("risk-policy:v1:red:moves-money");
  });
});

describe("materiality escalation by amount", () => {
  it("categorization at or above the review amount becomes YELLOW", () => {
    const under = assess(action("CATEGORIZE_TRANSACTION", { amount: usd("499.99"), context: { isRecurringApproved: true } }));
    const at = assess(action("CATEGORIZE_TRANSACTION", { amount: usd("500.00"), context: { isRecurringApproved: true } }));
    expect(under.level).toBe("GREEN");
    expect(under.materialityBreached).toBe(false);
    expect(at.level).toBe("YELLOW");
    expect(at.materialityBreached).toBe(true);
    expect(at.policyRefs).toContain("risk-policy:v1:yellow:materiality:review-amount");
  });

  it("any action at or above the red amount becomes RED", () => {
    const r = assess(action("RECORD_BILL", { amount: usd("10000.00") }));
    expect(r.level).toBe("RED");
    expect(r.materialityBreached).toBe(true);
    expect(r.requiredApproverRoles).toContain("OWNER");
    expect(r.policyRefs).toContain("risk-policy:v1:red:materiality:red-amount");
  });

  it("negative amounts use absolute value", () => {
    expect(assess(action("RECORD_BILL", { amount: usd("-15000.00") })).level).toBe("RED");
  });

  it("read-only kinds are not forced YELLOW by the review amount but are still RED-capped", () => {
    expect(assess(action("CALCULATE", { amount: usd("900.00") })).level).toBe("GREEN");
    expect(assess(action("CALCULATE", { amount: usd("25000.00") })).level).toBe("RED");
  });

  it("known bill at review amount is YELLOW", () => {
    expect(assess(action("RECORD_INVOICE", { amount: usd("500.00") })).level).toBe("YELLOW");
  });

  it("respects confirmed config thresholds", () => {
    const custom = thresholdsFromConfig([
      { key: MATERIALITY_CONFIG_KEYS.transactionReviewAmount, section: "materiality", label: "x", value: "2000", status: "CONFIRMED" },
      { key: MATERIALITY_CONFIG_KEYS.redAmount, section: "materiality", label: "x", value: "50000", status: "CONFIRMED" },
    ]);
    expect(custom.transactionReviewAmount).toBe("2000.0000");
    expect(custom.status).toBe("UNCONFIRMED");
    const r = engine.assess(action("RECORD_BILL", { amount: usd("1500.00") }), { thresholds: custom });
    expect(r.level).toBe("GREEN");
  });

  it("ignores unconfirmed config fields", () => {
    const th = thresholdsFromConfig([{ key: MATERIALITY_CONFIG_KEYS.redAmount, section: "materiality", label: "x", value: "1", status: "UNCONFIRMED" }]);
    expect(th.redAmount).toBe(DEFAULT_MATERIALITY.redAmount);
  });

  it("becomes CONFIRMED when all classification thresholds are confirmed", () => {
    const f = (key: string, value: unknown) => ({ key, section: "materiality", label: key, value, status: "CONFIRMED" as const });
    const th = thresholdsFromConfig([
      f(MATERIALITY_CONFIG_KEYS.transactionReviewAmount, "1000"),
      f(MATERIALITY_CONFIG_KEYS.redAmount, "20000"),
      f(MATERIALITY_CONFIG_KEYS.forecastChangeAmount, "3000"),
      f(MATERIALITY_CONFIG_KEYS.forecastChangeRatio, 0.05),
      f(MATERIALITY_CONFIG_KEYS.varianceRatio, "0.15"),
    ]);
    expect(th.status).toBe("CONFIRMED");
    expect(th.varianceRatio).toBe(0.15);
    expect(th.minimumCashReserve).toBeNull();
  });

  it("lab defaults are UNCONFIRMED with the specified values", () => {
    expect(DEFAULT_MATERIALITY).toMatchObject({ transactionReviewAmount: "500.00", redAmount: "10000.00", forecastChangeAmount: "5000.00", forecastChangeRatio: 0.1, varianceRatio: 0.1, minimumCashReserve: null, status: "UNCONFIRMED" });
  });
});

describe("required approver roles", () => {
  it("GREEN needs nobody; YELLOW lists OWNER and FINANCE_OPERATOR", () => {
    expect(assess(action("CALCULATE")).requiredApproverRoles).toEqual([]);
    expect(assess(action("CREATE_VENDOR")).requiredApproverRoles).toEqual(["OWNER", "FINANCE_OPERATOR"]);
  });
  it.each<[ActionKind, string[]]>([
    ["FILE_TAX_RETURN", ["OWNER", "CPA"]],
    ["PAY_TAX", ["OWNER", "CPA"]],
    ["RESPOND_TO_TAX_AUTHORITY", ["OWNER", "CPA"]],
    ["RUN_PAYROLL", ["OWNER", "PAYROLL_PROFESSIONAL"]],
    ["SET_COMPENSATION_POLICY", ["OWNER", "PAYROLL_PROFESSIONAL"]],
    ["CLASSIFY_INTERNATIONAL_WORKER", ["OWNER", "ATTORNEY", "CPA"]],
    ["CHANGE_ENTITY", ["OWNER", "ATTORNEY", "CPA"]],
    ["CHANGE_ACCOUNTING_POLICY", ["OWNER", "CPA"]],
    ["UPDATE_POLICY", ["OWNER", "CPA"]],
    ["DELETE_RECORD", ["OWNER"]],
    ["EXECUTE_PAYMENT", ["OWNER"]],
  ])("%s → %j", (kind, roles) => {
    expect(assess(action(kind)).requiredApproverRoles.sort()).toEqual([...roles].sort());
  });

  it("capability level below 3 removes auto-executability from GREEN", () => {
    const r = engine.assess(action("CALCULATE"), { thresholds: t, capabilityLevel: 1 });
    expect(r.level).toBe("GREEN");
    expect(r.autoExecutable).toBe(false);
    expect(engine.assess(action("CALCULATE"), { thresholds: t, capabilityLevel: 3 }).autoExecutable).toBe(true);
  });
});

describe("phase one prohibitions", () => {
  it("lists the never-execute kinds", () => {
    expect([...PHASE_ONE_PROHIBITED_KINDS].sort()).toEqual(["CHANGE_ENTITY", "CHANGE_PAYROLL", "DELETE_RECORD", "EXECUTE_PAYMENT", "FILE_TAX_RETURN", "PAY_TAX", "RESPOND_TO_TAX_AUTHORITY", "RUN_PAYROLL", "SIGN_DOCUMENT"]);
    expect(isPhaseOneProhibited("EXECUTE_PAYMENT")).toBe(true);
    expect(isPhaseOneProhibited("CALCULATE")).toBe(false);
  });
  it("prohibited kinds are always RED", () => {
    for (const k of PHASE_ONE_PROHIBITED_KINDS) expect(assess(action(k)).level).toBe("RED");
  });
});
