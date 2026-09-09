import { describe, expect, it } from "vitest";
import { ApprovalRequiredError, ControlViolationError, PermissionDeniedError } from "@/lib/core/errors";
import { outstandingRoles, parseDecisions } from "@/lib/approvals/approval-engine";
import { action, makeGovernance, usd, OWNER, OPERATOR, CPA, PAYROLL_PRO, ATTORNEY, VIEWER, AGENT } from "./helpers";

function setup() {
  const g = makeGovernance();
  const assess = (a: Parameters<typeof g.risk.assess>[0]) => g.risk.assess(a, { thresholds: g.thresholds });
  return { ...g, assess };
}

describe("approval requests", () => {
  it("request() creates a PENDING request expiring in 14 days and records an audit event", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR");
    const r = g.assess(a);
    const req = await g.approvals.request(a, r, AGENT);
    expect(req.status).toBe("PENDING");
    expect(req.requestedAt).toBe("2026-09-09T12:00:00.000Z");
    expect(req.expiresAt).toBe("2026-09-23T12:00:00.000Z");
    expect(req.requestedApproverRoles).toEqual(["OWNER", "FINANCE_OPERATOR"]);
    expect(req.auditEventIds).toHaveLength(1);
    expect(g.dataset.approvals).toHaveLength(1);
    const ev = g.audit.list({ eventType: "APPROVAL_REQUESTED" });
    expect(ev).toHaveLength(1);
    expect(ev[0].proposedActionId).toBe(a.id);
    expect(ev[0].approvalIds).toEqual([req.id]);
    expect(g.approvals.pending().map((p) => p.id)).toEqual([req.id]);
    expect(parseDecisions(req)[0]).toMatchObject({ decision: "REQUESTED", actor: { id: AGENT.id } });
  });

  it("RED cannot execute without approval; the guard throws ApprovalRequiredError", () => {
    const g = setup();
    const a = action("UNLOCK_PERIOD");
    const r = g.assess(a);
    expect(g.approvals.canExecute(a, r)).toEqual({ allowed: false, reason: "APPROVAL_REQUIRED" });
    expect(() => g.approvals.executeGuard(a, r)).toThrow(ApprovalRequiredError);
    expect(() => g.approvals.executeGuard(a, r, "apr_missing")).toThrow(ApprovalRequiredError);
  });

  it("GREEN auto-executable actions may execute with no approval", () => {
    const g = setup();
    const a = action("CALCULATE");
    const r = g.assess(a);
    expect(g.approvals.canExecute(a, r)).toEqual({ allowed: true, reason: "GREEN_AUTO_EXECUTABLE" });
    expect(() => g.approvals.executeGuard(a, r)).not.toThrow();
  });

  it("an agent can never approve (segregation of duties)", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR");
    const req = await g.approvals.request(a, g.assess(a), OPERATOR);
    await expect(g.approvals.decide(req.id, "APPROVED", AGENT)).rejects.toThrow(ControlViolationError);
    await expect(g.approvals.decide(req.id, "APPROVED", { type: "SYSTEM", id: "sys", role: "SYSTEM" })).rejects.toThrow(ControlViolationError);
    expect(g.approvals.get(req.id)?.status).toBe("PENDING");
  });

  it("the requesting user cannot approve their own request", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR", { agent: "USER" });
    const req = await g.approvals.request(a, g.assess(a), OWNER);
    await expect(g.approvals.decide(req.id, "APPROVED", OWNER)).rejects.toThrow(/Segregation of duties/);
    const ok = await g.approvals.decide(req.id, "APPROVED", OPERATOR);
    expect(ok.status).toBe("APPROVED");
  });

  it("wrong role is rejected", async () => {
    const g = setup();
    const a = action("REIMBURSEMENT", { amount: usd("120.00") });
    const req = await g.approvals.request(a, g.assess(a), AGENT);
    await expect(g.approvals.decide(req.id, "APPROVED", VIEWER)).rejects.toThrow(PermissionDeniedError);
    await expect(g.approvals.decide(req.id, "APPROVED", CPA)).rejects.toThrow(PermissionDeniedError);
    expect(g.approvals.get(req.id)?.status).toBe("PENDING");
  });

  it("YELLOW: either OWNER or FINANCE_OPERATOR suffices", async () => {
    const g = setup();
    const a1 = action("CREATE_CUSTOMER");
    const r1 = await g.approvals.request(a1, g.assess(a1), AGENT);
    const d1 = await g.approvals.decide(r1.id, "APPROVED", OPERATOR, "looks right");
    expect(d1.status).toBe("APPROVED");
    expect(d1.decidedBy).toBe(OPERATOR.id);
    expect(d1.decidedByRole).toBe("FINANCE_OPERATOR");
    expect(g.approvals.canExecute(a1, g.assess(a1), r1.id)).toEqual({ allowed: true, reason: "APPROVED" });

    const a2 = action("CREATE_CUSTOMER");
    const r2 = await g.approvals.request(a2, g.assess(a2), AGENT);
    expect((await g.approvals.decide(r2.id, "APPROVED", OWNER)).status).toBe("APPROVED");
  });

  it("multi-role RED needs approval from every required role", async () => {
    const g = setup();
    const a = action("CLASSIFY_INTERNATIONAL_WORKER");
    const risk = g.assess(a);
    expect(risk.requiredApproverRoles.sort()).toEqual(["ATTORNEY", "CPA", "OWNER"]);
    const req = await g.approvals.request(a, risk, AGENT);

    const afterOwner = await g.approvals.decide(req.id, "APPROVED", OWNER);
    expect(afterOwner.status).toBe("PENDING");
    expect(outstandingRoles(afterOwner).sort()).toEqual(["ATTORNEY", "CPA"]);
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: false, reason: "APPROVAL_PENDING" });

    const afterCpa = await g.approvals.decide(req.id, "APPROVED", CPA);
    expect(afterCpa.status).toBe("PENDING");
    expect(outstandingRoles(afterCpa)).toEqual(["ATTORNEY"]);

    const afterAtty = await g.approvals.decide(req.id, "APPROVED", ATTORNEY, "classification reviewed");
    expect(afterAtty.status).toBe("APPROVED");
    expect(parseDecisions(afterAtty).filter((d) => d.decision === "APPROVED")).toHaveLength(3);
    expect(afterAtty.auditEventIds).toHaveLength(4);
    // CLASSIFY_INTERNATIONAL_WORKER is not phase-one prohibited, so it may now execute
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: true, reason: "APPROVED" });
  });

  it("a CPA satisfies the PAYROLL_PROFESSIONAL slot; owner alone does not approve RED payroll", async () => {
    const g = setup();
    const a = action("SET_COMPENSATION_POLICY");
    const risk = g.assess(a);
    const req = await g.approvals.request(a, risk, AGENT);
    expect((await g.approvals.decide(req.id, "APPROVED", OWNER)).status).toBe("PENDING");
    expect((await g.approvals.decide(req.id, "APPROVED", CPA)).status).toBe("APPROVED");

    const b = action("SET_COMPENSATION_POLICY");
    const req2 = await g.approvals.request(b, g.assess(b), AGENT);
    expect((await g.approvals.decide(req2.id, "APPROVED", PAYROLL_PRO)).status).toBe("PENDING");
    expect((await g.approvals.decide(req2.id, "APPROVED", OWNER)).status).toBe("APPROVED");
  });

  it("the same actor cannot record two decisions", async () => {
    const g = setup();
    const a = action("CHANGE_ACCOUNTING_POLICY");
    const req = await g.approvals.request(a, g.assess(a), AGENT);
    await g.approvals.decide(req.id, "APPROVED", OWNER);
    await expect(g.approvals.decide(req.id, "APPROVED", OWNER)).rejects.toThrow(/already recorded/);
  });

  it("REJECTED is terminal", async () => {
    const g = setup();
    const a = action("PROPOSE_DISTRIBUTION", { amount: usd("2500.00") });
    const risk = g.assess(a);
    const req = await g.approvals.request(a, risk, AGENT);
    const rej = await g.approvals.decide(req.id, "REJECTED", OWNER, "not now");
    expect(rej.status).toBe("REJECTED");
    await expect(g.approvals.decide(req.id, "APPROVED", OPERATOR)).rejects.toThrow(ControlViolationError);
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: false, reason: "APPROVAL_REJECTED" });
    expect(() => g.approvals.executeGuard(a, risk, req.id)).toThrow(ControlViolationError);
    expect(g.approvals.pending()).toHaveLength(0);
  });

  it("expired request is not executable and cannot be decided", async () => {
    const g = setup();
    const a = action("LOCK_PERIOD");
    const risk = g.assess(a);
    const req = await g.approvals.request(a, risk, AGENT);
    g.clock.advanceDays(15);
    expect(g.approvals.pending()).toHaveLength(0);
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: false, reason: "APPROVAL_EXPIRED" });
    await expect(g.approvals.decide(req.id, "APPROVED", OWNER)).rejects.toThrow(/expired/);
    expect(g.approvals.get(req.id)?.status).toBe("EXPIRED");
    expect(g.audit.list({ eventType: "APPROVAL_EXPIRED" })).toHaveLength(1);
  });

  it("an approval that was granted but not used within its window expires", async () => {
    const g = setup();
    const a = action("LOCK_PERIOD");
    const risk = g.assess(a);
    const req = await g.approvals.request(a, risk, AGENT);
    await g.approvals.decide(req.id, "APPROVED", OWNER);
    expect(g.approvals.canExecute(a, risk, req.id).allowed).toBe(true);
    g.clock.advanceDays(20);
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: false, reason: "APPROVAL_EXPIRED" });
  });

  it("approval for a different action does not transfer", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR");
    const b = action("CREATE_VENDOR");
    const req = await g.approvals.request(a, g.assess(a), AGENT);
    await g.approvals.decide(req.id, "APPROVED", OWNER);
    expect(g.approvals.canExecute(b, g.assess(b), req.id)).toEqual({ allowed: false, reason: "APPROVAL_ACTION_MISMATCH" });
  });

  it("phase-one prohibited kinds are blocked even when fully approved", async () => {
    const g = setup();
    const a = action("EXECUTE_PAYMENT", { amount: usd("100.00"), context: { movesMoney: true } });
    const risk = g.assess(a);
    const req = await g.approvals.request(a, risk, AGENT);
    const approved = await g.approvals.decide(req.id, "APPROVED", OWNER);
    expect(approved.status).toBe("APPROVED");
    expect(g.approvals.canExecute(a, risk, req.id)).toEqual({ allowed: false, reason: "PHASE_ONE_SIMULATION_ONLY" });
    expect(() => g.approvals.executeGuard(a, risk, req.id)).toThrow(/PHASE_ONE_SIMULATION_ONLY/);

    const tax = action("FILE_TAX_RETURN");
    const taxRisk = g.assess(tax);
    const taxReq = await g.approvals.request(tax, taxRisk, AGENT);
    await g.approvals.decide(taxReq.id, "APPROVED", OWNER);
    await g.approvals.decide(taxReq.id, "APPROVED", CPA);
    expect(g.approvals.get(taxReq.id)?.status).toBe("APPROVED");
    expect(g.approvals.canExecute(tax, taxRisk, taxReq.id).reason).toBe("PHASE_ONE_SIMULATION_ONLY");
  });

  it("withdraw is limited to the requester or owner and is terminal", async () => {
    const g = setup();
    const a = action("CREATE_VENDOR");
    const req = await g.approvals.request(a, g.assess(a), OPERATOR);
    await expect(g.approvals.withdraw(req.id, VIEWER, "nope")).rejects.toThrow(PermissionDeniedError);
    const w = await g.approvals.withdraw(req.id, OPERATOR, "duplicate request");
    expect(w.status).toBe("WITHDRAWN");
    await expect(g.approvals.decide(req.id, "APPROVED", OWNER)).rejects.toThrow(ControlViolationError);
  });

  it("every decision is audited and the chain stays valid", async () => {
    const g = setup();
    const a = action("CHANGE_ENTITY");
    const req = await g.approvals.request(a, g.assess(a), AGENT);
    await g.approvals.decide(req.id, "APPROVED", OWNER);
    await g.approvals.decide(req.id, "APPROVED", CPA);
    await g.approvals.decide(req.id, "APPROVED", ATTORNEY);
    expect(g.audit.list({ eventType: "APPROVAL_DECISION" })).toHaveLength(3);
    expect(g.audit.verifyChain()).toMatchObject({ valid: true, count: 4 });
  });
});
