/**
 * Lazy access to the synthetic company generator (lib/synthetic) and the agent entry point
 * (lib/agents/ask). Both are built concurrently with this harness, so they are imported
 * through a runtime specifier: the harness compiles and the generators degrade gracefully
 * (skipping synthetic-dependent cases with a warning) when a module is absent.
 */
import type { AgentName, Actor, CompanyDataset, ISODate } from "@/lib/core/types";
import type { AgentRequest, AgentResponse } from "@/lib/core/contracts";
import type { LabRuntime } from "@/lib/db/runtime";

/** The as-of date every eval fixture and the shared synthetic runtime use. */
export const EVAL_AS_OF_DATE: ISODate = "2026-09-09";
/** Seed passed to generateSyntheticCompany so answer keys and the runtime agree. */
export const EVAL_SYNTHETIC_SEED = 20260101; // == lib/synthetic DEFAULT_SYNTHETIC_SEED so dataset.groundTruth matches SYNTHETIC_GROUND_TRUTH

export interface GroundTruthCaseLike {
  key: string;
  title: string;
  transactionIds: string[];
  entityIds: string[];
  expectedCategoryCode?: string;
  expectedFlags: string[];
  correctTreatment: string;
  explanation: string;
}

export type SyntheticDataset = CompanyDataset & { groundTruth?: GroundTruthCaseLike[] };

export interface SyntheticModule {
  generateSyntheticCompany(opts?: { seed?: number; asOfDate?: ISODate }): SyntheticDataset;
  SYNTHETIC_GROUND_TRUTH?: unknown;
}

export type AskFn = (rt: LabRuntime, message: string, opts: { task?: AgentRequest["task"]; actor: Actor; asOfDate?: ISODate; targetAgent?: AgentName }) => Promise<AgentResponse>;

async function importOptional<T>(specifiers: string[]): Promise<T | null> {
  for (const spec of specifiers) {
    try {
      // Variable specifier on purpose: keeps type-checking independent of the module's existence.
      const mod = (await import(/* @vite-ignore */ spec)) as T;
      if (mod) return mod;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      const code = String((err as { code?: string })?.code ?? "");
      if (!/Cannot find (module|package)|Failed to (load|resolve)|ERR_MODULE_NOT_FOUND|Failed to fetch|does not provide|not found|Unknown file extension|ENOENT/i.test(msg) && !/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(code)) throw err;
    }
  }
  return null;
}

let syntheticPromise: Promise<SyntheticModule | null> | undefined;
export function loadSynthetic(): Promise<SyntheticModule | null> {
  if (!syntheticPromise) {
    syntheticPromise = importOptional<SyntheticModule>(["@/lib/synthetic", "../../lib/synthetic/index.ts"]).then((m) => (m && typeof m.generateSyntheticCompany === "function" ? m : null));
  }
  return syntheticPromise;
}

let askPromise: Promise<AskFn | null> | undefined;
export function loadAsk(): Promise<AskFn | null> {
  if (!askPromise) {
    askPromise = importOptional<{ askCfo?: AskFn }>(["@/lib/agents/ask", "../../lib/agents/ask.ts"]).then((m) => (m && typeof m.askCfo === "function" ? m.askCfo : null));
  }
  return askPromise;
}

// ---------------------------------------------------------------------------
// Priming: generators are synchronous (`generateCases(): EvalCase[]`), so the optional modules are
// loaded once up-front by `primeEvalModules()` (the runner, CLI and tests await it) and then read
// synchronously. Before priming — or when a module is absent — synthetic-dependent cases are skipped.
// ---------------------------------------------------------------------------

let primed = false;
let syntheticModule: SyntheticModule | null = null;
let askFn: AskFn | null = null;
let cachedDataset: SyntheticDataset | null | undefined;

export async function primeEvalModules(): Promise<{ synthetic: boolean; ask: boolean }> {
  const [s, a] = await Promise.all([loadSynthetic(), loadAsk()]);
  syntheticModule = s;
  askFn = a;
  primed = true;
  return { synthetic: !!s, ask: !!a };
}

export function isPrimed(): boolean {
  return primed;
}

export function syntheticModuleSync(): SyntheticModule | null {
  if (!primed) warnOnce("not-primed", "primeEvalModules() was not awaited; synthetic-dependent cases are skipped");
  else if (!syntheticModule) warnOnce("no-synthetic", "lib/synthetic is absent; synthetic-dependent cases are skipped");
  return syntheticModule;
}

export function askFnSync(): AskFn | null {
  return askFn;
}

/** Memoized synthetic dataset used by generators to compute answer keys. Never mutate it. */
export function syntheticDatasetSync(): SyntheticDataset | null {
  if (cachedDataset !== undefined) return cachedDataset;
  const mod = syntheticModuleSync();
  cachedDataset = mod ? mod.generateSyntheticCompany({ seed: EVAL_SYNTHETIC_SEED, asOfDate: EVAL_AS_OF_DATE }) : null;
  return cachedDataset;
}

/** A fresh synthetic dataset (for runtimes that will be mutated). */
export async function freshSyntheticDataset(): Promise<SyntheticDataset | null> {
  const mod = await loadSynthetic();
  if (!mod) return null;
  return mod.generateSyntheticCompany({ seed: EVAL_SYNTHETIC_SEED, asOfDate: EVAL_AS_OF_DATE });
}

const warned = new Set<string>();
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (process.env.TAU_EVALS_QUIET !== "1") console.warn(`[evals] ${message}`);
}

/** Loose reader for `SYNTHETIC_GROUND_TRUTH` (shape owned by lib/synthetic): find case ids by fuzzy key. */
export interface GroundTruthEntry {
  key: string;
  transactionIds: string[];
  entityIds: string[];
  raw: unknown;
}

export function groundTruthEntries(gt: unknown): GroundTruthEntry[] {
  if (!gt || typeof gt !== "object") return [];
  const entries: GroundTruthEntry[] = [];
  const push = (key: string, v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const ids = (arr: unknown): string[] => (Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    const txIds = [...ids(o.transactionIds), ...ids(o.transactions), ...(typeof o.transactionId === "string" ? [o.transactionId] : [])];
    const entIds = [...ids(o.entityIds), ...ids(o.entities), ...(typeof o.workerId === "string" ? [o.workerId] : []), ...(typeof o.entityId === "string" ? [o.entityId] : [])];
    entries.push({ key: typeof o.key === "string" ? o.key : key, transactionIds: txIds, entityIds: entIds, raw: v });
  };
  if (Array.isArray(gt)) gt.forEach((v, i) => push(String((v as { key?: string })?.key ?? i), v));
  else if (gt instanceof Map) for (const [k, v] of gt) push(String(k), v);
  else for (const [k, v] of Object.entries(gt as Record<string, unknown>)) push(k, v);
  return entries;
}

export function findGroundTruth(entries: GroundTruthEntry[], ...needles: string[]): GroundTruthEntry | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const n of needles) {
    const hit = entries.find((e) => norm(e.key).includes(norm(n)));
    if (hit) return hit;
  }
  return undefined;
}
