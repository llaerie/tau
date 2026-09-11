import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { buildTaxCalendar, calendarSummary, PENDING_DUE_DATE_NOTE } from "@/lib/tax/calendar";
import { buildTaxDocumentChecklist } from "@/lib/tax/checklist";
import { PROHIBITED_PATTERNS } from "@/lib/tax/guard";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState, Details, KeyValue } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtPercent, titleCase } from "@/lib/ui/format";
import { yearOf } from "@/lib/core/dates";

export const metadata: Metadata = { title: "Tax" };
export const dynamic = "force-dynamic";

const TABS = ["calendar", "rules", "cpa-queue", "workpapers", "checklist"];
const PENDING_LABEL = "Pending authoritative source + CPA confirmation";

export default async function TaxPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, asOf } = await pageCtx();
  const ds = rt.dataset;
  const taxYear = Number(sp(q.year)) || yearOf(asOf);
  const calendar = buildTaxCalendar(ds, taxYear, rt.taxRules, asOf);
  const summary = calendarSummary(calendar);
  const rules = rt.taxRules.all().sort((a, b) => a.key.localeCompare(b.key) || (a.taxYear ?? 0) - (b.taxYear ?? 0));
  const queue = rt.cpaQueue.all().sort((a, b) => (a.status === "OPEN" ? -1 : 1) - (b.status === "OPEN" ? -1 : 1) || a.createdAt.localeCompare(b.createdAt));
  const workpapers = [...ds.taxWorkpapers].sort((a, b) => b.taxYear - a.taxYear);
  const checklist = buildTaxDocumentChecklist(ds, taxYear);
  const calcById = new Map(ds.calculations.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Tax control system" description="Tax rules are data with a cited source, never memory. Unknown due dates stay unknown, rules without a current authoritative source escalate to the CPA, and filing/signing/paying are always refused." />
      <Notice tone="bad" className="mb-4" title="Prohibited autonomous actions (Phase One and beyond)">
        The CFO will not: {PROHIBITED_PATTERNS.map((p) => titleCase(p.category)).join(" · ")}. Requests in these categories are routed to a CPA review item with the question preserved verbatim.
      </Notice>
      <Grid cols={4} className="mb-5">
        <Stat label={`Obligations ${taxYear}`} value={summary.total} sub={`${summary.upcoming} upcoming · ${summary.due} due · ${summary.personalReminders} personal reminder`} />
        <Stat label="Unknown due dates" value={summary.unknownDueDates} sub={PENDING_LABEL} tone={summary.unknownDueDates ? "warn" : "ok"} />
        <Stat label="Rules current" value={`${rules.filter((r) => r.status === "CURRENT").length}/${rules.length}`} sub={`${rules.filter((r) => r.status === "PENDING_RETRIEVAL").length} pending retrieval · ${rules.filter((r) => r.status === "STALE").length} stale`} tone={rules.some((r) => r.status === "CURRENT") ? "ok" : "warn"} />
        <Stat label="CPA queue" value={queue.filter((i) => i.status === "OPEN").length} sub={`${queue.filter((i) => i.status === "OPEN" && i.urgency === "BLOCKING").length} blocking`} tone={queue.some((i) => i.status === "OPEN") ? "warn" : "ok"} />
      </Grid>
      <Tabs basePath="/tax" active={tab} preserve={{ year: String(taxYear) }} tabs={[{ key: "calendar", label: "Calendar", count: calendar.length }, { key: "rules", label: "Rule store", count: rules.length }, { key: "cpa-queue", label: "CPA review queue", count: queue.filter((i) => i.status === "OPEN").length }, { key: "workpapers", label: "Workpapers", count: workpapers.length }, { key: "checklist", label: "Document checklist" }]} />

      <form method="get" className="mb-3 flex items-center gap-2 text-[12px] text-muted">
        <input type="hidden" name="tab" value={tab} />
        Tax year
        <select name="year" defaultValue={taxYear} className="select w-28">
          {[taxYear - 2, taxYear - 1, taxYear, taxYear + 1].filter((y, i, arr) => arr.indexOf(y) === i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2">Apply</button>
      </form>

      {tab === "calendar" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Obligation</th>
                <th>Period</th>
                <th>Due</th>
                <th>Status</th>
                <th className="r">Amount</th>
                <th>CPA</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {calendar.map((o) => (
                <tr key={o.id} className={o.dueDate === null ? "" : o.status === "DUE" ? "hl" : ""}>
                  <td>
                    <Badge>{o.jurisdiction}</Badge>
                  </td>
                  <td>
                    <div className="font-medium">{o.title}</div>
                    <div className="mono text-faint">{o.kind}</div>
                  </td>
                  <td className="text-muted">{o.periodLabel ?? "annual"}</td>
                  <td>{o.dueDate ? fmtDate(o.dueDate) : <span className="text-warn">{PENDING_LABEL}</span>}</td>
                  <td>
                    <StatusPill status={o.status} />
                  </td>
                  <td className="r">{o.amount === null ? <span className="text-muted">unknown</span> : <Money value={o.amount} />}</td>
                  <td>{o.requiresCpaReview ? <Badge tone="warn">CPA review</Badge> : ""}</td>
                  <td className="max-w-[360px] text-[11px] text-muted">{(o.notes ?? []).filter((n) => n !== PENDING_DUE_DATE_NOTE).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "rules" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Jurisdiction</th>
                <th>Tax year</th>
                <th>Status</th>
                <th className="r">Confidence</th>
                <th>Source</th>
                <th>Review by</th>
                <th>Parameters</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const src = rt.taxRules.getSource(r.sourceId);
                return (
                  <tr key={r.id} className={r.status === "STALE" ? "hl" : ""}>
                    <td>
                      <div className="font-medium">{r.title}</div>
                      <div className="mono text-faint">{r.key}</div>
                    </td>
                    <td>
                      <Badge>{r.jurisdiction}</Badge>
                    </td>
                    <td>{r.taxYear ?? <span className="text-muted">any</span>}</td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="r">{fmtPercent(r.confidence, 0)}</td>
                    <td className="max-w-[240px]">
                      {src ? (
                        <>
                          <div className="truncate" title={src.title}>
                            {src.title}
                          </div>
                          <div className="text-[11px] text-muted">
                            {src.layer} · <StatusPill status={src.status} />
                          </div>
                        </>
                      ) : (
                        <span className="mono">{r.sourceId}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{r.reviewBy === "1970-01-01" ? "never reviewed" : fmtDate(r.reviewBy)}</td>
                    <td className="mono text-[11px] text-muted">{r.parameters ? JSON.stringify(r.parameters) : "none (unknown)"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "cpa-queue" ? (
        <div className="space-y-2">
          {queue.length === 0 ? <EmptyState title="CPA review queue is empty">Items appear here when a tax question needs professional judgment or a rule is missing.</EmptyState> : null}
          {queue.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={i.urgency} />
                    <StatusPill status={i.status} />
                    <span className="text-[13px] font-medium">{i.topic}</span>
                    <span className="mono text-[11px] text-faint">{i.id}</span>
                  </div>
                  <p className="mt-1 text-[13px]">{i.question}</p>
                  <p className="text-[12px] text-muted">{i.context}</p>
                  <div className="mt-1 text-[11px] text-muted">
                    {fmtDateTime(i.createdAt)} by {i.createdBy}
                    {i.relatedConfigKeys?.length ? (
                      <>
                        {" "}
                        · config <span className="mono">{i.relatedConfigKeys.join(", ")}</span>
                      </>
                    ) : null}
                    {i.resolvedAt ? ` · resolved ${fmtDateTime(i.resolvedAt)} by ${i.resolvedBy} (${i.guidanceId})` : ""}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "workpapers" ? (
        <div className="space-y-3">
          {workpapers.length === 0 ? <EmptyState title="No tax workpapers yet">Ask the CFO for a tax workpaper (task tax.workpaper) to build one; it separates facts, calculations, assumptions and professional judgment.</EmptyState> : null}
          {workpapers.map((wp) => (
            <Details key={wp.id} summary={<span className="flex flex-wrap items-center gap-2">{wp.title}<Badge>{wp.jurisdiction}</Badge><span className="text-muted">TY{wp.taxYear}</span><StatusPill status={wp.cpaReviewStatus} /><span className="num text-muted">confidence {fmtPercent(wp.confidence, 0)}</span></span>}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Facts</div>
                  <ul className="mt-1 space-y-0.5 text-[13px]">
                    {wp.facts.map((f, i) => (
                      <li key={i}>
                        {f.label}: <span className="num">{String(f.value)}</span> <span className="mono text-faint">{f.sourceIds.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Calculations</div>
                  <ul className="mt-1 space-y-0.5 text-[13px]">
                    {wp.calculations.map((id) => {
                      const c = calcById.get(id);
                      return (
                        <li key={id}>
                          {c ? `${c.name} = ${typeof c.value === "object" ? "table" : String(c.value)} ${c.unit}` : id} <span className="mono text-faint">{id}</span>
                        </li>
                      );
                    })}
                    {wp.calculations.length === 0 ? <li className="text-muted">none</li> : null}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Assumptions</div>
                  <ul className="mt-1 space-y-0.5 text-[13px]">
                    {wp.assumptions.map((a) => (
                      <li key={a.key} className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={a.status} />
                        {a.description}
                      </li>
                    ))}
                    {wp.assumptions.length === 0 ? <li className="text-muted">none</li> : null}
                  </ul>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-warn">Professional judgment</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                    {wp.professionalJudgmentItems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                    {wp.professionalJudgmentItems.length === 0 ? <li className="list-none text-muted">none</li> : null}
                  </ul>
                  <KeyValue dense className="mt-3" items={[{ k: "CPA review", v: wp.cpaReviewRequired ? `required · ${wp.cpaReviewStatus}` : "not required" }, { k: "Created", v: `${fmtDateTime(wp.createdAt)} by ${wp.createdBy}` }, { k: "Id", v: wp.id, mono: true }]} />
                </div>
              </div>
            </Details>
          ))}
        </div>
      ) : null}

      {tab === "checklist" ? (
        <Card padded={false}>
          <CardHeader title={`Tax document checklist ${checklist.taxYear}`} className="px-4 pt-3" subtitle={`${checklist.presentCount} present · ${checklist.missingRequiredCount} required items missing`} />
          <TableWrap className="border-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Kinds</th>
                  <th>Required</th>
                  <th>Status</th>
                  <th>Documents</th>
                  <th>Missing detail / note</th>
                </tr>
              </thead>
              <tbody>
                {checklist.items.map((it) => (
                  <tr key={it.key} className={it.required && !it.present ? "hl" : ""}>
                    <td className="font-medium">{it.label}</td>
                    <td className="text-muted">{it.kinds.join(", ")}</td>
                    <td>{it.required ? "yes" : "optional"}</td>
                    <td>
                      <StatusPill status={it.present ? "PRESENT" : "MISSING"} label={it.present ? "present" : "missing"} />
                    </td>
                    <td className="mono text-[11px] text-muted">{it.documentIds.length ? `${it.documentIds.length} docs` : "—"}</td>
                    <td className="max-w-[360px] text-[11px] text-muted">
                      {it.missingDetail?.join(", ")} {it.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
      <p className="mt-6 text-[11px] text-faint">Calendar as of {fmtDate(asOf)} · amounts shown only when computed with a CURRENT rule; otherwise {fmtMoney(null)}.</p>
    </>
  );
}
