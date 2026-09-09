/**
 * Action executor: the only path from a ProposedAction to a side effect.
 *
 * submit(action) → assess risk → one of
 *   (a) EXECUTED / SIMULATED  when the approval engine (and capability matrix) allow it,
 *   (b) AWAITING_APPROVAL      when an approval request was opened (or is still pending),
 *   (c) BLOCKED / REJECTED     when execution is impossible (Phase One prohibition, rejected,
 *                              expired, mismatched approval).
 * Every outcome records an AgentAction and an audit event with before/after state.
 */
import type { ApprovalEngine, AuditLog, CapabilityMatrix, DataStore, MaterialityThresholds, RiskEngine } from "@/lib/core/contracts";
import type { ActionKind, Actor, AgentAction, AgentActionStatus, CompanyDataset, ID, ISODateTime, ProposedAction, RiskAssessment } from "@/lib/core/types";
import { newId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/dates";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { assertNoSecretsInText } from "@/lib/security/secrets";

export const EXECUTOR_WORKFLOW_VERSION = "action-executor:v1";

export interface HandlerContext {
  actor: Actor;
  approvalId?: ID;
  risk: RiskAssessment;
  dataset: CompanyDataset;
  store: DataStore;
}

export type ActionHandler = (action: ProposedAction, ctx: HandlerContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

export interface ActionExecutorDeps {
  store: DataStore;
  dataset: CompanyDataset;
  risk: RiskEngine;
  approvals: ApprovalEngine;
  audit: AuditLog;
  thresholds: MaterialityThresholds;
  /** Optional: gate GREEN auto-execution on the agent's certified level for the capability. */
  capabilities?: CapabilityMatrix;
  now?: () => ISODateTime;
  idFn?: () => ID;
}

export interface SubmitOptions {
  approvalId?: ID;
  /** Capability key used for the competency gate (when a matrix is configured). */
  capabilityKey?: string;
}

export class ActionExecutor {
  private readonly handlers = new Map<ActionKind, ActionHandler>();
  private readonly now: () => ISODateTime;
  private readonly idFn: () => ID;

  constructor(private readonly deps: ActionExecutorDeps) {
    this.now = deps.now ?? nowISO;
    this.idFn = deps.idFn ?? (() => newId("act"));
  }

  registerHandler(kind: ActionKind, fn: ActionHandler): void {
    if (isPhaseOneProhibited(kind)) throw new Error(`Refusing to register a handler for ${kind}: Phase One simulation only`);
    this.handlers.set(kind, fn);
  }

  hasHandler(kind: ActionKind): boolean {
    return this.handlers.has(kind);
  }

  assess(action: ProposedAction, capabilityKey?: string): RiskAssessment {
    const level = capabilityKey && this.deps.capabilities ? this.deps.capabilities.getLevel(capabilityKey) : undefined;
    return this.deps.risk.assess(action, { thresholds: this.deps.thresholds, capabilityLevel: level });
  }

  async submit(action: ProposedAction, actor: Actor, opts: SubmitOptions = {}): Promise<AgentAction> {
    assertNoSecretsInText(`${action.description}\n${action.reason}`, `action ${action.id}`);
    const risk = this.assess(action, opts.capabilityKey);
    const record: AgentAction = { id: this.idFn(), action, risk, status: "PROPOSED", approvalId: opts.approvalId };
    const before = this.snapshot(record);

    if (isPhaseOneProhibited(action.kind)) {
      return this.finish(record, actor, "BLOCKED", before, { blockedReason: "PHASE_ONE_SIMULATION_ONLY" });
    }

    const verdict = this.deps.approvals.canExecute(action, risk, opts.approvalId);
    if (verdict.allowed) {
      const key = opts.capabilityKey;
      if (!opts.approvalId && key && this.deps.capabilities && !this.deps.capabilities.mayAutoExecute(key, risk.level)) {
        const req = await this.deps.approvals.request(action, risk, actor);
        record.approvalId = req.id;
        return this.finish(record, actor, "AWAITING_APPROVAL", before, {
          note: `Capability ${key} is below the level required for autonomous ${risk.level} execution; approval requested.`,
        });
      }
      return this.execute(record, actor, before);
    }

    switch (verdict.reason) {
      case "APPROVAL_REQUIRED":
      case "APPROVAL_NOT_FOUND": {
        const req = await this.deps.approvals.request(action, risk, actor);
        record.approvalId = req.id;
        return this.finish(record, actor, "AWAITING_APPROVAL", before, { note: `Approval requested from ${req.requestedApproverRoles.join(", ")}.` });
      }
      case "APPROVAL_PENDING":
        return this.finish(record, actor, "AWAITING_APPROVAL", before, { note: "Approval still pending." });
      case "APPROVAL_REJECTED":
        return this.finish(record, actor, "REJECTED", before, { blockedReason: verdict.reason });
      default:
        return this.finish(record, actor, "BLOCKED", before, { blockedReason: verdict.reason });
    }
  }

  private async execute(record: AgentAction, actor: Actor, before: Record<string, unknown>): Promise<AgentAction> {
    const handler = this.handlers.get(record.action.kind);
    if (!handler) {
      return this.finish(record, actor, "SIMULATED", before, {
        result: { simulated: true, note: `No handler registered for ${record.action.kind}; recorded as simulated.` },
      });
    }
    try {
      const result = await handler(record.action, { actor, approvalId: record.approvalId, risk: record.risk, dataset: this.deps.dataset, store: this.deps.store });
      return this.finish(record, actor, "EXECUTED", before, { result: result ?? {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.finish(record, actor, "FAILED", before, { blockedReason: message });
    }
  }

  private snapshot(r: AgentAction): Record<string, unknown> {
    return { agentActionId: r.id, actionId: r.action.id, kind: r.action.kind, status: r.status, level: r.risk.level, approvalId: r.approvalId, amount: r.action.amount };
  }

  private async finish(
    record: AgentAction,
    actor: Actor,
    status: AgentActionStatus,
    before: Record<string, unknown>,
    extra: { result?: Record<string, unknown>; blockedReason?: string; note?: string },
  ): Promise<AgentAction> {
    record.status = status;
    if (extra.result) record.result = extra.result;
    if (extra.blockedReason) record.blockedReason = extra.blockedReason;
    if (status === "EXECUTED" || status === "SIMULATED") record.executedAt = this.now();
    const a = record.action;
    const ev = await this.deps.audit.record({
      actor,
      agent: a.agent === "USER" ? undefined : a.agent,
      workflowVersion: EXECUTOR_WORKFLOW_VERSION,
      eventType: `ACTION_${status}`,
      proposedActionId: a.id,
      approvalIds: record.approvalId ? [record.approvalId] : [],
      sourceDocumentIds: a.sourceDocumentIds,
      calculationIds: typeof a.payload?.calcIds === "object" && Array.isArray(a.payload.calcIds) ? (a.payload.calcIds as ID[]) : [],
      confidence: a.confidence,
      finalAction: `${a.kind} → ${status}`,
      explanation: [
        `${a.kind} proposed by ${a.agent}: ${a.description}`,
        `Reason: ${a.reason}`,
        `Risk ${record.risk.level} (${record.risk.policyRefs.join(", ") || "no policy refs"}): ${record.risk.reasons.join(" ")}`,
        `Outcome: ${status}${extra.blockedReason ? ` (${extra.blockedReason})` : ""}${extra.note ? ` — ${extra.note}` : ""}`,
      ].join("\n"),
      beforeState: before,
      afterState: { ...this.snapshot(record), result: record.result, blockedReason: record.blockedReason },
    });
    record.auditEventId = ev.id;
    await this.deps.store.upsert("agentActions", record);
    return record;
  }
}
