/**
 * Verification isolation: the auditor agent works on a fresh Ledger over a structuredClone of
 * the dataset so that verification can never mutate shared state, and shared state can never
 * mutate mid-verification. Governance objects (audit log, approvals, risk, capabilities)
 * remain the real ones so the auditor's own trail is still recorded.
 */
import type { ToolContext } from "@/lib/core/contracts";
import type { CompanyDataset } from "@/lib/core/types";
import { Ledger } from "@/lib/accounting/ledger";
import { MemoryStore } from "@/lib/db/memory-store";

export interface IsolatedContext extends ToolContext {
  /** True when this context is a verification clone. */
  isolated: true;
  /** The live dataset the clone was taken from (read for comparison only). */
  sourceDataset: CompanyDataset;
}

export function isIsolatedContext(ctx: ToolContext): ctx is IsolatedContext {
  return (ctx as IsolatedContext).isolated === true;
}

/** Clone everything except the append-only governance collections, which stay shared by reference-copy. */
export function cloneDatasetForVerification(dataset: CompanyDataset): CompanyDataset {
  const { auditEvents, approvals, agentActions, evaluations, competencyScores, ...rest } = dataset;
  const cloned = structuredClone(rest) as Omit<CompanyDataset, "auditEvents" | "approvals" | "agentActions" | "evaluations" | "competencyScores">;
  return { ...cloned, auditEvents: [...auditEvents], approvals: [...approvals], agentActions: [...agentActions], evaluations: [...evaluations], competencyScores: [...competencyScores] };
}

/** Build an isolated ToolContext: cloned dataset, fresh Ledger, throwaway store. */
export function isolateForVerification(ctx: ToolContext): IsolatedContext {
  if (isIsolatedContext(ctx)) return ctx;
  const dataset = cloneDatasetForVerification(ctx.dataset);
  const store = new MemoryStore(dataset);
  const ledger = new Ledger(dataset);
  return { ...ctx, dataset, store, ledger, isolated: true, sourceDataset: ctx.dataset };
}
