import type { Metadata } from "next";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { unknownsRegistry, blockedCapabilities, bibleSummary, BIBLE_SECTIONS, MONTH_END_CLOSE_STEPS, YEAR_END_STEPS } from "@/lib/knowledge/finance-bible";
import { mergedConfigFields } from "@/lib/ui/config";
import { PageHeader, Tabs, pickTab, Card, CardHeader, StatusPill, Badge, Grid, Stat, TableWrap, Notice, Details, EmptyState, KeyValue } from "@/components/ui";
import { AnswerFieldForm } from "@/components/company/AnswerFieldForm";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { fmtDateTime, titleCase } from "@/lib/ui/format";
import { pretty } from "@/lib/ui/serialize";
import { can } from "@/lib/security/rbac";
import type { ConfigField } from "@/lib/core/types";

export const metadata: Metadata = { title: "Company setup" };
export const dynamic = "force-dynamic";

const TABS = ["setup", "bible", "international", "synthetic"];

function fieldValue(v: unknown): string {
  if (v === null || v === undefined) return "UNKNOWN";
  if (typeof v === "string") return v;
  return pretty(v, 0);
}

export default async function CompanyPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor } = await pageCtx();
  const canEdit = can(actor.role, "EDIT_CONFIG");
  const merged = mergedConfigFields(rt.bible, rt.dataset.configFields);
  const registry = unknownsRegistry(merged);
  const blocked = blockedCapabilities(merged);
  const summary = bibleSummary(merged);
  const bySection = new Map<string, typeof registry>();
  for (const item of registry) {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section)!.push(item);
  }
  const fieldByKey = new Map(merged.map((f) => [f.key, f]));
  const synthetic = rt.dataset.configFields.filter((f) => f.synthetic && f.status !== "SUPERSEDED");
  const intlWorkers = rt.dataset.workers.filter((w) => w.country !== "US" || w.internationalReview);
  const intlFields = merged.filter((f) => f.section === "International workforce");
  const open = registry.filter((r) => r.status !== "CONFIRMED").length;

  return (
    <>
      <PageHeader eyebrow="Finance bible" title="Complete the finance setup" description="What the CFO knows, does not know, and must have a professional confirm about the real company. Unknown stays unknown — never zero, never a guess." />
      <Grid cols={4} className="mb-5">
        <Stat label="Setup items open" value={open} sub={`${registry.length - open} of ${registry.length} confirmed`} tone={open ? "warn" : "ok"} />
        <Stat label="Bible fields" value={summary.total} sub={`${summary.CONFIRMED} confirmed · ${summary.UNCONFIRMED} unconfirmed · ${summary.PROFESSIONAL_REVIEW_REQUIRED} professional review`} />
        <Stat label="Blocked capabilities" value={Object.keys(blocked).length} sub="Capabilities waiting on setup answers" tone={Object.keys(blocked).length ? "warn" : "ok"} />
        <Stat label="International workers" value={intlWorkers.length} sub="Cross-border professional review" tone={intlWorkers.some((w) => w.internationalReview?.status !== "REVIEWED") ? "bad" : "ok"} />
      </Grid>

      <Tabs basePath="/company" active={tab} tabs={[{ key: "setup", label: "Setup checklist", count: open }, { key: "bible", label: "Finance bible (30 sections)" }, { key: "international", label: "International workforce review" }, { key: "synthetic", label: "Synthetic lab profile" }]} />

      {tab === "setup" ? (
        <div className="space-y-4">
          {!canEdit ? <AccessDenied permission="EDIT_CONFIG" role={actor.role} /> : null}
          {Array.from(bySection.entries()).map(([section, items]) => (
            <Card key={section} padded={false}>
              <CardHeader title={section} className="px-4 pt-3" subtitle={`${items.filter((i) => i.status === "CONFIRMED").length}/${items.length} confirmed`} />
              <div className="divide-y divide-line">
                {items.map((item) => {
                  const f = fieldByKey.get(item.fieldKey);
                  return (
                    <details key={item.key} className="group">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
                        <StatusPill status={item.status} />
                        <span className="min-w-0 flex-1 text-[13px] font-medium">{item.label}</span>
                        <span className="text-[11px] text-muted">
                          answer: <span className="mono">{item.whoCanAnswer}</span>
                        </span>
                        <span className="num text-[13px] text-muted">{f ? fieldValue(f.value) : "UNKNOWN"}</span>
                      </summary>
                      <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
                        <div className="space-y-2 text-[13px]">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Why it matters</div>
                            <p>{item.whyItMatters}</p>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Blocks</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.blocksCapabilities.map((c) => (
                                <Badge key={c} tone={blocked[c] ? "warn" : "ok"}>
                                  {c.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          {f?.note ? <p className="text-[12px] text-muted">{f.note}</p> : null}
                          {f?.updatedAt ? (
                            <p className="text-[11px] text-faint">
                              updated {fmtDateTime(f.updatedAt)} by {f.updatedBy ?? "—"}
                            </p>
                          ) : null}
                        </div>
                        {canEdit ? <AnswerFieldForm fieldKey={item.fieldKey} label={item.label} currentValue={f?.value ?? null} currentStatus={item.status} requiredConfirmer={item.whoCanAnswer} /> : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            </Card>
          ))}
          <Card>
            <CardHeader title="Capabilities currently blocked" subtitle="Each capability lists the setup items that must be answered before the CFO can rely on it." />
            {Object.keys(blocked).length === 0 ? (
              <EmptyState title="No capabilities blocked" />
            ) : (
              <TableWrap>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Waiting on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(blocked).map(([cap, keys]) => (
                      <tr key={cap}>
                        <td className="font-medium">{titleCase(cap)}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {keys.map((k) => (
                              <Badge key={k}>{k.replace(/_/g, " ")}</Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "bible" ? (
        <div className="space-y-3">
          {BIBLE_SECTIONS.map((section, idx) => {
            const fields = merged.filter((f) => f.section === section);
            const counts = summary.bySection[section];
            return (
              <Details key={section} summary={<span className="flex flex-wrap items-center gap-2"><span className="num w-6 text-faint">{idx + 1}.</span>{section}<span className="text-[11px] font-normal text-muted">{fields.length} fields{counts ? ` · ${counts.CONFIRMED} confirmed · ${counts.UNCONFIRMED} unconfirmed · ${counts.PROFESSIONAL_REVIEW_REQUIRED} review` : ""}</span></span>}>
                {section === "Month-end close checklist" ? <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-[13px]">{MONTH_END_CLOSE_STEPS.map((s, i) => <li key={i}>{String(s)}</li>)}</ol> : null}
                {section === "Year-end checklist" ? <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-[13px]">{YEAR_END_STEPS.map((s, i) => <li key={i}>{String(s)}</li>)}</ol> : null}
                {fields.length === 0 ? (
                  <p className="text-[13px] text-muted">No fields recorded for this section yet.</p>
                ) : (
                  <TableWrap className="border-0">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                          <th>Status</th>
                          <th>Confirmer</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f: ConfigField) => (
                          <tr key={f.key}>
                            <td>
                              <div>{f.label}</div>
                              <div className="mono text-faint">{f.key}</div>
                            </td>
                            <td className={f.value === null ? "text-muted" : "num"}>{fieldValue(f.value)}</td>
                            <td>
                              <StatusPill status={f.status} />
                            </td>
                            <td className="mono">{f.requiredConfirmer ?? "—"}</td>
                            <td className="max-w-[360px] text-muted">{f.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Details>
            );
          })}
        </div>
      ) : null}

      {tab === "international" ? (
        <div className="space-y-4">
          <Notice tone="bad" title="INCOMPLETE — CROSS-BORDER PROFESSIONAL REVIEW REQUIRED">
            Worker classification, withholding, permanent-establishment exposure and payment method for non-US workers are professional decisions. The CFO records the open questions and never decides them.
          </Notice>
          {intlWorkers.length === 0 ? <EmptyState title="No international workers in the dataset" /> : null}
          {intlWorkers.map((w) => (
            <Card key={w.id}>
              <CardHeader title={`${w.displayName} · ${w.roleTitle}`} subtitle={`${w.country} · ${w.workerType} · pay via ${w.payMethod ?? "UNKNOWN"}`} actions={<StatusPill status={w.internationalReview?.status ?? w.classificationStatus} />} />
              <div className="grid gap-4 md:grid-cols-2">
                <KeyValue
                  dense
                  items={[
                    { k: "Classification", v: <StatusPill status={w.classificationStatus} /> },
                    { k: "Compensation", v: `${w.compensation.amount} ${w.compensation.currency} / ${w.compensation.period.toLowerCase()} · basis ${w.compensation.basis} (${w.compensation.status})` },
                    { k: "Reviewer role", v: w.internationalReview?.reviewerRole ?? "CPA", mono: true },
                    { k: "Related party", v: w.relatedParty ? `yes — ${w.relatedPartyNote ?? ""}` : "no" },
                    { k: "Documents", v: w.documentIds.length ? w.documentIds.join(", ") : "none on file", mono: true },
                  ]}
                />
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Review fields (null = unknown)</div>
                  <TableWrap className="border-0">
                    <table className="tbl">
                      <tbody>
                        {(w.internationalReview?.fields ?? []).map((f) => (
                          <tr key={f.key}>
                            <td>{f.label}</td>
                            <td className={f.value === null ? "text-bad" : "num"}>{fieldValue(f.value)}</td>
                            <td>
                              <StatusPill status={f.status} />
                            </td>
                          </tr>
                        ))}
                        {!w.internationalReview?.fields?.length ? (
                          <tr>
                            <td className="text-muted" colSpan={3}>
                              No review fields attached to this worker.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </TableWrap>
                  {w.internationalReview?.notes?.length ? <ul className="mt-2 list-disc pl-5 text-[12px] text-muted">{w.internationalReview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
                </div>
              </div>
            </Card>
          ))}
          <Card>
            <CardHeader title="Bible: International workforce" subtitle="Real-company fields for the cross-border review." />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {intlFields.map((f) => (
                    <tr key={f.key}>
                      <td>
                        {f.label} <span className="mono text-faint">{f.key}</span>
                      </td>
                      <td className={f.value === null ? "text-bad" : ""}>{fieldValue(f.value)}</td>
                      <td>
                        <StatusPill status={f.status} />
                      </td>
                      <td className="max-w-[420px] text-muted">{f.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}

      {tab === "synthetic" ? (
        <div className="space-y-4">
          <Notice tone="warn" title="Synthetic lab profile">
            These fields describe <strong>{rt.dataset.profile.displayName}</strong>, the synthetic training company. They are labelled synthetic and are kept separate from the real finance bible above.
          </Notice>
          <Card>
            <KeyValue
              items={[
                { k: "Company", v: rt.dataset.profile.displayName },
                { k: "Synthetic", v: rt.dataset.profile.isSynthetic ? "yes" : "no" },
                { k: "Entity type", v: `${fieldValue(rt.dataset.profile.entityType.value)} (${rt.dataset.profile.entityType.status})` },
                { k: "Tax election", v: `${fieldValue(rt.dataset.profile.taxElection.value)} (${rt.dataset.profile.taxElection.status})` },
                { k: "State", v: `${fieldValue(rt.dataset.profile.state.value)} (${rt.dataset.profile.state.status})` },
                { k: "Fiscal year end", v: `${fieldValue(rt.dataset.profile.fiscalYearEnd.value)} (${rt.dataset.profile.fiscalYearEnd.status})` },
                { k: "Accounting method", v: `${fieldValue(rt.dataset.profile.accountingMethod.value)} (${rt.dataset.profile.accountingMethod.status})` },
                { k: "Functional currency", v: rt.dataset.profile.functionalCurrency },
                { k: "As of", v: rt.dataset.profile.asOfDate },
              ]}
            />
          </Card>
          <Card padded={false}>
            <CardHeader title={`Synthetic config fields (${synthetic.length})`} className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {synthetic.map((f) => (
                    <tr key={f.key}>
                      <td className="text-muted">{f.section}</td>
                      <td>
                        {f.label} <span className="mono text-faint">{f.key}</span>
                      </td>
                      <td className="num max-w-[360px] break-words">{fieldValue(f.value)}</td>
                      <td>
                        <StatusPill status={f.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}
    </>
  );
}
