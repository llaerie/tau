/**
 * Approval engine.
 *
 * - `request()` opens a PENDING request (expires in 14 days) and records an audit event.
 * - `decide()` records a per-role decision. YELLOW needs one approval from any listed
 *   role; RED needs an approval from EVERY distinct required role (OWNER plus the
 *   professionals). REJECTED is terminal.
 * - `canExecute()` is the single gate every executor must pass.
 *
 * Multi-approver storage: the `ApprovalRequest` contract has one `decidedBy`, so the
 * full decision trail is kept in `decisionComment` as a JSON string of
 * `ApprovalDecisionRecord[]` (the first record is the REQUESTED marker with the
 * requesting actor). Use `parseDecisions(request)` rather than reading the field.
 * `decidedBy/decidedByRole/decidedAt` reflect the last decision recorded.
 *
 * Segregation of duties: an AGENT or SYSTEM actor can never approve; the actor who
 * requested the approval can never approve it; each actor decides at most once.
 */
import type { ApprovalEngine, AuditLog, DataStore } from "@/lib/core/contracts";
import type { Actor, ApprovalRequest, CompanyDataset, ID, ISODateTime, ProposedAction, RiskAssessment, Role } from "@/lib/core/types";
import { ApprovalRequiredError, ControlViolationError, PermissionDeniedError, TauError } from "@/lib/core/errors";
import { newId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/dates";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { can } from "@/lib/security/rbac";

export const APPROVAL_WORKFLOW_VERSION = "approvals:v1";
export const DEFAULT_APPROVAL_TTL_DAYS = 14;

export interface ApprovalDecisionRecord {
  decision: "REQUESTED" | "APPROVED" | "REJECTED";
  role: Role;
  actor: { type: Actor["type"]; id: string; displayName?: string };
  /** The required role this decision satisfies (for APPROVED). */
  satisfies?: Role[];
  at: ISODateTime;
  comment?: string;
}

export type CanExecuteReason =
  | "GREEN_AUTO_EXECUTABLE"
  | "APPROVED"
  | "PHASE_ONE_SIMULATION_ONLY"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_PENDING"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_WITHDRAWN";

/**
 * Which actor roles satisfy a required approver role. A CPA may stand in for a
 * PAYROLL_PROFESSIONAL (spec: "payroll/compensation → PAYROLL_PROFESSIONAL or CPA").
 */
export const ROLE_SATISFIES: Readonly<Record<Role, readonly Role[]>> = Object.freeze({
  OWNER: ["OWNER"],
  FINANCE_OPERATOR: ["FINANCE_OPERATOR"],
  CPA: ["CPA", "PAYROLL_PROFESSIONAL"],
  PAYROLL_PROFESSIONAL: ["PAYROLL_PROFESSIONAL"],
  ATTORNEY: ["ATTORNEY"],
  AUDITOR: [],
  VIEWER: [],
  SYSTEM: [],
  AGENT: [],
});

export function roleSatisfies(actorRole: Role, required: Role): boolean {
  return ROLE_SATISFIES[actorRole]?.includes(required) ?? false;
}

export function parseDecisions(req: Pick<ApprovalRequest, "decisionComment">): ApprovalDecisionRecord[] {
  if (!req.decisionComment) return [];
  try {
    const parsed: unknown = JSON.parse(req.decisionComment);
    return Array.isArray(parsed) ? (parsed as ApprovalDecisionRecord[]) : [];
  } catch {
    return [];
  }
}

/** Required roles not yet satisfied by an APPROVED decision. */
export function outstandingRoles(req: ApprovalRequest): Role[] {
  const approvals = parseDecisions(req).filter((d) => d.decision === "APPROVED");
  const satisfied = new Set<Role>();
  for (const d of approvals) for (const r of d.satisfies ?? []) satisfied.add(r);
  return req.requestedApproverRoles.filter((r) => !satisfied.has(r));
}

export interface ApprovalEngineOptions {
  now?: () => ISODateTime;
  ttlDays?: number;
  idFn?: () => ID;
}

export class ApprovalEngineImpl implements ApprovalEngine {
  private readonly now: () => ISODateTime;
  private readonly ttlDays: number;
  private readonly idFn: () => ID;

  constructor(
    private readonly store: DataStore,
    private readonly dataset: CompanyDataset,
    private readonly audit: AuditLog,
    opts: ApprovalEngineOptions = {},
  ) {
    this.now = opts.now ?? nowISO;
    this.ttlDays = opts.ttlDays ?? DEFAULT_APPROVAL_TTL_DAYS;
    this.idFn = opts.idFn ?? (() => newId("apr"));
  }

  private expiryFrom(at: ISODateTime): ISODateTime {
    return new Date(new Date(at).getTime() + this.ttlDays * 86_400_000).toISOString();
  }

  private isExpired(req: ApprovalRequest, at: ISODateTime = this.now()): boolean {
    return !!req.expiresAt && at > req.expiresAt;
  }

  private summary(req: ApprovalRequest): Record<string, unknown> {
    return { approvalId: req.id, actionId: req.action.id, kind: req.action.kind, status: req.status, level: req.risk.level, outstandingRoles: outstandingRoles(req) };
  }

  async request(action: ProposedAction, risk: RiskAssessment, requestedBy: Actor): Promise<ApprovalRequest> {
    if (risk.actionId !== action.id) throw new ControlViolationError("Risk assessment does not belong to this action", { actionId: action.id, riskActionId: risk.actionId });
    const at = this.now();
    const requestedRecord: ApprovalDecisionRecord = {
      decision: "REQUESTED",
      role: requestedBy.role,
      actor: { type: requestedBy.type, id: requestedBy.id, displayName: requestedBy.displayName },
      at,
    };
    const req: ApprovalRequest = {
      id: this.idFn(),
      action,
      risk,
      requestedApproverRoles: risk.level === "GREEN" && risk.requiredApproverRoles.length === 0 ? ["OWNER", "FINANCE_OPERATOR"] : [...risk.requiredApproverRoles],
      status: "PENDING",
      requestedAt: at,
      expiresAt: this.expiryFrom(at),
      decisionComment: JSON.stringify([requestedRecord]),
      auditEventIds: [],
    };
    const ev = await this.audit.record({
      actor: requestedBy,
      agent: action.agent === "USER" ? undefined : action.agent,
      workflowVersion: APPROVAL_WORKFLOW_VERSION,
      eventType: "APPROVAL_REQUESTED",
      proposedActionId: action.id,
      approvalIds: [req.id],
      sourceDocumentIds: action.sourceDocumentIds,
      confidence: action.confidence,
      explanation: `Approval requested for ${action.kind} (${risk.level}): ${action.description}. Reasons: ${risk.reasons.join(" ")}`,
      afterState: this.summary(req),
    });
    req.auditEventIds.push(ev.id);
    await this.store.upsert("approvals", req);
    return req;
  }

  async decide(approvalId: ID, decision: "APPROVED" | "REJECTED", actor: Actor, comment?: string): Promise<ApprovalRequest> {
    const req = this.get(approvalId);
    if (!req) throw new TauError("NOT_FOUND", `Approval ${approvalId} not found`, { approvalId });
    const at = this.now();

    if (req.status !== "PENDING") {
      throw new ControlViolationError(`Approval ${approvalId} is ${req.status}; decisions are terminal`, { approvalId, status: req.status });
    }
    if (this.isExpired(req, at)) {
      await this.transition(req, "EXPIRED", actor, "Approval request expired before a decision was recorded.");
      throw new ControlViolationError(`Approval ${approvalId} expired at ${req.expiresAt}`, { approvalId });
    }
    if (actor.type !== "USER" || actor.role === "AGENT" || actor.role === "SYSTEM") {
      throw new ControlViolationError("Segregation of duties: only a human USER may decide an approval", { approvalId, actorType: actor.type, role: actor.role });
    }
    const decisions = parseDecisions(req);
    const requester = decisions.find((d) => d.decision === "REQUESTED");
    if (requester && requester.actor.id === actor.id) {
      throw new ControlViolationError("Segregation of duties: the requesting actor cannot decide their own request", { approvalId, actorId: actor.id });
    }
    if (decisions.some((d) => d.decision !== "REQUESTED" && d.actor.id === actor.id)) {
      throw new ControlViolationError("This actor has already recorded a decision on this request", { approvalId, actorId: actor.id });
    }
    const satisfies = req.requestedApproverRoles.filter((r) => roleSatisfies(actor.role, r));
    const permission = req.risk.level === "RED" ? "APPROVE_RED" : "APPROVE_YELLOW";
    if (satisfies.length === 0 || !can(actor.role, permission)) {
      throw new PermissionDeniedError(`Role ${actor.role} is not an authorized approver for this request`, {
        approvalId,
        requiredRoles: req.requestedApproverRoles,
        actorRole: actor.role,
      });
    }

    const before = this.summary(req);
    const record: ApprovalDecisionRecord = {
      decision,
      role: actor.role,
      actor: { type: actor.type, id: actor.id, displayName: actor.displayName },
      satisfies,
      at,
      comment,
    };
    decisions.push(record);
    req.decisionComment = JSON.stringify(decisions);
    req.decidedAt = at;
    req.decidedBy = actor.id;
    req.decidedByRole = actor.role;

    let finalStatus: ApprovalRequest["status"] = "PENDING";
    if (decision === "REJECTED") finalStatus = "REJECTED";
    else if (req.risk.level === "RED") finalStatus = outstandingRoles(req).length === 0 ? "APPROVED" : "PENDING";
    else finalStatus = "APPROVED";
    req.status = finalStatus;

    const outstanding = outstandingRoles(req);
    const ev = await this.audit.record({
      actor,
      workflowVersion: APPROVAL_WORKFLOW_VERSION,
      eventType: "APPROVAL_DECISION",
      proposedActionId: req.action.id,
      approvalIds: [req.id],
      finalAction: `${decision} by ${actor.role}`,
      explanation:
        `${actor.role} ${actor.id} recorded ${decision} on ${req.action.kind} (${req.risk.level}).` +
        (comment ? ` Comment: ${comment}.` : "") +
        (finalStatus === "PENDING" ? ` Still awaiting: ${outstanding.join(", ")}.` : ` Request is now ${finalStatus}.`),
      beforeState: before,
      afterState: this.summary(req),
    });
    req.auditEventIds.push(ev.id);
    await this.store.upsert("approvals", req);
    return req;
  }

  /** Withdraw a PENDING request (only the requester or an OWNER). */
  async withdraw(approvalId: ID, actor: Actor, reason: string): Promise<ApprovalRequest> {
    const req = this.get(approvalId);
    if (!req) throw new TauError("NOT_FOUND", `Approval ${approvalId} not found`, { approvalId });
    if (req.status !== "PENDING") throw new ControlViolationError(`Approval ${approvalId} is ${req.status}; cannot withdraw`, { approvalId });
    const requester = parseDecisions(req).find((d) => d.decision === "REQUESTED");
    if (actor.role !== "OWNER" && requester?.actor.id !== actor.id) {
      throw new PermissionDeniedError("Only the requester or an OWNER may withdraw a request", { approvalId });
    }
    return this.transition(req, "WITHDRAWN", actor, reason);
  }

  /** Mark stale PENDING requests EXPIRED (call from a monitor). Returns the requests that expired. */
  async expireStale(actor: Actor = { type: "SYSTEM", id: "system", role: "SYSTEM" }): Promise<ApprovalRequest[]> {
    const at = this.now();
    const out: ApprovalRequest[] = [];
    for (const req of this.dataset.approvals) {
      if (req.status === "PENDING" && this.isExpired(req, at)) out.push(await this.transition(req, "EXPIRED", actor, "Expired without a decision."));
    }
    return out;
  }

  private async transition(req: ApprovalRequest, status: "EXPIRED" | "WITHDRAWN", actor: Actor, explanation: string): Promise<ApprovalRequest> {
    const before = this.summary(req);
    req.status = status;
    req.decidedAt = this.now();
    const ev = await this.audit.record({
      actor,
      workflowVersion: APPROVAL_WORKFLOW_VERSION,
      eventType: `APPROVAL_${status}`,
      proposedActionId: req.action.id,
      approvalIds: [req.id],
      explanation,
      beforeState: before,
      afterState: this.summary(req),
    });
    req.auditEventIds.push(ev.id);
    await this.store.upsert("approvals", req);
    return req;
  }

  get(approvalId: ID): ApprovalRequest | undefined {
    return this.dataset.approvals.find((a) => a.id === approvalId);
  }

  pending(): ApprovalRequest[] {
    const at = this.now();
    return this.dataset.approvals.filter((a) => a.status === "PENDING" && !this.isExpired(a, at));
  }

  /** Requests (any status) for an action id. */
  forAction(actionId: ID): ApprovalRequest[] {
    return this.dataset.approvals.filter((a) => a.action.id === actionId);
  }

  canExecute(action: ProposedAction, risk: RiskAssessment, approvalId?: ID): { allowed: boolean; reason: CanExecuteReason } {
    if (isPhaseOneProhibited(action.kind)) return { allowed: false, reason: "PHASE_ONE_SIMULATION_ONLY" };
    if (risk.actionId !== action.id) return { allowed: false, reason: "APPROVAL_REQUIRED" };
    if (risk.level === "GREEN" && risk.autoExecutable && !approvalId) return { allowed: true, reason: "GREEN_AUTO_EXECUTABLE" };
    if (!approvalId) return { allowed: false, reason: "APPROVAL_REQUIRED" };
    const req = this.get(approvalId);
    if (!req) return { allowed: false, reason: "APPROVAL_NOT_FOUND" };
    if (req.action.id !== action.id) return { allowed: false, reason: "APPROVAL_ACTION_MISMATCH" };
    if (req.status === "REJECTED") return { allowed: false, reason: "APPROVAL_REJECTED" };
    if (req.status === "WITHDRAWN") return { allowed: false, reason: "APPROVAL_WITHDRAWN" };
    if (req.status === "EXPIRED" || this.isExpired(req)) return { allowed: false, reason: "APPROVAL_EXPIRED" };
    if (req.status === "PENDING") return { allowed: false, reason: "APPROVAL_PENDING" };
    return { allowed: true, reason: "APPROVED" };
  }

  /** Throws unless the action may execute now. */
  executeGuard(action: ProposedAction, risk: RiskAssessment, approvalId?: ID): void {
    const verdict = this.canExecute(action, risk, approvalId);
    if (verdict.allowed) return;
    const details = { actionId: action.id, kind: action.kind, level: risk.level, approvalId, reason: verdict.reason };
    switch (verdict.reason) {
      case "APPROVAL_REQUIRED":
      case "APPROVAL_PENDING":
      case "APPROVAL_NOT_FOUND":
        throw new ApprovalRequiredError(`${action.kind} requires approval from ${risk.requiredApproverRoles.join(" + ") || "a human"} (${verdict.reason})`, details);
      default:
        throw new ControlViolationError(`${action.kind} may not execute: ${verdict.reason}`, details);
    }
  }
}
