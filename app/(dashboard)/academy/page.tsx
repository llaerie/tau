import type { Metadata } from "next";
import Link from "next/link";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { CAPABILITIES, AUTONOMY_LEVELS } from "@/lib/academy/capabilities";
import { DOMAINS } from "@/lib/academy/competency-map";
import { evaluatePromotion, AUTONOMY_LEVEL_DEFINITIONS } from "@/lib/academy/certification";
import { callOptional, loadEvalHarness } from "@/lib/ui/optional";
import { currentJob, listRunsFromDisk, latestRunFromDisk, type RunListItem } from "@/lib/ui/evals";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, StatusPill, Badge, Notice, EmptyState, Details, ModuleNotice } from "@/components/ui";
import { RunEvals } from "@/components/academy/RunEvals";
import { fmtDateTime, fmtPercent, titleCase } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";
import type { CompetencyScore, AutonomyLevel } from "@/lib/core/types";
import type { EvalRunSummary, EvalCaseResult } from "@/lib/core/contracts";

export const metadata: Metadata = { title: "Academy" };
export const dynamic = "force-dynamic";

const TABS = ["matrix", "domains", "runs", "failures"];

export default async function AcademyPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor } = await pageCtx();
  const ds = rt.dataset;

  const harnessLatest = await callOptional<{ summary: EvalRunSummary; results: EvalCaseResult[] } | null>(() => loadEvalHarness(), "loadLatestEvalRun");
  const latest = harnessLatest.result ?? latestRunFromDisk();
  const harnessRuns = await callOptional<RunListItem[]>(() => loadEvalHarness(), "listEvalRuns");
  const runs = harnessRuns.result ?? listRunsFromDisk();
  const cases = await callOptional<{ id: string; directory: string; capabilityKey: string; title: string }[]>(() => loadEvalHarness(), "loadAllCases");
  const caseById = new Map((cases.result ?? []).map((c) => [c.id, c]));

  const scoreByKey = new Map(ds.competencyScores.map((s) => [s.capabilityKey, s]));
  const rows = CAPABILITIES.map((c) => {
    const s: CompetencyScore | undefined = scoreByKey.get(c.key);
    const level = rt.capabilities.getLevel(c.key);
    const fromRun = latest?.summary.byCapability?.[c.key];
    const score: CompetencyScore = s ?? { capabilityKey: c.key, domain: c.domain, label: c.label, currentLevel: level, maxAllowedLevel: c.maxPhaseOneLevel, passRate: fromRun?.passRate ?? 0, metrics: {}, evaluationCount: fromRun?.total ?? 0, consecutivePassingRuns: 0, failureCaseIds: fromRun?.failureCaseIds ?? [], promotionEligible: false, promotionBlockers: [] };
    const promo = evaluatePromotion(score);
    return { def: c, score, level, promo, tested: !!s || !!fromRun };
  });
  const failed = (latest?.results ?? []).filter((r) => !r.passed);
  const domainTitle = new Map(DOMAINS.map((d) => [d.domain, d.title]));
  const levelName = (l: AutonomyLevel) => AUTONOMY_LEVELS[l]?.name ?? String(l);
  const job = currentJob();

  return (
    <>
      <PageHeader title="Academy" description="Competency matrix and certification status per capability. Autonomy levels are earned through evaluations and never promoted automatically; failures are always shown." actions={<Link href="/academy/readiness" className="text-[12px] text-accent">Readiness report →</Link>} />
      <Grid cols={4} className="mb-5">
        <Stat label="Latest run pass rate" value={latest ? fmtPercent(latest.summary.passRate) : "No run"} sub={latest ? `${latest.summary.passed}/${latest.summary.total} · ${fmtDateTime(latest.summary.ranAt)}` : "Run evals to populate"} tone={latest ? (latest.summary.passRate >= 0.9 ? "ok" : "warn") : "neutral"} />
        <Stat label="Failed cases" value={latest ? latest.summary.failed : "—"} tone={latest?.summary.failed ? "bad" : "ok"} href="/academy?tab=failures" />
        <Stat label="Capabilities" value={CAPABILITIES.length} sub={`${rows.filter((r) => r.tested).length} evaluated · ${rows.filter((r) => r.promo.eligible).length} promotion-eligible`} />
        <Stat label="Eval runs" value={runs.length} sub={job?.status === "running" ? "run in progress" : "history on disk"} />
      </Grid>

      <Card className="mb-5">
        <CardHeader title="Run evaluations" subtitle="Runs execute in the background against the shared synthetic runtime and are polled here. Results fold into the competency matrix." />
        <RunEvals initialJob={job} canRun={can(actor.role, "RUN_EVALS")} />
        <ModuleNotice notice={harnessLatest.notice} />
      </Card>

      <Tabs basePath="/academy" active={tab} tabs={[{ key: "matrix", label: "Competency matrix", count: CAPABILITIES.length }, { key: "domains", label: "Domain scorecards" }, { key: "runs", label: "Run history", count: runs.length }, { key: "failures", label: "Failed cases", count: failed.length }]} />

      {tab === "matrix" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Domain</th>
                <th className="r">Pass rate</th>
                <th className="r">Evals</th>
                <th>Failures</th>
                <th>Last tested</th>
                <th>Autonomy</th>
                <th>Promotion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ def, score, level, promo, tested }) => (
                <tr key={def.key}>
                  <td>
                    <div className="font-medium">{def.label}</div>
                    <div className="mono text-faint">{def.key}</div>
                  </td>
                  <td className="text-muted">{domainTitle.get(def.domain) ?? titleCase(def.domain)}</td>
                  <td className={`r ${!tested ? "text-faint" : score.passRate >= 0.9 ? "text-ok" : score.passRate >= 0.7 ? "text-warn" : "text-bad"}`}>{tested ? fmtPercent(score.passRate) : "—"}</td>
                  <td className="r">{score.evaluationCount}</td>
                  <td>
                    {score.failureCaseIds.length ? (
                      <details>
                        <summary className="cursor-pointer text-bad">{score.failureCaseIds.length} failed</summary>
                        <ul className="mono mt-1 space-y-0.5 text-[11px]">
                          {score.failureCaseIds.map((id) => (
                            <li key={id} title={caseById.get(id)?.title}>
                              {id}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : tested ? (
                      <span className="text-ok">none</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-muted">{score.lastTestedAt ? fmtDateTime(score.lastTestedAt) : "never"}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={level >= 3 ? "ok" : level >= 1 ? "info" : "neutral"}>L{level}</Badge>
                      <span>{levelName(level)}</span>
                    </div>
                    <div className="text-[11px] text-faint">max Phase One L{def.maxPhaseOneLevel}</div>
                  </td>
                  <td className="max-w-[300px]">
                    {promo.eligible ? (
                      <Badge tone="ok">eligible → L{promo.nextLevel}</Badge>
                    ) : (
                      <details>
                        <summary className="cursor-pointer">
                          <StatusPill status="BLOCKED" label={promo.nextLevel === null ? "at max" : `blocked → L${promo.nextLevel}`} />
                        </summary>
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
                          {promo.blockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "domains" ? (
        <div className="space-y-4">
          <Grid cols={3}>
            {DOMAINS.map((d) => {
              const agg = latest?.summary.byDomain?.[d.domain];
              const caps = rows.filter((r) => r.def.domain === d.domain);
              return (
                <Card key={d.domain}>
                  <CardHeader title={d.title} subtitle={d.description} actions={agg ? <Badge tone={agg.passRate >= 0.9 ? "ok" : agg.passRate >= 0.7 ? "warn" : "bad"}>{fmtPercent(agg.passRate)}</Badge> : <Badge>not run</Badge>} />
                  <div className="text-[12px] text-muted">
                    {agg ? `${agg.passed}/${agg.total} cases · ` : ""}
                    {d.competencies.length} competencies · evals/{d.evalDirectory}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[12px]">
                    {caps.map((c) => (
                      <li key={c.def.key} className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.def.label}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="num text-muted">{c.tested ? fmtPercent(c.score.passRate, 0) : "—"}</span>
                          <Badge>L{c.level}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </Grid>
          <Details summary="Autonomy level definitions">
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Modify books</th>
                    <th>Auto GREEN</th>
                    <th>Auto YELLOW</th>
                  </tr>
                </thead>
                <tbody>
                  {AUTONOMY_LEVEL_DEFINITIONS.map((l) => (
                    <tr key={l.level}>
                      <td className="mono">L{l.level}</td>
                      <td className="font-medium">{l.name}</td>
                      <td className="text-muted">{l.description}</td>
                      <td>{l.mayModifyBooks ? "yes" : "no"}</td>
                      <td>{l.mayAutoExecuteGreen ? "yes" : "no"}</td>
                      <td>{l.mayAutoExecuteYellow ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Details>
        </div>
      ) : null}

      {tab === "runs" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Ran at</th>
                <th className="r">Total</th>
                <th className="r">Passed</th>
                <th className="r">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.runId}>
                  <td className="mono">{r.runId}</td>
                  <td className="text-muted">{fmtDateTime(r.ranAt)}</td>
                  <td className="r">{r.total}</td>
                  <td className="r">{r.passed}</td>
                  <td className={`r ${r.passRate >= 0.9 ? "text-ok" : "text-warn"}`}>{fmtPercent(r.passRate)}</td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted">
                    No eval runs recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "failures" ? (
        <div className="space-y-3">
          {!latest ? <EmptyState title="No eval run yet" /> : failed.length === 0 ? <Notice tone="ok">Every case in run {latest.summary.runId} passed.</Notice> : <Notice tone="warn">{failed.length} of {latest.summary.total} cases failed in run {latest.summary.runId}. Failures are never hidden.</Notice>}
          {latest && latest.results.length === 0 && latest.summary.failedCaseIds.length ? (
            <Card>
              <CardHeader title="Failed case ids" subtitle="Per-case results were not stored with this run; only ids are available." />
              <ul className="mono grid grid-cols-1 gap-0.5 text-[11px] sm:grid-cols-3">
                {latest.summary.failedCaseIds.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          {failed.map((r) => (
            <Card key={r.caseId} padded={false}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
                  <StatusPill status="FAILED" />
                  <span className="mono">{r.caseId}</span>
                  <span className="text-muted">{caseById.get(r.caseId)?.title ?? ""}</span>
                  <span className="ml-auto text-[12px] text-muted">
                    {r.agent} · score {fmtPercent(r.score, 0)} · {r.executedActions} executed
                  </span>
                </summary>
                <div className="border-t border-line px-4 py-3 text-[13px]">
                  <ul className="list-disc space-y-0.5 pl-5 text-bad">
                    {r.failures.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Expected</div>
                      <p className="text-muted">{r.expectedSummary}</p>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Actual</div>
                      <p>{r.actualSummary}</p>
                    </div>
                  </div>
                  <table className="tbl mt-2">
                    <tbody>
                      {r.rubricResults.map((rr) => (
                        <tr key={rr.key}>
                          <td className="mono">{rr.key}</td>
                          <td>
                            <StatusPill status={rr.passed ? "PASS" : "FAIL"} />
                          </td>
                          <td className="r">w {rr.weight}</td>
                          <td className="text-muted">{rr.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
