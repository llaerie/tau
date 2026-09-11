/**
 * Eval runner: loads every case, builds the fixture runtime, calls the CFO entry point,
 * scores the response and aggregates a run summary.
 *
 * The agent is reached through `askCfo(rt, message, { task, actor, asOfDate, targetAgent })`
 * from lib/agents/ask (dynamically imported — see ./synthetic.ts) or an injected `ask` function.
 */
import type { AgentResponse, EvalCaseResult, EvalDirectory, EvalRunSummary, EscalationType } from "@/lib/core/contracts";
import type { Actor, CompanyDataset, ISODate, KnowledgeLayer, ModelInfo, Role } from "@/lib/core/types";
import { createLabRuntime, seedKnowledgeInto, type LabRuntime } from "@/lib/db/runtime";
import { metricsFromResults } from "@/lib/academy/certification";
import { deterministicId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/dates";
import { LAB_DEFAULT_ACTOR } from "@/lib/security/session";
import { LOCAL_MODEL_INFO } from "@/lib/models/local-provider";
import { assertValidCase, type HarnessEvalCase } from "./schema";
import { aggregate, scoreRubric, type RubricScore, type ScoreContext } from "./scorers";
import { buildFixtureDataset, FIXTURE_AS_OF, isFixtureName } from "./fixtures";
import { askFnSync, EVAL_AS_OF_DATE, freshSyntheticDataset, loadAsk, primeEvalModules, warnOnce, type AskFn } from "./synthetic";

import * as accounting from "@/evals/accounting/generators";
import * as fpa from "@/evals/fpa/generators";
import * as cash from "@/evals/cash/generators";
import * as tax from "@/evals/tax/generators";
import * as payroll from "@/evals/payroll/generators";
import * as apAr from "@/evals/ap_ar/generators";
import * as strategy from "@/evals/strategy/generators";
import * as compliance from "@/evals/compliance/generators";
import * as adversarial from "@/evals/adversarial/generators";
import accountingJson from "@/evals/accounting/cases.json";
import fpaJson from "@/evals/fpa/cases.json";
import cashJson from "@/evals/cash/cases.json";
import taxJson from "@/evals/tax/cases.json";
import payrollJson from "@/evals/payroll/cases.json";
import apArJson from "@/evals/ap_ar/cases.json";
import strategyJson from "@/evals/strategy/cases.json";
import complianceJson from "@/evals/compliance/cases.json";
import adversarialJson from "@/evals/adversarial/cases.json";

const GENERATORS: Record<EvalDirectory, { generateCases(): HarnessEvalCase[] }> = { accounting, fpa, cash, tax, payroll, ap_ar: apAr, strategy, compliance, adversarial };
const JSON_CASES: Record<EvalDirectory, unknown[]> = {
  accounting: accountingJson as unknown[],
  fpa: fpaJson as unknown[],
  cash: cashJson as unknown[],
  tax: taxJson as unknown[],
  payroll: payrollJson as unknown[],
  ap_ar: apArJson as unknown[],
  strategy: strategyJson as unknown[],
  compliance: complianceJson as unknown[],
  adversarial: adversarialJson as unknown[],
};

/** Every case: generated (deterministic seed) + hand-written JSON, validated and de-duplicated by id. */
export function loadAllCases(): HarnessEvalCase[] {
  const out: HarnessEvalCase[] = [];
  const seen = new Set<string>();
  for (const dir of Object.keys(GENERATORS) as EvalDirectory[]) {
    const generated = GENERATORS[dir].generateCases();
    const hand = JSON_CASES[dir].map((raw, i) => assertValidCase(raw, `${dir}/cases.json[${i}]`));
    for (const c of [...generated, ...hand]) {
      if (c.directory !== dir) throw new Error(`Case ${c.id} declares directory ${c.directory} but lives under evals/${dir}`);
      if (seen.has(c.id)) throw new Error(`Duplicate eval case id ${c.id} (${dir})`);
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

export interface EvalFilter {
  directory?: EvalDirectory | EvalDirectory[];
  domain?: string;
  capability?: string;
  ids?: string[];
  tags?: string[];
}

export function filterCases(cases: HarnessEvalCase[], filter: EvalFilter = {}): HarnessEvalCase[] {
  const dirs = filter.directory ? (Array.isArray(filter.directory) ? filter.directory : [filter.directory]) : null;
  const ids = filter.ids ? new Set(filter.ids) : null;
  return cases.filter((c) => {
    if (dirs && !dirs.includes(c.directory)) return false;
    if (filter.domain && c.domain !== filter.domain) return false;
    if (filter.capability && c.capabilityKey !== filter.capability) return false;
    if (ids && !ids.has(c.id)) return false;
    if (filter.tags && filter.tags.length && !filter.tags.every((t) => c.tags.includes(t))) return false;
    return true;
  });
}

export interface RunEvalsOptions {
  filter?: EvalFilter;
  limit?: number;
  concurrency?: number;
  /** Shared runtime for "synthetic-default" cases (built from generateSyntheticCompany when omitted). */
  rt?: LabRuntime;
  /** Injected agent entry point (tests). Defaults to lib/agents/ask `askCfo`. */
  ask?: AskFn;
  /** Explicit case list (defaults to loadAllCases()). */
  cases?: HarnessEvalCase[];
  onProgress?: (result: EvalCaseResult, index: number, total: number) => void;
  /** Skip retrieval indexing when building fixture runtimes (faster; agents fall back to no citations). */
  skipRetrieval?: boolean;
}

export interface EvalRun {
  summary: EvalRunSummary;
  results: EvalCaseResult[];
}

const SNAPSHOT_EXCLUDED: (keyof CompanyDataset)[] = ["auditEvents", "agentActions", "approvals", "calculations", "evaluations"];

/** Stable JSON of the dataset minus governance/telemetry collections (those legitimately grow on every request). */
export function datasetSnapshot(ds: CompanyDataset): string {
  const view: Record<string, unknown> = {};
  for (const key of Object.keys(ds) as (keyof CompanyDataset)[]) {
    if (SNAPSHOT_EXCLUDED.includes(key)) continue;
    if (key === "periods") {
      view.periods = ds.periods.map((p) => ({ id: p.id, status: p.status }));
      continue;
    }
    if (key === "competencyScores") continue;
    view[key] = ds[key];
  }
  return JSON.stringify(view);
}

/** Collections that differ between two snapshots (for failure details). */
export function snapshotDiff(before: string, after: string): string[] {
  if (before === after) return [];
  const a = JSON.parse(before) as Record<string, unknown>;
  const b = JSON.parse(after) as Record<string, unknown>;
  return Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function actorForRole(role: Role | undefined): Actor {
  if (!role || role === LAB_DEFAULT_ACTOR.role) return { ...LAB_DEFAULT_ACTOR };
  return { type: role === "AGENT" ? "AGENT" : role === "SYSTEM" ? "SYSTEM" : "USER", id: `eval_${role.toLowerCase()}`, role, displayName: `Eval ${role}` };
}

function expectedSummary(c: HarnessEvalCase): string {
  const parts: string[] = [];
  const e = c.expected;
  if (e.escalation !== undefined) parts.push(`escalation=${e.escalation ?? "none"}`);
  if (e.numbers?.length) parts.push(`numbers: ${e.numbers.map((n) => `${n.path}=${n.value}`).join(", ")}`);
  if (e.journalEntry) parts.push(`journal: ${e.journalEntry.lines.map((l) => `${l.accountCode}${l.debit !== undefined ? ` Dr ${l.debit}` : ""}${l.credit !== undefined ? ` Cr ${l.credit}` : ""}`).join("; ")}`);
  if (e.riskLevel) parts.push(`risk=${e.riskLevel}`);
  if (e.prohibitedActions?.length) parts.push(`prohibited=${e.prohibitedActions.join("/")}`);
  if (e.noActionExecuted) parts.push("no action executed");
  if (e.requiredSourceLayer) parts.push(`source=${e.requiredSourceLayer}`);
  if (e.structured) parts.push(`structured: ${JSON.stringify(e.structured)}`);
  if (!parts.length) parts.push(c.rubric.map((r) => r.description).join("; "));
  return parts.join(" | ").slice(0, 600);
}

function actualSummary(r: AgentResponse): string {
  const esc = r.escalation ? ` [${r.escalation.type}]` : "";
  const acts = r.agentActions?.length ? ` actions=${r.agentActions.map((a) => `${a.action.kind}:${a.status}`).join(",")}` : "";
  const value = r.structured && "value" in r.structured ? ` value=${JSON.stringify(r.structured.value)}` : "";
  return `${(r.response?.answer ?? "").slice(0, 240)}${esc}${value}${acts}`.slice(0, 600);
}

function layerResolver(ds: CompanyDataset): (id: string) => KnowledgeLayer | undefined {
  const map = new Map<string, KnowledgeLayer>();
  for (const s of ds.knowledgeSources) map.set(s.id, s.layer);
  for (const r of ds.taxRules) {
    const src = ds.knowledgeSources.find((s) => s.id === r.sourceId);
    if (src) map.set(r.id, src.layer);
  }
  for (const p of ds.policies) map.set(p.id, "COMPANY");
  for (const g of ds.professionalGuidance) map.set(g.id, "PROFESSIONAL");
  return (id) => map.get(id);
}

interface FixtureSlot {
  rt: LabRuntime;
  snapshot: string;
}

/** Score one response against a case (pure; exported for tests). */
export function scoreCase(c: HarnessEvalCase, response: AgentResponse, extra: { resolveLayer?: (id: string) => KnowledgeLayer | undefined; datasetChanged?: string[] | null; durationMs?: number } = {}): EvalCaseResult {
  const ctx: ScoreContext = { response, expected: c.expected, requestParams: c.request.task?.params, resolveLayer: extra.resolveLayer };
  const rubric: RubricScore[] = scoreRubric(c.rubric, ctx);
  if (c.expected.noActionExecuted && extra.datasetChanged !== undefined && extra.datasetChanged !== null) {
    const changed = extra.datasetChanged;
    rubric.push({ key: "no_action_executed:dataset-unchanged", passed: changed.length === 0, weight: 4, detail: changed.length ? `dataset changed: ${changed.join(", ")}` : "dataset unchanged (audit/agentActions/approvals/calculations/evaluations excluded)" });
  }
  const agg = aggregate(rubric);
  const escalation = (response.escalation?.type ?? (typeof response.structured?.escalation === "string" ? (response.structured.escalation as EscalationType) : undefined)) as EscalationType | undefined;
  return {
    caseId: c.id,
    passed: agg.passed,
    score: agg.score,
    rubricResults: rubric,
    failures: rubric.filter((r) => !r.passed).map((r) => `${r.key}: ${r.detail}`),
    agent: response.agent ?? c.request.targetAgent ?? "cfo_orchestrator",
    durationMs: extra.durationMs ?? response.durationMs ?? 0,
    actualSummary: actualSummary(response),
    expectedSummary: expectedSummary(c),
    escalation,
    executedActions: (response.agentActions ?? []).filter((a) => a.status === "EXECUTED").length,
  };
}

export function failedCaseResult(c: HarnessEvalCase, err: unknown, durationMs: number): EvalCaseResult {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    caseId: c.id,
    passed: false,
    score: 0,
    rubricResults: c.rubric.map((r) => ({ key: r.key, passed: false, weight: r.scorer === "manual" ? 0 : r.weight, detail: `not scored: ${message}` })),
    failures: [`exception: ${message}`],
    agent: c.request.targetAgent ?? "cfo_orchestrator",
    durationMs,
    actualSummary: `EXCEPTION ${message.slice(0, 400)}`,
    expectedSummary: expectedSummary(c),
    executedActions: 0,
  };
}

function bucket() {
  return { total: 0, passed: 0, passRate: 0 };
}

export function summarize(results: EvalCaseResult[], cases: HarnessEvalCase[], meta: { model: ModelInfo; ranAt: string; durationMs: number; runId?: string }): EvalRunSummary {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const byDirectory: EvalRunSummary["byDirectory"] = {};
  const byDomain: EvalRunSummary["byDomain"] = {};
  const byCapability: EvalRunSummary["byCapability"] = {};
  for (const r of results) {
    const c = byId.get(r.caseId);
    const dir = c?.directory ?? "unknown";
    const dom = c?.domain ?? "unknown";
    const cap = c?.capabilityKey ?? "unknown";
    byDirectory[dir] ??= bucket();
    byDomain[dom] ??= bucket();
    byCapability[cap] ??= { ...bucket(), failureCaseIds: [] };
    for (const b of [byDirectory[dir], byDomain[dom], byCapability[cap]]) {
      b.total += 1;
      if (r.passed) b.passed += 1;
    }
    if (!r.passed) byCapability[cap].failureCaseIds.push(r.caseId);
  }
  const finalize = (b: { total: number; passed: number; passRate: number }) => {
    b.passRate = b.total ? Math.round((b.passed / b.total) * 10_000) / 10_000 : 0;
  };
  Object.values(byDirectory).forEach(finalize);
  Object.values(byDomain).forEach(finalize);
  Object.values(byCapability).forEach(finalize);
  const passed = results.filter((r) => r.passed).length;
  const m = metricsFromResults(results);
  const metrics: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === "number") metrics[k] = Math.round(v * 10_000) / 10_000;
  const runId = meta.runId ?? `run_${meta.ranAt.replace(/[-:.TZ]/g, "").slice(0, 14)}_${deterministicId("x", meta.ranAt, results.length, passed).slice(2, 10)}`;
  return {
    runId,
    ranAt: meta.ranAt,
    model: meta.model,
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? Math.round((passed / results.length) * 10_000) / 10_000 : 0,
    byDirectory,
    byDomain,
    byCapability,
    metrics,
    failedCaseIds: results.filter((r) => !r.passed).map((r) => r.caseId),
    durationMs: meta.durationMs,
  };
}

async function buildRuntime(dataset: CompanyDataset, asOfDate: ISODate, skipRetrieval: boolean): Promise<LabRuntime> {
  return createLabRuntime({ dataset: seedKnowledgeInto(dataset), asOfDate, skipRetrieval });
}

/** Run the suite (or a filtered subset). Never throws for a failing case: exceptions become failed results. */
export async function runEvals(opts: RunEvalsOptions = {}): Promise<EvalRun> {
  const started = Date.now();
  const ranAt = nowISO();
  let ask = opts.ask;
  if (!ask) {
    await primeEvalModules();
    ask = askFnSync() ?? (await loadAsk()) ?? undefined;
  } else if (!opts.cases) {
    await primeEvalModules();
  }
  if (!ask) throw new Error("lib/agents/ask (askCfo) is not available and no `ask` function was injected");
  const askFn = ask;

  let cases = opts.cases ?? loadAllCases();
  cases = filterCases(cases, opts.filter);
  if (opts.limit !== undefined) cases = cases.slice(0, Math.max(0, opts.limit));

  const fixtures = new Map<string, FixtureSlot>();
  const skipRetrieval = opts.skipRetrieval ?? false;
  let sharedRt: LabRuntime | undefined = opts.rt;
  const sharedRuntime = async (): Promise<LabRuntime> => {
    if (sharedRt) return sharedRt;
    const ds = await freshSyntheticDataset();
    if (!ds) throw new Error("synthetic-default fixture requires lib/synthetic (generateSyntheticCompany) or an injected `rt`");
    sharedRt = await buildRuntime(ds, EVAL_AS_OF_DATE, skipRetrieval);
    return sharedRt;
  };
  const runtimeFor = async (c: HarnessEvalCase): Promise<{ rt: LabRuntime; asOfDate: ISODate; shared: boolean }> => {
    if (c.fixture === "synthetic-default") return { rt: await sharedRuntime(), asOfDate: EVAL_AS_OF_DATE, shared: true };
    if (!isFixtureName(c.fixture)) throw new Error(`Unknown fixture "${c.fixture}" for case ${c.id}`);
    const cached = fixtures.get(c.fixture);
    if (cached) return { rt: cached.rt, asOfDate: FIXTURE_AS_OF, shared: false };
    const rt = await buildRuntime(buildFixtureDataset(c.fixture), FIXTURE_AS_OF, skipRetrieval);
    fixtures.set(c.fixture, { rt, snapshot: datasetSnapshot(rt.dataset) });
    return { rt, asOfDate: FIXTURE_AS_OF, shared: false };
  };

  const results: EvalCaseResult[] = new Array(cases.length);
  let model: ModelInfo | undefined;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 1, 8));

  const runOne = async (c: HarnessEvalCase, index: number): Promise<void> => {
    const t0 = Date.now();
    let rtInfo: { rt: LabRuntime; asOfDate: ISODate; shared: boolean } | undefined;
    try {
      rtInfo = await runtimeFor(c);
      const { rt, asOfDate, shared } = rtInfo;
      const before = datasetSnapshot(rt.dataset);
      const actor = actorForRole(c.request.actorRole);
      const response = await askFn(rt, c.request.message, { task: c.request.task, actor, asOfDate, targetAgent: c.request.targetAgent });
      const after = datasetSnapshot(rt.dataset);
      const changed = snapshotDiff(before, after);
      if (!shared && changed.length) fixtures.delete(c.fixture); // rebuild a mutated fixture for the next case
      model ??= response.model;
      results[index] = scoreCase(c, response, { resolveLayer: layerResolver(rt.dataset), datasetChanged: changed, durationMs: Date.now() - t0 });
    } catch (err) {
      if (rtInfo && !rtInfo.shared) fixtures.delete(c.fixture);
      results[index] = failedCaseResult(c, err, Date.now() - t0);
    }
    opts.onProgress?.(results[index], index, cases.length);
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < cases.length) {
      const i = cursor++;
      await runOne(cases[i], i);
    }
  });
  await Promise.all(workers);

  if (!model) {
    model = LOCAL_MODEL_INFO;
    if (cases.length) warnOnce("no-model", "no response carried model info; recording the local deterministic model");
  }
  const summary = summarize(results, cases, { model, ranAt, durationMs: Date.now() - started });
  return { summary, results };
}
