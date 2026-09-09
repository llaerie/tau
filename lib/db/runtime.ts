/**
 * Lab runtime — wires every subsystem together around one dataset.
 *
 * `createLabRuntime()` builds the full stack (store, ledger, governance, models,
 * knowledge, retrieval). `toolContextFor()` derives the per-request `ToolContext`
 * that agents and tools receive. In Phase One `simulationOnly` is always true.
 */
import type {
  ApprovalEngine,
  AuditLog,
  CapabilityMatrix,
  DataStore,
  LedgerEngine,
  MaterialityThresholds,
  ModelRegistry,
  Retriever,
  ToolContext,
} from "@/lib/core/contracts";
import type { Actor, AgentName, CompanyDataset, ConfigField, ISODate, Policy } from "@/lib/core/types";
import { Ledger } from "@/lib/accounting/ledger";
import { HashChainedAuditLog } from "@/lib/audit/audit-log";
import { ApprovalEngineImpl } from "@/lib/approvals/approval-engine";
import { ActionExecutor } from "@/lib/approvals/action-executor";
import { RuleBasedRiskEngine } from "@/lib/risk/risk-engine";
import { thresholdsFromConfig } from "@/lib/risk/materiality";
import { CapabilityMatrixImpl } from "@/lib/academy/capabilities";
import { createModelRegistry } from "@/lib/models/registry";
import { HybridRetriever } from "@/lib/retrieval/hybrid-retriever";
import { buildRetrievalDocs } from "@/lib/retrieval/build-docs";
import { buildFinanceBible } from "@/lib/knowledge/finance-bible";
import { buildSyntheticProfile } from "@/lib/knowledge/synthetic-profile";
import { defaultPolicies } from "@/lib/knowledge/policies";
import { EDUCATION_SNIPPETS } from "@/lib/knowledge/education";
import { seedKnowledgeSources } from "@/lib/knowledge/sources";
import { seedTaxRules, TaxRuleStore } from "@/lib/tax/rule-store";
import { CpaReviewQueue } from "@/lib/tax/cpa-queue";
import { GuidanceStore, syntheticExampleGuidance } from "@/lib/knowledge/guidance";
import { LAB_DEFAULT_ACTOR } from "@/lib/security/session";
import { createStore, type CreateStoreOptions } from "@/lib/db/index";
import { MemoryStore } from "@/lib/db/memory-store";

export interface LabRuntime {
  store: DataStore;
  dataset: CompanyDataset;
  ledger: LedgerEngine;
  audit: AuditLog;
  risk: RuleBasedRiskEngine;
  approvals: ApprovalEngine;
  executor: ActionExecutor;
  capabilities: CapabilityMatrix;
  models: ModelRegistry;
  retriever: Retriever;
  thresholds: MaterialityThresholds;
  taxRules: TaxRuleStore;
  cpaQueue: CpaReviewQueue;
  guidance: GuidanceStore;
  /** The REAL company's finance bible (unknowns explicit). Separate from the synthetic lab profile. */
  bible: ConfigField[];
  policies: Policy[];
  asOfDate: ISODate;
  simulationOnly: true;
  /** Re-index retrieval after knowledge changes */
  reindex(): Promise<void>;
  /** Persist any dirty state */
  flush(): Promise<void>;
}

export interface LabRuntimeOptions {
  dataset?: CompanyDataset;
  store?: DataStore;
  storeOptions?: CreateStoreOptions;
  asOfDate?: ISODate;
  /** Skip retrieval indexing (fast tests) */
  skipRetrieval?: boolean;
}

/**
 * Populate knowledge collections on a dataset that lacks them (synthetic generator
 * leaves them empty on purpose). Idempotent.
 */
export function seedKnowledgeInto(dataset: CompanyDataset): CompanyDataset {
  if (dataset.knowledgeSources.length === 0) dataset.knowledgeSources = seedKnowledgeSources();
  if (dataset.taxRules.length === 0) dataset.taxRules = seedTaxRules(null);
  if (dataset.policies.length === 0) dataset.policies = defaultPolicies();
  if (dataset.professionalGuidance.length === 0) dataset.professionalGuidance = [syntheticExampleGuidance()];
  if (dataset.configFields.length === 0) {
    // The lab company's own (synthetic, confirmed) profile fields
    dataset.configFields = buildSyntheticProfile();
  }
  return dataset;
}

