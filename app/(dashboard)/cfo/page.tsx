import type { Metadata } from "next";
import Link from "next/link";
import { pageCtx } from "@/lib/ui/page";
import { cashPosition, cashLabel, thirteenWeek, arReport, nextPayroll, localAttentionQueue, localFinancialHealth, CASH_UNKNOWN_LABEL, type AttentionItem, type HealthScorecard } from "@/lib/ui/data";
import { callOptional, loadMonitors, loadWorkflows } from "@/lib/ui/optional";
import { normalizeAttention, normalizeBrief, normalizeHealth } from "@/lib/ui/normalize";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/ui/format";
import { PageHeader, Section, Card, CardHeader, RiskChip, StatusPill, Markdown, EmptyState, ModuleNotice, Notice, Badge, TableWrap, Money, Details, KeyValue } from "@/components/ui";
import { AskCfo } from "@/components/cfo/AskCfo";
import { DecideButtons } from "@/components/approvals/DecideButtons";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { outstandingRoles } from "@/lib/approvals/approval-engine";
import { pretty } from "@/lib/ui/serialize";
import { can } from "@/lib/security/rbac";

export const metadata: Metadata = { title: "CFO" };
export const dynamic = "force-dynamic";

export default async function CfoPage() {
  const { rt, actor, asOf } = await pageCtx();
  const ds = rt.dataset;

  // 1. Brief
  const briefRes = await callOptional<unknown>(() => loadWorkflows(), "buildWeeklyBrief", rt, asOf);
  let briefMd: string | null = null;
  if (briefRes.result) {
    const md = await callOptional<string>(() => loadWorkflows(), "renderWeeklyBriefMarkdown", briefRes.result);
    briefMd = md.result ?? null;
  }
  const brief = briefRes.result ? normalizeBrief(briefRes.result, briefMd) : null;
  const cash = cashPosition(rt);
  const tw = thirteenWeek(rt);
  const ar = arReport(rt).value;
  const pay = nextPayroll(rt);
  const pending = ds.approvals.filter((a) => a.status === "PENDING").sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));

  // 3. Attention
  const monitors = await callOptional<unknown>(() => loadMonitors(), "buildAttentionQueue", rt, asOf);
  const attention: AttentionItem[] = monitors.result ? normalizeAttention(monitors.result) : localAttentionQueue(rt);

  // 6. Health
  const health = await callOptional<unknown>(() => loadWorkflows(), "financialHealth", rt, asOf);
  const scorecard: HealthScorecard = health.result ? normalizeHealth(health.result, asOf) : localFinancialHealth(rt);

  // 5. Recent actions
  const recentActions = [...ds.agentActions].sort((a, b) => ((a.executedAt ?? a.action.createdAt) < (b.executedAt ?? b.action.createdAt) ? 1 : -1)).slice(0, 10);
  const recentEvents = [...ds.auditEvents].sort((a, b) => b.seq - a.seq).slice(0, 10);

  // 7. Calculations
  const recentCalcs = [...ds.calculations].slice(-12).reverse();

  const canApprove = can(actor.role, "APPROVE_YELLOW") || can(actor.role, "APPROVE_RED");

  return (
    <>
      <PageHeader eyebrow={`As of ${fmtDate(asOf)}`} title="CFO" description="The executive desk: today's brief, ask the CFO, what needs attention, decisions waiting on you, and the workpapers behind every number." />

      <div className="space-y-8">
        <Section id="brief" title="Today's CFO brief" description={brief ? "Weekly brief executive summary and key numbers." : "Local summary — the weekly-brief workflow is not available yet, so these are the ledger's own numbers."}>
          <Card>
            {brief ? (
              <>
                {brief.summary ? <p className="text-[15px] leading-relaxed">{brief.summary}</p> : null}
                {brief.keyNumbers.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {brief.keyNumbers.map((n, i) => (
                      <div key={i} className="rounded-md border border-line bg-surface-2 p-2.5">
                        <div className="text-[11px] uppercase tracking-wider text-muted">{n.label}</div>
                        <div className="num text-[18px] font-semibold">{n.value}</div>
                        {n.note ? <div className="text-[11px] text-faint">{n.note}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {brief.markdown ? (
                  <Details summary="Full weekly brief" className="mt-3">
                    <Markdown text={brief.markdown} />
                  </Details>
                ) : brief.sections.length ? (
                  <div className="mt-3 space-y-3">
                    {brief.sections.map((s, i) => (
                      <div key={i}>
                        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{s.title}</h4>
                        <Markdown text={s.body} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-[15px] leading-relaxed">
                  {cash.known ? (
                    <>
                      Cash is <strong className="num">{fmtMoney(cash.totalCash)}</strong> across {cash.accounts.filter((a) => a.kind === "BANK").length} bank accounts. The 13-week low point is <strong className="num">{fmtMoney(tw.lowestCash)}</strong> in week {tw.lowestCashWeek}
                      {tw.minimumCash === null ? " (no reserve policy set to compare against)" : tw.weeksBelowMinimum ? ` — ${tw.weeksBelowMinimum} week(s) fall below the reserve policy` : " — above the reserve policy all 13 weeks"}.
                    </>
                  ) : (
                    <>
                      Cash is <strong>{CASH_UNKNOWN_LABEL}</strong>: the ledger has no posted entries, so no cash balance or 13-week forecast can be stated.
                    </>
                  )}{" "}
                  Overdue receivables total <strong className="num">{fmtMoney(ar.overdueTotal)}</strong> across {ar.overdue.length} invoices.
                  {pay.date ? ` Next payroll is expected ${fmtDate(pay.date)} at roughly ${fmtMoney(pay.expectedEmployerCost)} employer cost.` : " Payroll cadence could not be determined."} {pending.length} decision{pending.length === 1 ? "" : "s"} await approval.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Cash", cashLabel(cash, cash.totalCash, fmtMoney)],
                    ["13-wk low", cashLabel(cash, tw.lowestCash, fmtMoney)],
                    ["AR overdue", fmtMoney(ar.overdueTotal)],
                    ["Open approvals", String(pending.length)],
                  ].map(([l, v]) => (
                    <div key={l} className="rounded-md border border-line bg-surface-2 p-2.5">
                      <div className="text-[11px] uppercase tracking-wider text-muted">{l}</div>
                      <div className="num text-[18px] font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
                <ModuleNotice notice={briefRes.notice} />
              </>
            )}
          </Card>
        </Section>

        <Section id="ask" title="Ask CFO" description="Answers follow the mandatory executive format. Numbers come from deterministic calculations with workpapers; the model never computes or posts.">
          <AskCfo />
        </Section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section id="attention" title="Attention needed" description={monitors.result ? "Proactive monitors" : "Computed locally — lib/monitors not yet available"}>
            <Card padded={false}>
              {attention.length === 0 ? (
                <EmptyState title="Nothing needs attention" className="m-3" />
              ) : (
                <ul className="divide-y divide-line">
                  {attention.slice(0, 12).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                      <RiskChip level={a.severity === "INFO" ? null : a.severity} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">{a.href ? <Link href={a.href} className="hover:underline">{a.title}</Link> : a.title}</div>
                        <div className="text-[12px] text-muted">{a.detail}</div>
                      </div>
                      <Badge className="shrink-0">{a.kind}</Badge>
                    </li>
                  ))}
                  {attention.length > 12 ? (
                    <li className="px-4 py-2.5 text-[12px] text-muted">
                      {attention.length - 12} more item(s) not shown; each is also surfaced in its own section (Transactions, Documents, Payroll, Tax).
                    </li>
                  ) : null}
                </ul>
              )}
            </Card>
          </Section>

          <Section id="approvals" title="Decisions awaiting approval" description="Approve or reject with your lab role. Rejected and expired requests are terminal." actions={<Link href="/approvals" className="text-[12px] text-accent">All approvals →</Link>}>
            <Card padded={false}>
              {pending.length === 0 ? (
                <EmptyState title="No pending approvals" className="m-3" />
              ) : (
                <ul className="divide-y divide-line">
                  {pending.slice(0, 8).map((a) => {
                    const prohibited = isPhaseOneProhibited(a.action.kind);
                    const outstanding = outstandingRoles(a);
                    return (
                      <li key={a.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <RiskChip level={a.risk.level} />
                              <span className="text-[13px] font-medium">{titleCase(a.action.kind)}</span>
                              {a.action.amount ? <Money value={a.action.amount.amount} currency={a.action.amount.currency} className="text-[13px] font-medium" /> : null}
                            </div>
                            <p className="mt-1 text-[13px]">{a.action.description}</p>
                            <p className="text-[12px] text-muted">{a.action.reason}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                              <span>
                                requires <span className="mono">{a.requestedApproverRoles.join(", ")}</span>
                              </span>
                              {a.risk.level === "RED" && outstanding.length ? <span>outstanding: {outstanding.join(", ")}</span> : null}
                              <span>requested {fmtDateTime(a.requestedAt)}</span>
                              <Link href={`/approvals?id=${encodeURIComponent(a.id)}`} className="text-accent">
                                detail →
                              </Link>
                            </div>
                            {prohibited ? <Notice tone="bad" className="mt-2">Phase One: {a.action.kind} is simulation-only. It stays BLOCKED even when approved — approval records intent, nothing executes.</Notice> : null}
                          </div>
                          <DecideButtons approvalId={a.id} disabled={!canApprove} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </Section>
        </div>

        <Section id="actions" title="Recent CFO actions" description="Governed agent actions and the audit events behind them.">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card padded={false}>
              <CardHeader title="Agent actions" className="px-4 pt-3" />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Risk</th>
                      <th>Status</th>
                      <th>Agent</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted">
                          No agent actions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      recentActions.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <div>{titleCase(a.action.kind)}</div>
                            <div className="max-w-[320px] truncate text-[11px] text-muted" title={a.action.description}>
                              {a.action.description}
                            </div>
                          </td>
                          <td>
                            <RiskChip level={a.risk.level} />
                          </td>
                          <td>
                            <StatusPill status={a.status} />
                            {a.blockedReason ? <div className="text-[11px] text-bad">{a.blockedReason}</div> : null}
                          </td>
                          <td className="mono">{a.action.agent}</td>
                          <td className="whitespace-nowrap text-muted">{fmtDateTime(a.executedAt ?? a.action.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
            <Card padded={false}>
              <CardHeader title="Audit events" className="px-4 pt-3" actions={<Link href="/audit" className="text-[12px] text-accent">Timeline →</Link>} />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="r">#</th>
                      <th>Event</th>
                      <th>Actor</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((e) => (
                      <tr key={e.id}>
                        <td className="r mono">{e.seq}</td>
                        <td>
                          <div className="mono">{e.eventType}</div>
                          <div className="max-w-[320px] truncate text-[11px] text-muted" title={e.explanation}>
                            {e.explanation}
                          </div>
                        </td>
                        <td>
                          <span className="mono">{e.actor.role}</span>
                          {e.agent ? <span className="text-muted"> · {e.agent}</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-muted">{fmtDateTime(e.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section id="health" title="Financial health" description={scorecard.source}>
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] text-muted">Overall</span>
                <RiskChip level={scorecard.overall === "UNKNOWN" ? null : scorecard.overall} />
              </div>
              <TableWrap className="border-0">
                <table className="tbl">
                  <tbody>
                    {scorecard.metrics.map((m) => (
                      <tr key={m.key}>
                        <td>
                          <div>{m.label}</div>
                          <div className="text-[11px] text-faint">{m.note}</div>
                        </td>
                        <td className="r font-medium">{m.value}</td>
                        <td className="c">
                          <RiskChip level={m.status === "UNKNOWN" ? null : m.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <ModuleNotice notice={health.notice} />
            </Card>
          </Section>

          <Section id="workpapers" title="Sources & workpapers" description="Most recent stored calculations: formula, inputs and source ids.">
            <Card padded={false}>
              {recentCalcs.length === 0 ? (
                <EmptyState title="No stored calculations yet" className="m-3">
                  Calculations are stored as the CFO answers questions and runs workflows.
                </EmptyState>
              ) : (
                <div className="divide-y divide-line">
                  {recentCalcs.map((c) => (
                    <details key={c.id} className="group">
                      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-2 text-[13px] hover:bg-surface-2">
                        <span className="min-w-0 truncate">
                          {c.name} <span className="mono text-faint">{c.id}</span>
                        </span>
                        <span className="num shrink-0 font-medium">{typeof c.value === "object" ? "table" : String(c.value)} {c.unit}</span>
                      </summary>
                      <div className="px-4 pb-3">
                        <KeyValue dense items={[{ k: "Formula", v: c.formula, mono: true }, { k: "Inputs", v: <pre className="mono whitespace-pre-wrap text-[11px]">{pretty(c.inputs)}</pre> }, { k: "Sources", v: c.sourceIds.join(", ") || "—", mono: true }, { k: "As of", v: c.asOfDate }]} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </Section>
        </div>
      </div>
    </>
  );
}
