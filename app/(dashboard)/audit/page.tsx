import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { verifyEventChain } from "@/lib/audit/audit-log";
import { whyDidTheCfoDoThis, type Explanation } from "@/lib/audit/explain";
import { PageHeader, Grid, Stat, Card, CardHeader, TableWrap, StatusPill, RiskChip, Badge, Notice, EmptyState, KeyValue } from "@/components/ui";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { fmtDateTime } from "@/lib/ui/format";
import { pretty } from "@/lib/ui/serialize";
import { can } from "@/lib/security/rbac";

export const metadata: Metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const { rt, actor } = await pageCtx();
  if (!can(actor.role, "VIEW_AUDIT")) {
    return (
      <>
        <PageHeader title="Audit" />
        <AccessDenied permission="VIEW_AUDIT" role={actor.role} />
      </>
    );
  }
  const agent = sp(q.agent);
  const eventType = sp(q.type);
  const why = sp(q.why).trim();
  const events = [...rt.dataset.auditEvents].sort((a, b) => b.seq - a.seq);
  const filtered = events.filter((e) => (!agent || e.agent === agent) && (!eventType || e.eventType === eventType));
  const chain = verifyEventChain(rt.dataset.auditEvents);
  const agents = Array.from(new Set(events.map((e) => e.agent).filter(Boolean))).sort() as string[];
  const types = Array.from(new Set(events.map((e) => e.eventType))).sort();
  let explanation: Explanation | null = null;
  let whyError: string | null = null;
  if (why) {
    try {
      explanation = whyDidTheCfoDoThis(rt.audit, rt.dataset, why);
    } catch (err) {
      whyError = err instanceof Error ? err.message : "Lookup failed";
    }
  }

  return (
    <>
      <PageHeader title="Audit" description="Immutable, hash-chained record of every meaningful action: who, which model, which tools, which sources and calculations, and what changed." />
      <Grid cols={4} className="mb-5">
        <Stat label="Chain verification" value={chain.valid ? "Valid" : "BROKEN"} sub={chain.valid ? `${chain.count} events verified` : `broken at seq ${chain.brokenAtSeq}${chain.reason ? ` — ${chain.reason}` : ""}`} tone={chain.valid ? "ok" : "bad"} />
        <Stat label="Events" value={events.length} sub={`${types.length} event types`} />
        <Stat label="Agents" value={agents.length} sub={agents.slice(0, 4).join(", ") || "—"} />
        <Stat label="Latest" value={events[0] ? `#${events[0].seq}` : "—"} sub={events[0] ? fmtDateTime(events[0].timestamp) : ""} />
      </Grid>

      <Card className="mb-5">
        <CardHeader title="Why did the CFO do this?" subtitle="Enter an action, approval, journal entry, calculation or document id to reconstruct the chain of events behind it." />
        <form method="get" className="flex flex-wrap gap-2">
          <input name="why" defaultValue={why} placeholder="e.g. act_…, apr_…, je_…, calc_…" className="input max-w-md" />
          <button className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg">Explain</button>
        </form>
        {whyError ? <Notice tone="bad" className="mt-3">{whyError}</Notice> : null}
        {explanation ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {explanation.resolvedAs.map((r) => (
                <Badge key={r} tone={r === "UNKNOWN" ? "bad" : "accent"}>
                  {r.replace(/_/g, " ")}
                </Badge>
              ))}
              {explanation.riskLevel ? <RiskChip level={explanation.riskLevel} /> : null}
              {explanation.finalStatus ? <StatusPill status={explanation.finalStatus} /> : null}
            </div>
            <p className="text-[14px] leading-relaxed">{explanation.narrative}</p>
            <KeyValue dense items={[{ k: "Related ids", v: explanation.relatedIds.join(", ") || "—", mono: true }, { k: "Sources", v: explanation.sourceDocumentIds.join(", ") || "—", mono: true }, { k: "Calculations", v: explanation.calculationIds.join(", ") || "—", mono: true }, { k: "Approvals", v: explanation.approvalIds.join(", ") || "—", mono: true }]} />
            {explanation.steps.length === 0 ? (
              <EmptyState title="No audit events reference this id" />
            ) : (
              <ol className="relative ml-2 space-y-3 border-l border-line-strong pl-4">
                {explanation.steps.map((s) => (
                  <li key={s.eventId} className="text-[13px]">
                    <span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full bg-accent" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-[11px] text-muted">#{s.seq}</span>
                      <span className="mono">{s.eventType}</span>
                      <span className="text-muted">{s.actor}{s.agent ? ` · ${s.agent}` : ""}</span>
                      <span className="text-[11px] text-faint">{fmtDateTime(s.at)}</span>
                    </div>
                    <div>{s.summary}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </Card>

      <form method="get" className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <select name="agent" defaultValue={agent} className="select">
          <option value="">Any agent</option>
          {agents.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select name="type" defaultValue={eventType} className="select">
          <option value="">Any event type</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
        <div className="self-center text-[12px] text-muted">{filtered.length} events</div>
      </form>

      <div className="space-y-1.5">
        {filtered.slice(0, 200).map((e) => (
          <details key={e.id} className="group rounded-lg border border-line bg-surface">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2 hover:bg-surface-2">
              <span className="mono w-12 text-[11px] text-muted">#{e.seq}</span>
              <span className="mono text-[12px] font-medium">{e.eventType}</span>
              <span className="text-[12px] text-muted">
                {e.actor.role}:{e.actor.id}
              </span>
              {e.agent ? <Badge tone="accent">{e.agent}</Badge> : null}
              {e.toolsCalled.length ? <Badge>{e.toolsCalled.length} tools</Badge> : null}
              {e.approvalIds.length ? <Badge tone="warn">{e.approvalIds.length} approvals</Badge> : null}
              <span className="ml-auto text-[11px] text-faint">{fmtDateTime(e.timestamp)}</span>
            </summary>
            <div className="border-t border-line px-4 py-3 text-[13px]">
              <p>{e.explanation}</p>
              <KeyValue
                dense
                className="mt-2"
                items={[
                  { k: "Id", v: e.id, mono: true },
                  { k: "Workflow", v: `${e.workflowVersion}${e.promptVersion ? ` · prompt ${e.promptVersion}` : ""}`, mono: true },
                  { k: "Model", v: e.model ? `${e.model.provider}/${e.model.model}${e.model.deterministic ? " (deterministic)" : ""}` : "—", mono: true },
                  { k: "Final action", v: e.finalAction ?? "—" },
                  { k: "Proposed action", v: e.proposedActionId ?? "—", mono: true },
                  { k: "Approvals", v: e.approvalIds.join(", ") || "—", mono: true },
                  { k: "Sources", v: e.sourceDocumentIds.join(", ") || "—", mono: true },
                  { k: "Calculations", v: e.calculationIds.join(", ") || "—", mono: true },
                  { k: "Confidence", v: e.confidence !== undefined ? `${(e.confidence * 100).toFixed(0)}%` : "—" },
                  { k: "Hash", v: `${e.hash.slice(0, 16)}… ← ${e.previousHash.slice(0, 16)}…`, mono: true },
                ]}
              />
              {e.toolsCalled.length ? (
                <TableWrap className="mt-2 border-0">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Risk</th>
                        <th>OK</th>
                        <th className="r">ms</th>
                        <th>In / out hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.toolsCalled.map((t, i) => (
                        <tr key={i}>
                          <td className="mono">{t.name}</td>
                          <td>
                            <RiskChip level={t.riskLevel} />
                          </td>
                          <td>{t.ok ? "yes" : `no ${t.error ?? ""}`}</td>
                          <td className="r">{t.durationMs}</td>
                          <td className="mono text-[11px] text-faint">
                            {t.inputHash.slice(0, 10)} / {t.outputHash.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : null}
              {e.beforeState || e.afterState ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Before</div>
                    <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px]">{e.beforeState ? pretty(e.beforeState) : "—"}</pre>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">After</div>
                    <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px]">{e.afterState ? pretty(e.afterState) : "—"}</pre>
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        ))}
        {filtered.length > 200 ? <Notice>Showing the latest 200 of {filtered.length}. Narrow the filters to see older events.</Notice> : null}
        {filtered.length === 0 ? <EmptyState title="No audit events match" /> : null}
      </div>
    </>
  );
}