export async function createLabRuntime(opts: LabRuntimeOptions = {}): Promise<LabRuntime> {
  let store: DataStore;
  if (opts.store) store = opts.store;
  else if (opts.dataset) store = new MemoryStore(opts.dataset, opts.storeOptions?.snapshotPath);
  else {
    const fallback = opts.storeOptions?.fallbackDataset ?? (await defaultSyntheticDataset(opts.asOfDate));
    store = await createStore({ ...opts.storeOptions, fallbackDataset: fallback });
  }
  const dataset = seedKnowledgeInto(await store.load());
  const asOfDate = opts.asOfDate ?? process.env.TAU_AS_OF_DATE ?? dataset.profile.asOfDate;

  const ledger = new Ledger(dataset, (collection, entity) => {
    void store.upsert(collection, entity);
  });
  const audit = new HashChainedAuditLog(store, dataset);
  const risk = new RuleBasedRiskEngine({ restrictedAccountIds: dataset.accounts.filter((a) => a.restricted).map((a) => a.id) });
  const approvals = new ApprovalEngineImpl(store, dataset, audit);
  const capabilities = new CapabilityMatrixImpl(store, dataset);
  const thresholds = thresholdsFromConfig(dataset.configFields);
  const executor = new ActionExecutor({ store, dataset, audit, risk, approvals, capabilities, thresholds });
  const models = createModelRegistry();
  const taxRules = new TaxRuleStore(dataset.knowledgeSources, dataset.taxRules);
  const cpaQueue = new CpaReviewQueue();
  const guidance = new GuidanceStore(dataset.professionalGuidance);
  const bible = buildFinanceBible();
  const policies = dataset.policies;
  const retriever = new HybridRetriever(null);

  const runtime: LabRuntime = {
    store,
    dataset,
    ledger,
    audit,
    risk,
    approvals,
    executor,
    capabilities,
    models,
    retriever,
    thresholds,
    taxRules,
    cpaQueue,
    guidance,
    bible,
    policies,
    asOfDate,
    simulationOnly: true,
    async reindex() {
      await retriever.index(buildRetrievalDocs(dataset, [...bible, ...dataset.configFields], dataset.policies, EDUCATION_SNIPPETS));
    },
    async flush() {
      await store.flush();
    },
  };
  if (!opts.skipRetrieval) await runtime.reindex();
  return runtime;
}

export function toolContextFor(rt: LabRuntime, agent: AgentName, actor: Actor = LAB_DEFAULT_ACTOR, asOfDate?: ISODate): ToolContext {
  return {
    dataset: rt.dataset,
    store: rt.store,
    ledger: rt.ledger,
    audit: rt.audit,
    risk: rt.risk,
    approvals: rt.approvals,
    capabilities: rt.capabilities,
    models: rt.models,
    retriever: rt.retriever,
    thresholds: rt.thresholds,
    actor,
    asOfDate: asOfDate ?? rt.asOfDate,
    agent,
    simulationOnly: true,
  };
}

async function defaultSyntheticDataset(asOfDate?: ISODate): Promise<CompanyDataset> {
  const mod = await import("@/lib/synthetic");
  return mod.generateSyntheticCompany({ asOfDate });
}

// ---------------------------------------------------------------------------
// Process-wide singleton for the Next.js server (lab mode)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __tauRuntime?: Promise<LabRuntime> };

export function getRuntime(): Promise<LabRuntime> {
  if (!g.__tauRuntime) g.__tauRuntime = createLabRuntime();
  return g.__tauRuntime;
}

export async function resetRuntime(opts: LabRuntimeOptions = {}): Promise<LabRuntime> {
  g.__tauRuntime = createLabRuntime({ ...opts, storeOptions: { fresh: true, ...opts.storeOptions } });
  return g.__tauRuntime;
}
