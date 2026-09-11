/**
 * Generate docs/READINESS_REPORT.md and evals/results/readiness.json from the latest eval run,
 * the capability matrix (lab snapshot when present) and the unknowns registry.
 *
 *   npm run evals:report [-- --run <runId>]
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LAB_SNAPSHOT_PATH, MemoryStore } from "@/lib/db";
import type { CompetencyScore } from "@/lib/core/types";
import { buildReadiness, type DiagnosisMap } from "@/evals/harness/readiness";
import { loadAllCases, loadLatestEvalRun, loadRun, primeEvalModules, RESULTS_DIR } from "@/evals/harness";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runIdIdx = argv.indexOf("--run");
  process.env.TAU_EVALS_QUIET = "1";
  await primeEvalModules();
  const run = runIdIdx >= 0 ? loadRun(argv[runIdIdx + 1]) : loadLatestEvalRun();
  let competencyScores: CompetencyScore[] = [];
  const snapshot = MemoryStore.fromSnapshot(LAB_SNAPSHOT_PATH);
  if (snapshot) competencyScores = (await snapshot.load()).competencyScores;
  const diagnosesPath = resolve(RESULTS_DIR, "diagnoses.json");
  const diagnoses = existsSync(diagnosesPath) ? (JSON.parse(readFileSync(diagnosesPath, "utf8")) as DiagnosisMap) : {};
  const { json, markdown } = buildReadiness({ run, competencyScores, cases: loadAllCases(), diagnoses });
  const mdPath = resolve(process.cwd(), "docs", "READINESS_REPORT.md");
  mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = resolve(RESULTS_DIR, "readiness.json");
  writeFileSync(mdPath, markdown);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  console.log(`Wrote ${mdPath}\nWrote ${jsonPath}\nRun: ${run ? run.summary.runId : "none"} — ${json.statement}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
