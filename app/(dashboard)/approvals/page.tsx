import type { Metadata } from "next";
import Link from "next/link";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { outstandingRoles, parseDecisions } from "@/lib/approvals/approval-engine";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";
import { PageHeader, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, RiskChip, Badge, Notice, EmptyState, KeyValue, Details } from "@/components/ui";
import { DecideButtons } from "@/components/approvals/DecideButtons";
import { fmtDateTime, titleCase, fmtPercent } from "@/lib/ui/format";
import { pretty } from "@/lib/ui/serialize";
import { can } from "@/lib/security/rbac";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const { rt, actor } = await pageCtx();
  const status = sp(q.status, "PENDING");
  const level = sp(q.level);
  const kind = sp(q.kind);
  const selectedId = sp(q.id);
  const all = [...rt.dataset.approvals].sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  const rows = all.filter((a) => (status === "ALL" || a.status === status) && (!level || a.risk.level === level) && (!kind || a.action.kind === kind));
  const selected = all.find((a) => a.id === selectedId) ?? null;
  const canApprove = can(actor.role, "APPROVE_YELLOW") || can(actor.role, "APPROVE_RED");
  const kinds = Array.from(new Set(all.map((a) => a.action.kind))).sort();
  const agentActionFor = (actionId: string) => rt.dataset.agentActions.find((x) => x.action.id === actionId);

  return (
    <>
      <PageHeader title="Approvals" description="Every YELLOW and RED proposal waits here. Decisions are recorded by human users only, requesters cannot approve their own requests, and RED requests need every required role." />
      <Grid cols={4} className="mb-5">
        <Stat label="Pending" value={all.filter((a) => a.status === "PENDING").length} sub={`${all.filter((a) => a.status === "PENDING" && a.risk.level === "RED").length} RED`} tone={all.some((a) => a.status === "PENDING") ? "warn" : "ok"} />
        <Stat label="Approved" value={all.filter((a) => a.status === "APPROVED").length} />
        <Stat label="Rejected" value={all.filter((a) => a.status === "REJECTED").length} />
        <Stat label="Expired / withdrawn" value={all.filter((a) => a.status === "EXPIRED" || a.status === "WITHDRAWN").length} />
      </Grid>
      <form method="get" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <select name="status" defaultValue={status} className="select">
          {["PENDING", "APPROVED", "REJECTED", "EXPIRED", "WITHDRAWN", "ALL"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select name="level" defaultValue={level} className="select">
          <option value="">Any risk</option>
          {["GREEN", "YELLOW", "RED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select name="kind" defaultValue={kind} className="select">
          <option value="">Any action kind</option>
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
      </form>

      <div className={`grid gap-4 ${selected ? "xl:grid-cols-[1fr_minmax(380px,1fr)]" : ""}`}>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Action</th>
                <th>Risk</th>
                <th className="r">Amount</th>
                <th>Status</th>
                <th>Approvers</th>
                <th>Decide</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.id === selectedId ? "hl" : ""}>
                  <td className="whitespace-nowrap text-muted">{fmtDateTime(a.requestedAt)}</td>
                  <td>
                    <Link href={`/approvals?status=${status}&level=${level}&kind=${kind}&id=${encodeURIComponent(a.id)}`} className="font-medium hover:underline">
                      {titleCase(a.action.kind)}
                    </Link>
                    <div className="max-w-[320px] truncate text-[11px] text-muted" title={a.action.description}>
                      {a.action.description}
                    </div>
                  </td>
                  <td>
                    <RiskChip level={a.risk.level} />
                  </td>
                  <td className="r">{a.action.amount ? <Money value={a.action.amount.amount} currency={a.action.amount.currency} /> : ""}</td>
                  <td>
                    <StatusPill status={a.status} />
                  </td>
                  <td className="mono text-[11px]">{a.requestedApproverRoles.join(", ")}</td>
                  <td>{a.status === "PENDING" ? <DecideButtons approvalId={a.id} disabled={!canApprove} /> : <span className="text-[11px] text-muted">{a.decidedByRole ?? ""}</span>}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No approval requests match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableWrap>

        {selected ? (
          <Card>
            <CardHeader title={`${titleCase(selected.action.kind)} · ${selected.id}`} actions={<><RiskChip level={selected.risk.level} /><StatusPill status={selected.status} /></>} />
            {isPhaseOneProhibited(selected.action.kind) ? <Notice tone="bad" className="mb-3">Phase One prohibited kind: stays BLOCKED even when approved. Approval records intent only.</Notice> : null}
            <KeyValue
              dense
              items={[
                { k: "Description", v: selected.action.description },
                { k: "Reason", v: selected.action.reason },
                { k: "Amount", v: selected.action.amount ? <Money value={selected.action.amount.amount} currency={selected.action.amount.currency} /> : "—" },
                { k: "Impact", v: selected.action.financialImpact ?? "—" },
                { k: "Agent", v: selected.action.agent, mono: true },
                { k: "Targets", v: selected.action.targetIds.join(", ") || "—", mono: true },
                { k: "Sources", v: selected.action.sourceDocumentIds.join(", ") || "—", mono: true },
                { k: "Confidence", v: fmtPercent(selected.action.confidence, 0) },
                { k: "Reversible", v: selected.action.reversible ? "yes" : "no" },
                { k: "Rollback", v: selected.action.rollbackPlan ?? "—" },
                { k: "Alternatives", v: selected.action.alternatives?.length ? <ul className="list-disc pl-4">{selected.action.alternatives.map((x, i) => <li key={i}>{x}</li>)}</ul> : "—" },
                { k: "Risk reasons", v: <ul className="list-disc pl-4">{selected.risk.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul> },
                { k: "Policy refs", v: selected.risk.policyRefs.join(", ") || "—", mono: true },
                { k: "Materiality", v: selected.risk.materialityBreached ? <Badge tone="warn">breached</Badge> : "within thresholds" },
                { k: "Required roles", v: <span className="mono">{selected.requestedApproverRoles.join(", ")}</span> },
                { k: "Outstanding", v: selected.status === "PENDING" ? <span className="mono">{outstandingRoles(selected).join(", ") || "none"}</span> : "—" },
                { k: "Requested", v: fmtDateTime(selected.requestedAt) },
                { k: "Expires", v: fmtDateTime(selected.expiresAt) },
                { k: "Decided", v: selected.decidedAt ? `${fmtDateTime(selected.decidedAt)} by ${selected.decidedBy} (${selected.decidedByRole})` : "—" },
                { k: "Audit events", v: selected.auditEventIds.join(", ") || "—", mono: true },
              ]}
            />
            {(() => {
              const aa = agentActionFor(selected.action.id);
              return aa ? (
                <div className="mt-3 rounded-md border border-line bg-surface-2 p-2 text-[12px]">
                  Execution record: <StatusPill status={aa.status} /> {aa.blockedReason ? <span className="text-bad">{aa.blockedReason}</span> : null} {aa.executedAt ? <span className="text-muted">{fmtDateTime(aa.executedAt)}</span> : null}
                </div>
              ) : null;
            })()}
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">History</div>
              <ul className="space-y-1 text-[12px]">
                {parseDecisions(selected).map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <StatusPill status={d.decision} />
                    <span className="mono">{d.role}</span>
                    <span>{d.actor.displayName ?? d.actor.id}</span>
                    <span className="text-muted">{fmtDateTime(d.at)}</span>
                    {d.satisfies?.length ? <span className="text-muted">satisfies {d.satisfies.join(", ")}</span> : null}
                    {d.comment ? <span className="text-muted">“{d.comment}”</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            {selected.status === "PENDING" ? (
              <div className="mt-4">
                <DecideButtons approvalId={selected.id} disabled={!canApprove} size="md" showComment />
                {!canApprove ? <p className="mt-1 text-[11px] text-bad">Your role cannot approve. Switch roles under Settings.</p> : null}
              </div>
            ) : null}
            <Details summary="Payload" className="mt-3">
              <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{pretty(selected.action.payload)}</pre>
            </Details>
          </Card>
        ) : null}
      </div>
      {rows.length === 0 && all.length === 0 ? <EmptyState title="No approval requests yet" className="mt-4" /> : null}
    </>
  );
}
