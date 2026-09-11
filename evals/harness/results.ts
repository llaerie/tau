/**
 * Run persistence (evals/results/<runId>.json + latest-summary.json) and folding a run into the
 * lab dataset's EvaluationRecords / CompetencyScores.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EvalCaseResult, EvalRunSummary } from "@/lib/core/contracts";
import type { CompetencyDomain, CompetencyScore, EvaluationRecord } from "@/lib/core/types";
import { updateCompetencyScores } from "@/lib/academy/certification";
import { capabilityDefinition, isCapabilityKey } from "@/lib/academy/capabilities";
import { deterministicId } from "@/lib/core/ids";
import type { LabRuntime } from "@/lib/db/runtime";
import type { HarnessEvalCase } from "./schema";
import type { EvalRun } from "./runner";
import { loadAllCases } from "./runner";
import { warnOnce } from "./synthetic";

export const RESULTS_DIR = resolve(process.cwd(), "evals", "results");
export const LATEST_SUMMARY_FILE = "latest-summary.json";

export interface LatestSummaryFile {
  runId: string;
  savedAt: string;
  summary: EvalRunSummary;
  failed: { caseId: string; failures: string[] }[];
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Persist a run. Returns the file paths written. */
export function saveRun(run: EvalRun, dir = RESULTS_DIR): { runFile: string; latestFile: string } {
  ensureDir(dir);
  const runFile = join(dir, `${run.summary.runId}.json`);
  writeFileSync(runFile, JSON.stringify({ summary: run.summary, results: run.results }, null, 2));
  const latest: LatestSummaryFile = {
    runId: run.summary.runId,
    savedAt: new Date().toISOString(),
    summary: run.summary,
    failed: run.results.filter((r) => !r.passed).map((r) => ({ caseId: r.caseId, failures: r.failures })),
  };
  const latestFile = join(dir, LATEST_SUMMARY_FILE);
  writeFileSync(latestFile, JSON.stringify(latest, null, 2));
  return { runFile, latestFile };
}

export function loadRun(runId: string, dir = RESULTS_DIR): EvalRun | null {
  const file = join(dir, `${runId.endsWith(".json") ? runId : `${runId}.json`}`);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as EvalRun;
  if (!raw || !raw.summary || !Array.isArray(raw.results)) return null;
  return raw;
}

export function listEvalRuns(dir = RESULTS_DIR): { runId: string; ranAt: string; total: number; passed: number; passRate: number; file: string }[] {
  if (!existsSync(dir)) return [];
  const out: { runId: string; ranAt: string; total: number; passed: number; passRate: number; file: string }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("run_") || !f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalRun;
      if (!raw?.summary?.runId) continue;
      out.push({ runId: raw.summary.runId, ranAt: raw.summary.ranAt, total: raw.summary.total, passed: raw.summary.passed, passRate: raw.summary.passRate, file: join(dir, f) });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => (a.ranAt < b.ranAt ? 1 : a.ranAt > b.ranAt ? -1 : 0));
}

export function loadLatestEvalRun(dir = RESULTS_DIR): EvalRun | null {
  const latestFile = join(dir, LATEST_SUMMARY_FILE);
  if (existsSync(latestFile)) {
    try {
      const latest = JSON.parse(readFileSync(latestFile, "utf8")) as LatestSummaryFile;
      const run = latest.runId ? loadRun(latest.runId, dir) : null;
      if (run) return run;
    } catch {
      /* fall through to directory scan */
    }
  }
  const runs = listEvalRuns(dir);
  return runs.length ? loadRun(runs[0].runId, dir) : null;
}

/** Case metadata lookup used when folding results into the dataset. */
export function caseIndex(cases?: HarnessEvalCase[]): Map<string, HarnessEvalCase> {
  return new Map((cases ?? loadAllCases()).map((c) => [c.id, c]));
}

export interface ApplyOptions {
  cases?: HarnessEvalCase[];
  ranAt?: string;
}

/**
 * Append EvaluationRecords for the run and update competency scores (never promotes — only
 * updates pass rates, metrics, consecutive passing runs and promotion eligibility).
 */
export async function applyRunToDataset(rt: LabRuntime, run: EvalRun, opts: ApplyOptions = {}): Promise<{ evaluations: EvaluationRecord[]; competencyScores: CompetencyScore[] }> {
  const index = caseIndex(opts.cases);
  const ranAt = opts.ranAt ?? run.summary.ranAt;
  const known: EvalCaseResult[] = [];
  const evaluations: EvaluationRecord[] = [];
  for (const r of run.results) {
    const c = index.get(r.caseId);
    if (!c) {
      warnOnce(`unknown-case:${r.caseId}`, `result for unknown case ${r.caseId} skipped when applying run ${run.summary.runId}`);
      continue;
    }
    known.push(r);
    evaluations.push({
      id: deterministicId("evr", run.summary.runId, r.caseId),
      runId: run.summary.runId,
      caseId: r.caseId,
      domain: c.domain,
      competency: c.competency,
      capabilityKey: c.capabilityKey,
      agent: r.agent,
      passed: r.passed,
      score: r.score,
      failures: r.failures,
      expectedSummary: r.expectedSummary,
      actualSummary: r.actualSummary,
      model: run.summary.model,
      durationMs: r.durationMs,
      ranAt,
    });
  }
  const caseCapability = (caseId: string) => {
    const c = index.get(caseId)!;
    return { capabilityKey: c.capabilityKey, domain: c.domain, label: c.competency };
  };
  const capabilityMeta = (key: string) => {
    if (isCapabilityKey(key)) {
      const d = capabilityDefinition(key);
      return { maxAllowedLevel: d.maxPhaseOneLevel, label: d.label, domain: d.domain, defaultLevel: d.defaultLevel };
    }
    return { maxAllowedLevel: 2 as const, label: key, domain: "FINANCIAL_CONTROLS" as CompetencyDomain, defaultLevel: 0 as const };
  };
  const competencyScores = updateCompetencyScores(rt.dataset.competencyScores, run.summary, known, caseCapability, capabilityMeta, ranAt);
  const existingIds = new Set(rt.dataset.evaluations.map((e) => e.id));
  const fresh = evaluations.filter((e) => !existingIds.has(e.id));
  rt.dataset.evaluations.push(...fresh);
  rt.dataset.competencyScores.splice(0, rt.dataset.competencyScores.length, ...competencyScores);
  await rt.store.upsertMany("evaluations", fresh);
  // CompetencyScore is keyed by capabilityKey (no `id`); the memory store already shares the dataset
  // object, so only non-memory stores need an explicit upsert.
  if (rt.store.kind !== "memory") await rt.store.upsertMany("competencyScores", competencyScores);
  await rt.store.flush();
  return { evaluations: fresh, competencyScores };
}
