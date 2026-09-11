/**
 * Bridge from a ToolContext to the `LabRuntime`-shaped object that lib/workflows and
 * lib/monitors expect, plus lazy loaders that degrade gracefully when those modules are
 * not built yet (the agent answers with an OUT_OF_SCOPE escalation instead of crashing).
 */
import type { ToolContext } from "@/lib/core/contracts";
import { buildFinanceBible } from "@/lib/knowledge/finance-bible";
import { GuidanceStore } from "@/lib/knowledge/guidance";
import { CpaReviewQueue } from "@/lib/tax/cpa-queue";
import { TaxRuleStore } from "@/lib/tax/rule-store";
import type { CompanyDataset } from "@/lib/core/types";

const queues = new WeakMap<CompanyDataset, CpaReviewQueue>();
const ruleStores = new WeakMap<CompanyDataset, { size: number; store: TaxRuleStore }>();

/** One CPA review queue per dataset (the runtime's own queue is not reachable from a ToolContext). */
export function cpaQueueFor(dataset: CompanyDataset): CpaReviewQueue {
  let q = queues.get(dataset);
  if (!q) {
    q = new CpaReviewQueue();
    queues.set(dataset, q);
  }
  return q;
}

/** TaxRuleStore built from the dataset's knowledge sources and rules; rules citing unknown sources are skipped (never guessed). */
export function taxRuleStoreFor(dataset: CompanyDataset): TaxRuleStore {
  const cached = ruleStores.get(dataset);
  const size = dataset.taxRules.length + dataset.knowledgeSources.length;
  if (cached && cached.size === size) return cached.store;
  const store = new TaxRuleStore(dataset.knowledgeSources, []);
  for (const r of dataset.taxRules) {
    try {
      store.add(r);
    } catch {
      /* rule cites an unregistered source: unusable by definition */
    }
  }
  ruleStores.set(dataset, { size, store });
  return store;
}

export function runtimeFromContext(ctx: ToolContext): Record<string, unknown> {
  return {
    store: ctx.store,
    dataset: ctx.dataset,
    ledger: ctx.ledger,
    audit: ctx.audit,
    risk: ctx.risk,
    approvals: ctx.approvals,
    capabilities: ctx.capabilities,
    models: ctx.models,
    retriever: ctx.retriever,
    thresholds: ctx.thresholds,
    taxRules: taxRuleStoreFor(ctx.dataset),
    cpaQueue: cpaQueueFor(ctx.dataset),
    guidance: new GuidanceStore(ctx.dataset.professionalGuidance),
    bible: buildFinanceBible(),
    policies: ctx.dataset.policies,
    asOfDate: ctx.asOfDate,
    simulationOnly: true,
    async reindex() {},
    async flush() {
      await ctx.store.flush();
    },
  };
}

export type WorkflowsModule = {
  buildWeeklyBrief?: (rt: unknown, asOf?: string) => Promise<unknown>;
  runMonthEndClose?: (rt: unknown, periodId: string, actor: unknown, opts?: { lock?: boolean; approvalId?: string }) => Promise<unknown>;
  buildCpaPackage?: (rt: unknown, from: string, to: string) => Promise<unknown>;
};
export type MonitorsModule = { buildAttentionQueue?: (rt: unknown, asOf?: string) => Promise<unknown> };

export async function loadWorkflows(): Promise<WorkflowsModule | null> {
  try {
    return (await import("@/lib/workflows")) as unknown as WorkflowsModule;
  } catch {
    return null;
  }
}

export async function loadMonitors(): Promise<MonitorsModule | null> {
  try {
    return (await import("@/lib/monitors")) as unknown as MonitorsModule;
  } catch {
    return null;
  }
}

/** Summarize an unknown object's top-level fields for a presentation (never invents values). */
export function summarizeUnknown(value: unknown, maxKeys = 12): { fields: { key: string; summary: string }[]; count: number } {
  if (!value || typeof value !== "object") return { fields: [{ key: "value", summary: String(value) }], count: 1 };
  const entries = Object.entries(value as Record<string, unknown>);
  const fields = entries.slice(0, maxKeys).map(([key, v]) => ({ key, summary: Array.isArray(v) ? `${v.length} item(s)` : v && typeof v === "object" ? `${Object.keys(v as object).length} field(s)` : String(v) }));
  return { fields, count: entries.length };
}

export function numbersIn(value: unknown, depth = 0, acc: { key: string; value: string }[] = [], prefix = ""): { key: string; value: string }[] {
  if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) return acc;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) acc.push({ key: `${prefix}${k}`, value: String(v) });
    else if (v && typeof v === "object" && !Array.isArray(v) && acc.length < 30) numbersIn(v, depth + 1, acc, `${prefix}${k}.`);
  }
  return acc;
}
