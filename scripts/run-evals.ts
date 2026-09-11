/**
 * CFO Academy evaluation CLI.
 *
 *   npm run evals -- [--dir accounting] [--domain FPA] [--capability tax_workpapers] [--id case_id ...]
 *                    [--tag adversarial] [--limit N] [--concurrency N] [--apply] [--skip-retrieval] [--quiet]
 *
 * Prints pass/fail tables by directory, domain and capability, lists EVERY failed case id with its
 * rubric failures (never hidden), saves the run to evals/results/<runId>.json and
 * evals/results/latest-summary.json. With --apply the run is folded into the lab snapshot
 * (EvaluationRecords + competencyScores via updateCompetencyScores).
 *
 * Exit code: 0 when every case passed, 1 when any case failed (or the agent entry point is missing).
 */
import type { EvalDirectory } from "@/lib/core/contracts";
import { createLabRuntime } from "@/lib/db/runtime";
import { applyRunToDataset, primeEvalModules, runEvals, saveRun, type EvalFilter } from "@/evals/harness";

interface Args {
  filter: EvalFilter;
  limit?: number;
  concurrency?: number;
  apply: boolean;
  skipRetrieval: boolean;
  quiet: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { filter: {}, apply: false, skipRetrieval: false, quiet: false, help: false };
  const ids: string[] = [];
  const dirs: EvalDirectory[] = [];
  const tags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    switch (k) {
      case "--dir":
      case "--directory":
        dirs.push(v() as EvalDirectory);
        break;
      case "--domain":
        a.filter.domain = v();
        break;
      case "--capability":
        a.filter.capability = v();
        break;
      case "--id":
        ids.push(v());
        break;
      case "--tag":
        tags.push(v());
        break;
      case "--limit":
        a.limit = Number(v());
        break;
      case "--concurrency":
        a.concurrency = Number(v());
        break;
      case "--apply":
        a.apply = true;
        break;
      case "--skip-retrieval":
        a.skipRetrieval = true;
        break;
      case "--quiet":
        a.quiet = true;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      default:
        if (k.startsWith("--")) throw new Error(`Unknown option ${k}`);
    }
  }
  if (dirs.length) a.filter.directory = dirs;
  if (ids.length) a.filter.ids = ids;
  if (tags.length) a.filter.tags = tags;
  return a;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function table(title: string, rows: Record<string, { total: number; passed: number; passRate: number }>): string {
  const keys = Object.keys(rows).sort();
  const w = Math.max(10, ...keys.map((k) => k.length));
  const lines = [`${title}`, `${"key".padEnd(w)}  total  passed  failed   rate`];
  for (const k of keys) {
    const r = rows[k];
    lines.push(`${k.padEnd(w)}  ${String(r.total).padStart(5)}  ${String(r.passed).padStart(6)}  ${String(r.total - r.passed).padStart(6)}  ${pct(r.passRate).padStart(6)}`);
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run evals -- [--dir <directory>]... [--domain <domain>] [--capability <key>] [--id <caseId>]... [--tag <tag>]... [--limit N] [--concurrency N] [--apply] [--skip-retrieval] [--quiet]\nExit code 1 when any case fails.");
    return 0;
  }
  if (args.quiet) process.env.TAU_EVALS_QUIET = "1";
  const primed = await primeEvalModules();
  if (!primed.ask) {
    console.error("lib/agents/ask.ts (askCfo) is not available; cannot run the suite against the agent.");
    return 1;
  }
  let done = 0;
  const run = await runEvals({
    filter: args.filter,
    limit: args.limit,
    concurrency: args.concurrency,
    skipRetrieval: args.skipRetrieval,
    onProgress: (r, _i, total) => {
      done += 1;
      if (!args.quiet && (done % 25 === 0 || done === total || !r.passed)) process.stdout.write(`[${done}/${total}] ${r.passed ? "PASS" : "FAIL"} ${r.caseId}\n`);
    },
  });
  const { summary, results } = run;
  console.log("");
  console.log(table("By directory", summary.byDirectory));
  console.log("");
  console.log(table("By domain", summary.byDomain));
  console.log("");
  console.log(table("By capability", summary.byCapability));
  console.log("");
  console.log(`Metrics: ${Object.entries(summary.metrics).map(([k, v]) => `${k}=${k === "count" ? v : pct(v)}`).join("  ")}`);
  console.log(`Total ${summary.total}  passed ${summary.passed}  failed ${summary.failed}  pass rate ${pct(summary.passRate)}  (${(summary.durationMs / 1000).toFixed(1)}s, model ${summary.model.provider}/${summary.model.model})`);
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log(`\nFAILED CASES (${failed.length}):`);
    for (const r of failed) {
      console.log(`- ${r.caseId}`);
      for (const f of r.failures) console.log(`    ${f}`);
    }
  }
  const saved = saveRun(run);
  console.log(`\nSaved ${saved.runFile}\nLatest summary ${saved.latestFile}`);
  if (args.apply) {
    const rt = await createLabRuntime({ skipRetrieval: true });
    const applied = await applyRunToDataset(rt, run);
    console.log(`Applied run ${summary.runId} to the lab snapshot: ${applied.evaluations.length} evaluation record(s), ${applied.competencyScores.length} competency score(s) updated.`);
  }
  return failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
