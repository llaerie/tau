import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { loadAgents, loadEvalHarness, MODULE_NOT_AVAILABLE } from "@/lib/ui/optional";
import { currentJob, setJob, type EvalJob } from "@/lib/ui/evals";
import { newId } from "@/lib/core/ids";
import type { EvalCaseResult, EvalRunSummary } from "@/lib/core/contracts";

type Harness = {
  runEvals?: (opts: Record<string, unknown>) => Promise<{ summary: EvalRunSummary; results: EvalCaseResult[] }>;
  saveRun?: (run: { summary: EvalRunSummary; results: EvalCaseResult[] }) => unknown;
  applyRunToDataset?: (rt: unknown, run: { summary: EvalRunSummary; results: EvalCaseResult[] }, opts?: Record<string, unknown>) => Promise<unknown>;
};

const DIRS = ["accounting", "fpa", "cash", "tax", "payroll", "ap_ar", "strategy", "compliance", "adversarial"];

/** Start an eval run in the background. Poll /api/academy/status. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ directory?: string; limit?: number }>(req);
  const running = currentJob();
  if (running?.status === "running") return apiError(`A run is already in progress (${running.id})`, 409, "ALREADY_RUNNING");
  const directory = typeof body.directory === "string" && body.directory ? body.directory : null;
  if (directory && !DIRS.includes(directory)) return apiError(`Unknown directory ${directory}`);
  const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Number(body.limit) : undefined;
  const { mod, notice } = await loadEvalHarness<Harness>();
  if (!mod?.runEvals) return apiError(notice ?? `runEvals: ${MODULE_NOT_AVAILABLE}`, 503, "MODULE_NOT_AVAILABLE");
  // The harness resolves lib/agents/ask through an expression import the bundler cannot follow; inject the loaded askCfo instead.
  const agents = await loadAgents<{ askCfo?: unknown }>("ask");
  const ask = typeof agents.mod?.askCfo === "function" ? agents.mod.askCfo : undefined;
  if (!ask) return apiError(agents.notice ?? `askCfo: ${MODULE_NOT_AVAILABLE}`, 503, "MODULE_NOT_AVAILABLE");
  const rt = await getRuntime();
  const job: EvalJob = { id: newId("evalrun"), status: "running", directory, startedAt: new Date().toISOString(), progress: { done: 0, total: 0 }, startedBy: `${actor.role}:${actor.id}` };
  setJob(job);
  void (async () => {
    try {
      const run = await mod.runEvals!({
        filter: directory ? { directory } : undefined,
        limit,
        rt,
        ask,
        onProgress: (_r: unknown, index: number, total: number) => {
          job.progress = { done: index + 1, total };
        },
      });
      try {
        mod.saveRun?.(run);
      } catch {
        /* results dir not writable — the run still completes in memory */
      }
      try {
        if (mod.applyRunToDataset) await mod.applyRunToDataset(rt, run);
      } catch {
        /* competency fold-in is best effort */
      }
      await rt.audit.record({ actor, workflowVersion: "console:academy:v1", eventType: "EVAL_RUN_COMPLETED", explanation: `Eval run ${run.summary.runId}: ${run.summary.passed}/${run.summary.total} passed (${(run.summary.passRate * 100).toFixed(1)}%)${directory ? ` [${directory}]` : ""}`, afterState: { runId: run.summary.runId, passRate: run.summary.passRate, total: run.summary.total } });
      await rt.flush();
      job.summary = run.summary;
      job.failed = run.results.filter((r) => !r.passed).map((r) => ({ caseId: r.caseId, failures: r.failures, agent: r.agent }));
      job.status = "done";
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();
  return json({ job: { id: job.id, status: job.status, directory, startedAt: job.startedAt } }, { status: 202 });
}, "RUN_EVALS");
