/**
 * Governance step of the agent pipeline: every ProposedAction a tool emits is risk-assessed and
 * submitted to the ActionExecutor, which either executes it (GREEN + capability level allows),
 * queues an approval request (YELLOW/RED), or blocks it (Phase One prohibited kinds).
 *
 * RED actions never execute here. Prohibited kinds (payments, payroll execution, tax filing,
 * signing, entity changes) are reported as BLOCKED with a REFUSED_CONTROL_VIOLATION escalation
 * and the prepared package is returned instead.
 */
import type { Escalation, ExecutiveResponse, NewJournalEntryInput, ToolContext } from "@/lib/core/contracts";
import type { AgentAction, ID, ProposedAction, RiskLevel, Transaction } from "@/lib/core/types";
import { ActionExecutor } from "@/lib/approvals/action-executor";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { can } from "@/lib/security/rbac";
import { needsApprovalEntry } from "./response";

export interface GovernanceOutcome {
  agentActions: AgentAction[];
  needsApproval: ExecutiveResponse["needsApproval"];
  escalation?: Escalation;
  /** Highest risk level among the proposed actions (null when none). */
  riskLevel: RiskLevel | null;
  actionsExecuted: number;
  approvalIds: ID[];
  /** Actions that were not submitted because the actor lacks PROPOSE_ACTIONS. */
  permissionDenied: ProposedAction[];
}

const RANK: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function maxRisk(levels: (RiskLevel | null | undefined)[]): RiskLevel | null {
  let best: RiskLevel | null = null;
  for (const l of levels) if (l && (!best || RANK[l] > RANK[best])) best = l;
  return best;
}

/** Register the executable handlers for the routine (GREEN-capable) kinds. Everything else is simulated. */
export function registerAgentHandlers(executor: ActionExecutor, ctx: ToolContext): void {
  executor.registerHandler("CREATE_JOURNAL_ENTRY", (action, h) => {
    const entry = action.payload.entry as NewJournalEntryInput | undefined;
    if (!entry) throw new Error("CREATE_JOURNAL_ENTRY payload.entry missing");
    const created = ctx.ledger.createEntry({ ...entry, post: false, approvalId: h.approvalId ?? entry.approvalId }, h.actor);
    return { journalEntryId: created.id, status: created.status };
  });
  executor.registerHandler("POST_JOURNAL_ENTRY", (action, h) => {
    const entryId = action.payload.entryId as ID | undefined;
    if (!entryId) throw new Error("POST_JOURNAL_ENTRY payload.entryId missing");
    const posted = ctx.ledger.postEntry(entryId, h.actor, h.approvalId);
    return { journalEntryId: posted.id, status: posted.status };
  });
  executor.registerHandler("CATEGORIZE_TRANSACTION", async (action, h) => {
    const txId = action.payload.transactionId as ID | undefined;
    const accountId = action.payload.accountId as ID | undefined;
    const tx = ctx.dataset.transactions.find((t) => t.id === txId);
    if (!tx || !accountId) throw new Error("CATEGORIZE_TRANSACTION payload incomplete");
    const next: Transaction = { ...tx, category: { ...tx.category, accountId, status: h.approvalId ? "APPROVED" : "SUGGESTED", confidence: action.confidence, reason: action.reason, suggestedBy: action.agent === "USER" ? "USER" : action.agent, approvedBy: h.approvalId ? h.actor.id : undefined } };
    const idx = ctx.dataset.transactions.indexOf(tx);
    ctx.dataset.transactions[idx] = next;
    await h.store.upsert("transactions", next);
    return { transactionId: tx.id, accountId, status: next.category.status };
  });
  executor.registerHandler("FLAG_MISSING_RECEIPT", async (action, h) => {
    const ids = (action.targetIds ?? []) as ID[];
    for (const id of ids) {
      const tx = ctx.dataset.transactions.find((t) => t.id === id);
      if (!tx || tx.flags.includes("MISSING_RECEIPT")) continue;
      tx.flags = [...tx.flags, "MISSING_RECEIPT"];
      await h.store.upsert("transactions", tx);
    }
    return { flagged: ids.length };
  });
}

/** Submit every proposed action through the executor and summarize the outcome for the response. */
export async function governProposedActions(actions: ProposedAction[], ctx: ToolContext, capabilityKey: string): Promise<GovernanceOutcome> {
  const outcome: GovernanceOutcome = { agentActions: [], needsApproval: [], riskLevel: null, actionsExecuted: 0, approvalIds: [], permissionDenied: [] };
  if (!actions.length) return outcome;
  if (!can(ctx.actor.role, "PROPOSE_ACTIONS")) {
    outcome.permissionDenied = actions;
    outcome.riskLevel = maxRisk(actions.map((a) => ctx.risk.assess(a, { thresholds: ctx.thresholds }).level));
    outcome.escalation = {
      type: "REFUSED_CONTROL_VIOLATION",
      message: `Role ${ctx.actor.role} lacks the PROPOSE_ACTIONS permission; ${actions.length} proposed action(s) were not submitted. The analysis is provided for information only.`,
      requiredRole: "FINANCE_OPERATOR",
    };
    return outcome;
  }
  const executor = new ActionExecutor({ store: ctx.store, dataset: ctx.dataset, risk: ctx.risk, approvals: ctx.approvals, capabilities: ctx.capabilities, thresholds: ctx.thresholds, audit: ctx.audit });
  registerAgentHandlers(executor, ctx);
  const levels: RiskLevel[] = [];
  let prohibited = 0;
  let awaiting = 0;
  for (const action of actions) {
    const approvalId = typeof action.payload.approvalId === "string" ? action.payload.approvalId : undefined;
    const record = await executor.submit(action, ctx.actor, { capabilityKey, approvalId });
    outcome.agentActions.push(record);
    levels.push(record.risk.level);
    if (record.approvalId) outcome.approvalIds.push(record.approvalId);
    if (record.status === "EXECUTED") outcome.actionsExecuted += 1;
    if (record.status === "AWAITING_APPROVAL") {
      awaiting += 1;
      const req = record.approvalId ? ctx.approvals.get(record.approvalId) : undefined;
      outcome.needsApproval.push(needsApprovalEntry(action, record.risk.level, req?.requestedApproverRoles ?? record.risk.requiredApproverRoles));
    }
    if (record.status === "BLOCKED" && isPhaseOneProhibited(action.kind)) {
      prohibited += 1;
      outcome.needsApproval.push(needsApprovalEntry(action, record.risk.level, record.risk.requiredApproverRoles));
    }
  }
  outcome.riskLevel = maxRisk(levels);
  if (prohibited) {
    const kinds = [...new Set(outcome.agentActions.filter((a) => a.status === "BLOCKED").map((a) => a.action.kind))];
    outcome.escalation = {
      type: "REFUSED_CONTROL_VIOLATION",
      message: `${kinds.join(", ")} cannot execute in Phase One (simulation only) — even with an approval. The prepared package is returned instead so a human can act through the bank, payroll provider or CPA.`,
      requiredRole: "OWNER",
    };
  } else if (awaiting) {
    outcome.escalation = {
      type: "APPROVAL_REQUIRED",
      message: `${awaiting} proposed action(s) require human approval before anything changes. Nothing has been executed.`,
      requiredRole: outcome.needsApproval[0]?.approverRoles[0] ?? "OWNER",
    };
  }
  return outcome;
}
