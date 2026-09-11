"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EvalJob } from "@/lib/ui/evals";
import { Notice } from "@/components/ui/Notice";

const DIRS = ["accounting", "fpa", "cash", "tax", "payroll", "ap_ar", "strategy", "compliance", "adversarial"];

export function RunEvals({ initialJob, canRun }: { initialJob: EvalJob | null; canRun: boolean }) {
  const router = useRouter();
  const [dir, setDir] = useState("");
  const [limit, setLimit] = useState("");
  const [job, setJob] = useState<EvalJob | null>(initialJob);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/academy/status", { cache: "no-store" });
        const body = (await res.json()) as { job: EvalJob | null };
        setJob(body.job);
        if (body.job && body.job.status !== "running") router.refresh();
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [job?.status, router]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/academy/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directory: dir || undefined, limit: limit ? Number(limit) : undefined }) });
      const body = (await res.json()) as { job?: EvalJob; error?: { message: string } };
      if (!res.ok || !body.job) throw new Error(body.error?.message ?? `Failed (${res.status})`);
      setJob({ ...body.job, progress: { done: 0, total: 0 }, startedBy: "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-muted">
          Directory filter
          <select value={dir} onChange={(e) => setDir(e.target.value)} className="select mt-1 w-44">
            <option value="">All directories</option>
            {DIRS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-muted">
          Limit (optional)
          <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="all" className="input mt-1 w-28" inputMode="numeric" />
        </label>
        <button onClick={() => void start()} disabled={busy || !canRun || job?.status === "running"} className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-50">
          {job?.status === "running" ? "Running…" : "Run evals"}
        </button>
        {!canRun ? <span className="text-[11px] text-bad">Your role lacks RUN_EVALS.</span> : null}
      </div>
      {err ? (
        <Notice tone={/not yet available/i.test(err) ? "warn" : "bad"} title={/not yet available/i.test(err) ? "Subsystem not available yet" : "Could not start"}>
          {err}
        </Notice>
      ) : null}
      {job ? (
        <div className="rounded-md border border-line bg-surface p-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-[11px] text-muted">{job.id}</span>
            <span className={`rounded px-1.5 text-[11px] font-semibold uppercase ${job.status === "running" ? "bg-warn-soft text-warn" : job.status === "done" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{job.status}</span>
            {job.directory ? <span className="text-muted">[{job.directory}]</span> : null}
            <span className="text-muted">started {job.startedAt.slice(0, 19).replace("T", " ")} UTC</span>
          </div>
          {job.status === "running" ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
                <div className="h-full bg-accent transition-all" style={{ width: job.progress.total ? `${(job.progress.done / job.progress.total) * 100}%` : "5%" }} />
              </div>
              <div className="num mt-1 text-[11px] text-muted">
                {job.progress.done} / {job.progress.total || "?"} cases
              </div>
            </div>
          ) : null}
          {job.status === "done" && job.summary ? (
            <div className="num mt-1">
              {job.summary.passed}/{job.summary.total} passed · {(job.summary.passRate * 100).toFixed(1)}% · {job.failed?.length ?? 0} failed · {Math.round(job.summary.durationMs / 1000)}s
            </div>
          ) : null}
          {job.status === "failed" ? <div className="mt-1 text-bad">{job.error}</div> : null}
          {job.failed?.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-muted">Failed cases from this run ({job.failed.length})</summary>
              <ul className="mt-1 space-y-1 text-[12px]">
                {job.failed.map((f) => (
                  <li key={f.caseId}>
                    <span className="mono">{f.caseId}</span> <span className="text-muted">({f.agent})</span> — {f.failures.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
