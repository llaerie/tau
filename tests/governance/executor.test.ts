import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@/lib/approvals/action-executor";
import { CapabilityMatrixImpl } from "@/lib/academy/capabilities";
import { whyDidTheCfoDoThis } from "@/lib/audit/explain";
import { action, makeGovernance, usd, OWNER, AGENT, CPA } from "./helpers";

function setup(withCapabilities = false) {
  const g = makeGovernance();
  const capabilities = withCapabilities ? new CapabilityMatrixImpl(g.store, g.dataset, { audit: g.audit, now: g.clock.now }) : undefined;
  const executor = new ActionExecutor({ store: g.store, dataset: g.dataset, risk: g.risk, approvals: g.approvals, audit: g.audit, thresholds: g.thresholds, capabilities, now: g.clock.now });
  return { ...g, executor, capabilities };
}

describe("ActionExecutor", () => {
  it("executes GREEN actions through a registered handler and records EXECUTED with before/after state", async () => {
    const g = setup();
    let calls = 0;
    g.executor.registerHandler("CALCULATE", async (a) => {
      calls += 1;
      return { computed: a.description };
    });
    const a = action("CALCULATE", { description: "gross margin" });
    const rec = await g.executor.submit(a, AGENT);
    expect(calls).toBe(1);
    expect(rec.status).toBe("EXECUTED");
    expect(rec.result).toEqual({ computed: "gross margin" });
    expect(rec.executedAt).toBe(g.clock.now());
    expect(g.dataset.agentActions).toHaveLength(1);
    const ev = g.audit.list().find((e) => e.id === rec.auditEventId);
    expect(ev?.eventType).toBe("ACTION_EXECUTED");
    expect(ev?.beforeState).toMatchObject({ status: "PROPOSED", actionId: a.id });
    expect(ev?.afterState).toMatchObject({ status: "EXECUTED", actionId: a.id });
    expect(ev?.agent).toBe("bookkeeping");
  });

  it("unregistered kinds are SIMULATED with a note", async () => {
    const g = setup();
    const rec = await g.executor.submit(action("GENERATE_REPORT"), AGENT);
    expect(rec.status).toBe("SIMULATED");
    expect(rec.result).toMatchObject({ simulated: true });
    expect(String(rec.result?.note)).toContain("No handler");
  });

  it("YELLOW actions open an approval request and become AWAITING_APPROVAL, then execute once approved", async () => {
    const g = setup();
    g.executor.registerHandler("CREATE_VENDOR", async () => ({ vendorId: "v_1" }));
    const a = action("CREATE_VENDOR");
    const first = await g.executor.submit(a, AGENT);
    expect(first.status).toBe("AWAITING_APPROVAL");
    expect(first.approvalId).toBeDefined();
    expect(g.approvals.pending()).toHaveLength(1);

    const stillPending = await g.executor.submit(a, AGENT, { approvalId: first.approvalId });
    expect(stillPending.status).toBe("AWAITING_APPROVAL");
    expect(g.approvals.pending()).toHaveLength(1);

    await g.approvals.decide(first.approvalId!, "APPROVED", OWNER, "ok");
    const done = await g.executor.submit(a, OWNER, { approvalId: first.approvalId });
    expect(done.status).toBe("EXECUTED");
    expect(done.result).toEqual({ vendorId: "v_1" });
  });

  it("rejected approvals yield REJECTED", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR");
    const first = await g.executor.submit(a, AGENT);
    await g.approvals.decide(first.approvalId!, "REJECTED", OWNER, "no");
    const rec = await g.executor.submit(a, AGENT, { approvalId: first.approvalId });
    expect(rec.status).toBe("REJECTED");
    expect(rec.blockedReason).toBe("APPROVAL_REJECTED");
  });

  it("phase-one prohibited kinds are BLOCKED before any approval and refuse handler registration", async () => {
    const g = setup();
    expect(() => g.executor.registerHandler("EXECUTE_PAYMENT", async () => ({}))).toThrow(/Phase One/);
    const rec = await g.executor.submit(action("EXECUTE_PAYMENT", { amount: usd("50.00"), context: { movesMoney: true } }), OWNER);
    expect(rec.status).toBe("BLOCKED");
    expect(rec.blockedReason).toBe("PHASE_ONE_SIMULATION_ONLY");
    expect(g.approvals.pending()).toHaveLength(0);
    expect(g.audit.list({ eventType: "ACTION_BLOCKED" })).toHaveLength(1);
  });

  it("handler failures are recorded as FAILED, never thrown", async () => {
    const g = setup();
    g.executor.registerHandler("RUN_RECONCILIATION", async () => {
      throw new Error("boom");
    });
    const rec = await g.executor.submit(action("RUN_RECONCILIATION"), AGENT);
    expect(rec.status).toBe("FAILED");
    expect(rec.blockedReason).toBe("boom");
  });

  it("refuses actions whose text contains a secret", async () => {
    const g = setup();
    await expect(g.executor.submit(action("CALCULATE", { description: "key sk-ant-abcdefghijklmnop" }), AGENT)).rejects.toThrow(/secret/);
  });

  it("capability matrix gates GREEN auto-execution by certified level", async () => {
    const g = setup(true);
    g.executor.registerHandler("CATEGORIZE_TRANSACTION", async () => ({ ok: true }));
    const a = action("CATEGORIZE_TRANSACTION", { amount: usd("20.00"), context: { isRecurringApproved: true } });
    const rec = await g.executor.submit(a, AGENT, { capabilityKey: "transaction_categorization" });
    expect(rec.status).toBe("AWAITING_APPROVAL");
    expect(rec.risk.level).toBe("GREEN");

    g.capabilities!.setLevel("transaction_categorization", 3, OWNER, "passed 3 consecutive eval runs");
    const b = action("CATEGORIZE_TRANSACTION", { amount: usd("20.00"), context: { isRecurringApproved: true } });
    const rec2 = await g.executor.submit(b, AGENT, { capabilityKey: "transaction_categorization" });
    expect(rec2.status).toBe("EXECUTED");
  });

  it("whyDidTheCfoDoThis assembles the full story for an action", async () => {
    const g = setup();
    g.executor.registerHandler("CHANGE_ACCOUNTING_POLICY", async () => ({ policy: "accrual" }));
    const a = action("CHANGE_ACCOUNTING_POLICY", { description: "Switch to accrual basis", reason: "Revenue recognition timing", sourceDocumentIds: ["doc_cpa_memo"] });
    const first = await g.executor.submit(a, AGENT);
    await g.approvals.decide(first.approvalId!, "APPROVED", OWNER, "agreed");
    await g.approvals.decide(first.approvalId!, "APPROVED", CPA, "reviewed");
    const done = await g.executor.submit(a, OWNER, { approvalId: first.approvalId });
    expect(done.status).toBe("EXECUTED");

    const why = whyDidTheCfoDoThis(g.audit, g.dataset, a.id);
    expect(why.resolvedAs).toContain("PROPOSED_ACTION");
    expect(why.steps.map((s) => s.eventType)).toEqual(["APPROVAL_REQUESTED", "ACTION_AWAITING_APPROVAL", "APPROVAL_DECISION", "APPROVAL_DECISION", "ACTION_EXECUTED"]);
    expect(why.approvalIds).toEqual([first.approvalId]);
    expect(why.sourceDocumentIds).toEqual(["doc_cpa_memo"]);
    expect(why.narrative).toContain("Switch to accrual basis");
    expect(why.narrative).toContain("Risk classification: RED");
    expect(why.narrative).toContain("Outcome: EXECUTED");

    const byApproval = whyDidTheCfoDoThis(g.audit, g.dataset, first.approvalId!);
    expect(byApproval.resolvedAs).toContain("APPROVAL");
    expect(byApproval.steps.length).toBe(why.steps.length);

    const unknown = whyDidTheCfoDoThis(g.audit, g.dataset, "nothing_here");
    expect(unknown.resolvedAs).toEqual(["UNKNOWN"]);
    expect(unknown.narrative).toContain("No audit events");
  });
});
