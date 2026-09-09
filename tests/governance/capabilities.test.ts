import { describe, expect, it } from "vitest";
import { CAPABILITIES, AUTONOMY_LEVELS, CapabilityMatrixImpl, capabilityDefinition } from "@/lib/academy/capabilities";
import { MemoryStore } from "@/lib/db/memory-store";
import { HashChainedAuditLog } from "@/lib/audit/audit-log";
import { ControlViolationError, PermissionDeniedError, TauError } from "@/lib/core/errors";
import { makeClock, makeDataset, OWNER, AGENT, VIEWER } from "./helpers";

function setup() {
  const clock = makeClock();
  const dataset = makeDataset();
  const store = new MemoryStore(dataset);
  const audit = new HashChainedAuditLog(store, dataset, { now: clock.now });
  const matrix = new CapabilityMatrixImpl(store, dataset, { audit, now: clock.now });
  return { dataset, matrix, audit };
}

const LOCKED = ["payment_execution", "payroll_execution", "tax_filing", "worker_classification", "international_worker_compliance"];

describe("capability matrix", () => {
  it("has the canonical 40 capabilities with correct defaults", () => {
    expect(CAPABILITIES).toHaveLength(40);
    expect(new Set(CAPABILITIES.map((c) => c.key)).size).toBe(40);
    for (const c of CAPABILITIES) {
      if (LOCKED.includes(c.key)) {
        expect(c.defaultLevel).toBe(0);
        expect(c.maxPhaseOneLevel).toBe(2);
      } else {
        expect(c.defaultLevel).toBe(1);
        expect(c.maxPhaseOneLevel).toBe(5);
      }
    }
    expect(Object.keys(AUTONOMY_LEVELS)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(AUTONOMY_LEVELS[0].name).toBe("Untrained");
    expect(AUTONOMY_LEVELS[1].name).toBe("Apprentice");
    expect(AUTONOMY_LEVELS[5].name).toBe("Maximum Safe Autonomy");
  });

  it("fresh lab levels come from defaults; list() covers every capability", () => {
    const { matrix } = setup();
    expect(matrix.getLevel("bank_reconciliation")).toBe(1);
    expect(matrix.getLevel("payment_execution")).toBe(0);
    const list = matrix.list();
    expect(list).toHaveLength(40);
    expect(list.find((l) => l.capabilityKey === "tax_filing")).toMatchObject({ level: 0, domain: "TAX_OPERATIONS", label: "Tax filing" });
    expect(() => matrix.getLevel("nope")).toThrow(TauError);
  });

  it("setLevel writes competencyScores, requires a reason and permission, and audits", async () => {
    const { matrix, dataset, audit } = setup();
    expect(dataset.competencyScores).toHaveLength(0);
    matrix.setLevel("variance_analysis", 3, OWNER, "3 consecutive passing eval runs at 95%");
    expect(matrix.getLevel("variance_analysis")).toBe(3);
    expect(dataset.competencyScores).toHaveLength(1);
    expect(dataset.competencyScores[0]).toMatchObject({ capabilityKey: "variance_analysis", currentLevel: 3, maxAllowedLevel: 5, domain: "FPA" });
    matrix.setLevel("variance_analysis", 2, OWNER, "regression in eval run 12");
    expect(dataset.competencyScores).toHaveLength(1);
    expect(matrix.getLevel("variance_analysis")).toBe(2);
    await matrix.flush();
    expect(audit.list({ eventType: "CAPABILITY_LEVEL_CHANGED" })).toHaveLength(2);
    expect(audit.verifyChain().valid).toBe(true);

    expect(() => matrix.setLevel("variance_analysis", 4, OWNER, "  ")).toThrow(ControlViolationError);
    expect(() => matrix.setLevel("variance_analysis", 4, AGENT, "I am ready")).toThrow(ControlViolationError);
    expect(() => matrix.setLevel("variance_analysis", 4, VIEWER, "please")).toThrow(PermissionDeniedError);
    expect(() => matrix.setLevel("unknown_cap", 1, OWNER, "x")).toThrow(TauError);
  });

  it("promotion caps: locked capabilities cannot exceed Level 2 in Phase One", () => {
    const { matrix } = setup();
    for (const key of LOCKED) {
      matrix.setLevel(key, 2, OWNER, "analysis-only certification");
      expect(matrix.getLevel(key)).toBe(2);
      expect(() => matrix.setLevel(key, 3, OWNER, "try to promote")).toThrow(/capped at Level 2/);
      expect(matrix.getLevel(key)).toBe(2);
    }
    matrix.setLevel("financial_statements", 5, OWNER, "fully certified");
    expect(matrix.getLevel("financial_statements")).toBe(5);
  });

  it("getLevel clamps a pre-existing score above the phase-one cap", () => {
    const { matrix, dataset } = setup();
    dataset.competencyScores.push({ capabilityKey: "tax_filing", domain: "TAX_OPERATIONS", label: "Tax filing", currentLevel: 5, maxAllowedLevel: 5, passRate: 1, metrics: {}, evaluationCount: 10, consecutivePassingRuns: 10, failureCaseIds: [], promotionEligible: true, promotionBlockers: [] });
    expect(matrix.getLevel("tax_filing")).toBe(2);
  });

  it("mayAutoExecute: GREEN needs level 3+, YELLOW needs level 5, RED never", () => {
    const { matrix } = setup();
    const key = "transaction_categorization";
    expect(matrix.mayAutoExecute(key, "GREEN")).toBe(false);
    matrix.setLevel(key, 3, OWNER, "certified");
    expect(matrix.mayAutoExecute(key, "GREEN")).toBe(true);
    expect(matrix.mayAutoExecute(key, "YELLOW")).toBe(false);
    matrix.setLevel(key, 4, OWNER, "certified");
    expect(matrix.mayAutoExecute(key, "YELLOW")).toBe(false);
    matrix.setLevel(key, 5, OWNER, "certified");
    expect(matrix.mayAutoExecute(key, "YELLOW")).toBe(true);
    expect(matrix.mayAutoExecute(key, "RED")).toBe(false);
    // locked capabilities can never reach auto-execution
    matrix.setLevel("payment_execution", 2, OWNER, "analysis only");
    expect(matrix.mayAutoExecute("payment_execution", "GREEN")).toBe(false);
    expect(capabilityDefinition("payment_execution").maxPhaseOneLevel).toBe(2);
  });
});
