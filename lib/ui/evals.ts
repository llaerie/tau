/**
 * In-process eval job registry (long-running runs execute in the background and are polled).
 * Falls back to reading evals/results/*.json when the harness module is not importable.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EvalRunSummary, EvalCaseResult } from "@/lib/core/contracts";

export interface EvalJob {
  id: string;
  status: "running" | "done" | "failed";
  directory: string | null;
  startedAt: string;
  finishedAt?: string;
  progress: { done: number; total: number };
  summary?: EvalRunSummary;
  failed?: { caseId: string; failures: string[]; agent?: string }[];
  error?: string;
  startedBy: string;
}

const g = globalThis as unknown as { __tauEvalJob?: EvalJob };

export function currentJob(): EvalJob | null {
  return g.__tauEvalJob ?? null;
}

export function setJob(job: EvalJob): void {
  g.__tauEvalJob = job;
}

export const RESULTS_DIR = resolve(process.cwd(), "evals", "results");

export interface RunListItem {
  runId: string;
  ranAt: string;
  total: number;
  passed: number;
  passRate: number;
  file?: string;
}

interface RunFile {
  summary?: EvalRunSummary;
  results?: EvalCaseResult[];
}

export function listRunsFromDisk(): RunListItem[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const out: RunListItem[] = [];
  for (const f of readdirSync(RESULTS_DIR)) {
    if (!f.endsWith(".json") || f === "latest-summary.json") continue;
    try {
      const raw = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")) as RunFile & Partial<EvalRunSummary>;
      const s = raw.summary ?? (typeof raw.passRate === "number" ? (raw as EvalRunSummary) : undefined);
      if (!s?.runId) continue;
      out.push({ runId: s.runId, ranAt: s.ranAt, total: s.total, passed: s.passed, passRate: s.passRate, file: f });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
}

export function latestRunFromDisk(): { summary: EvalRunSummary; results: EvalCaseResult[] } | null {
  const runs = listRunsFromDisk();
  const first = runs[0];
  if (!first?.file) return null;
  try {
    const raw = JSON.parse(readFileSync(join(RESULTS_DIR, first.file), "utf8")) as RunFile & Partial<EvalRunSummary>;
    const summary = raw.summary ?? (raw as EvalRunSummary);
    return { summary, results: raw.results ?? [] };
  } catch {
    return null;
  }
}
