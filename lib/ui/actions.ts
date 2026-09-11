/**
 * UI-originated governed actions. Everything goes through `rt.executor.submit`, so
 * risk classification, approvals and audit apply uniformly. Handlers registered here
 * are the minimal lab handlers for actions the console can trigger; they are only
 * registered when no other subsystem has registered one.
 */
import type { LabRuntime } from "@/lib/db/runtime";
import type { Actor, AgentAction, ProposedAction, ActionKind, Transaction, ID } from "@/lib/core/types";
import { newId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/dates";
import { money } from "@/lib/core/money";
import { TauError } from "@/lib/core/errors";

const g = globalThis as unknown as { __tauUiHandlers?: WeakSet<object> };

export function ensureUiHandlers(rt: LabRuntime): void {
  g.__tauUiHandlers ??= new WeakSet<object>();
  if (g.__tauUiHandlers.has(rt)) return;
  g.__tauUiHandlers.add(rt);
  const ex = rt.executor;

  if (!ex.hasHandler("CATEGORIZE_TRANSACTION")) {
    ex.registerHandler("CATEGORIZE_TRANSACTION", async (action, ctx) => {
      const txId = action.targetIds[0];
      const tx = ctx.dataset.transactions.find((t) => t.id === txId);
      if (!tx) throw new TauError("NOT_FOUND", `Transaction ${txId} not found`);
      const accountId = String(action.payload.accountId ?? "");
      if (!accountId) throw new TauError("BAD_REQUEST", "accountId is required");
      const next: Transaction = {
        ...tx,
        category: { ...tx.category, accountId, status: "APPROVED", confidence: 1, approvedBy: ctx.actor.id, suggestedBy: tx.category.suggestedBy ?? "USER", reason: String(action.payload.reason ?? tx.category.reason ?? "Approved in console") },
        flags: tx.flags.filter((f) => f !== "UNCATEGORIZED"),
      };
      await ctx.store.upsert("transactions", next);
      return { transactionId: tx.id, accountId };
    });
  }

  if (!ex.hasHandler("POST_JOURNAL_ENTRY")) {
    ex.registerHandler("POST_JOURNAL_ENTRY", (action, ctx) => {
      const entry = rt.ledger.postEntry(action.targetIds[0], ctx.actor, ctx.approvalId);
      return { entryId: entry.id, status: entry.status };
    });
  }

  if (!ex.hasHandler("LOCK_PERIOD")) {
    ex.registerHandler("LOCK_PERIOD", (action, ctx) => {
      if (!ctx.approvalId) throw new TauError("APPROVAL_REQUIRED", "Locking a period requires an approval id");
      const p = rt.ledger.lockPeriod(action.targetIds[0], ctx.actor, ctx.approvalId);
      return { periodId: p.id, status: p.status };
    });
  }

  if (!ex.hasHandler("UNLOCK_PERIOD")) {
    ex.registerHandler("UNLOCK_PERIOD", (action, ctx) => {
      if (!ctx.approvalId) throw new TauError("APPROVAL_REQUIRED", "Unlocking a period requires an approval id");
      const p = rt.ledger.unlockPeriod(action.targetIds[0], ctx.actor, ctx.approvalId, String(action.payload.reason ?? action.reason));
      return { periodId: p.id, status: p.status };
    });
  }
}

export interface ProposeInput {
  kind: ActionKind;
  description: string;
  reason: string;
  targetIds?: ID[];
  payload?: Record<string, unknown>;
  amount?: { amount: string; currency?: string } | null;
  confidence?: number;
  reversible?: boolean;
  rollbackPlan?: string;
  sourceDocumentIds?: ID[];
  alternatives?: string[];
  financialImpact?: string;
  context?: ProposedAction["context"];
  capabilityKey?: string;
  approvalId?: ID;
}

export function proposedAction(input: ProposeInput): ProposedAction {
  return {
    id: newId("act"),
    kind: input.kind,
    agent: "USER",
    description: input.description,
    amount: input.amount ? { amount: money(input.amount.amount), currency: input.amount.currency ?? "USD" } : undefined,
    targetIds: input.targetIds ?? [],
    payload: input.payload ?? {},
    reason: input.reason,
    financialImpact: input.financialImpact,
    sourceDocumentIds: input.sourceDocumentIds ?? [],
    confidence: input.confidence ?? 1,
    alternatives: input.alternatives,
    reversible: input.reversible ?? true,
    rollbackPlan: input.rollbackPlan,
    createdAt: nowISO(),
    context: input.context,
  };
}

/** Submit a console-originated action through the governance pipeline. */
export async function submitUiAction(rt: LabRuntime, actor: Actor, input: ProposeInput): Promise<AgentAction> {
  ensureUiHandlers(rt);
  const action = proposedAction(input);
  const result = await rt.executor.submit(action, actor, { approvalId: input.approvalId, capabilityKey: input.capabilityKey });
  await rt.flush();
  return result;
}

/** Execute an APPROVED request's action (Phase One prohibited kinds stay BLOCKED). */
export async function executeApproved(rt: LabRuntime, actor: Actor, approvalId: ID): Promise<AgentAction | null> {
  ensureUiHandlers(rt);
  const req = rt.approvals.get(approvalId);
  if (!req || req.status !== "APPROVED") return null;
  const result = await rt.executor.submit(req.action, actor, { approvalId });
  await rt.flush();
  return result;
}
