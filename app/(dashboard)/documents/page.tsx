import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { missingDocumentAlerts } from "@/lib/documents/missing-documents";
import { matchReceiptsToTransactions } from "@/lib/documents/linking";
import { retentionFor } from "@/lib/documents/retention";
import { policyParameter, POLICY_KEYS } from "@/lib/knowledge/policies";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtPercent, titleCase } from "@/lib/ui/format";
import type { DocumentKind } from "@/lib/core/types";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const TABS = ["documents", "missing", "matching", "retention"];

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const kindFilter = sp(q.kind);
  const { rt } = await pageCtx();
  const ds = rt.dataset;
  const docs = [...ds.documents].sort((a, b) => (a.date < b.date ? 1 : -1));
  const kinds = Array.from(new Set(docs.map((d) => d.kind))).sort();
  const threshold = policyParameter<string>(rt.policies, POLICY_KEYS.EXPENSE_DOCUMENTATION, "receiptThreshold");
  const alerts = missingDocumentAlerts(ds, { receiptThreshold: threshold.status === "CONFIRMED" ? threshold.value : null });
  const proposals = matchReceiptsToTransactions(ds).sort((a, b) => b.confidence - a.confidence);
  const txById = new Map(ds.transactions.map((t) => [t.id, t]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const filtered = kindFilter ? docs.filter((d) => d.kind === kindFilter) : docs;
  const retentionKinds: DocumentKind[] = ["RECEIPT", "CUSTOMER_INVOICE", "VENDOR_BILL", "BANK_STATEMENT", "CARD_STATEMENT", "CONTRACT", "PAYROLL_REPORT", "TAX_NOTICE", "TAX_RETURN", "W9", "W8", "ENTITY_DOCUMENT", "INSURANCE", "CPA_CORRESPONDENCE", "OTHER"];

  return (
    <>
      <PageHeader title="Documents" description="Receipts, invoices, statements and entity documents with classification confidence, missing-document alerts, receipt-to-transaction matching proposals and retention status." />
      <Grid cols={4} className="mb-5">
        <Stat label="Documents" value={docs.length} sub={`${kinds.length} kinds · ${docs.filter((d) => d.isSynthetic).length} synthetic`} />
        <Stat label="Missing-document alerts" value={alerts.length} sub={`${alerts.filter((a) => a.severity === "HIGH").length} high · ${alerts.filter((a) => a.severity === "WARNING").length} warning`} tone={alerts.some((a) => a.severity === "HIGH") ? "bad" : alerts.length ? "warn" : "ok"} />
        <Stat label="Match proposals" value={proposals.length} sub={`${proposals.filter((p) => p.autoLinkEligible).length} auto-link eligible (≥ 80%)`} />
        <Stat label="Receipt threshold" value={threshold.value ? fmtMoney(threshold.value) : "Unknown"} sub={`${threshold.status} — ${threshold.status === "CONFIRMED" ? "policy" : "default, owner to confirm"}`} tone={threshold.status === "CONFIRMED" ? "ok" : "warn"} />
      </Grid>
      <Tabs basePath="/documents" active={tab} tabs={[{ key: "documents", label: "All documents", count: docs.length }, { key: "missing", label: "Missing documents", count: alerts.length }, { key: "matching", label: "Receipt matching", count: proposals.length }, { key: "retention", label: "Retention" }]} />

      {tab === "documents" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <a href="/documents?tab=documents" className={`rounded-full border px-2.5 py-0.5 text-[12px] ${!kindFilter ? "border-accent bg-accent-soft text-accent" : "border-line-strong"}`}>
              All ({docs.length})
            </a>
            {kinds.map((k) => (
              <a key={k} href={`/documents?tab=documents&kind=${k}`} className={`rounded-full border px-2.5 py-0.5 text-[12px] ${kindFilter === k ? "border-accent bg-accent-soft text-accent" : "border-line-strong"}`}>
                {titleCase(k)} ({docs.filter((d) => d.kind === k).length})
              </a>
            ))}
          </div>
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Title</th>
                  <th className="r">Amount</th>
                  <th className="r">Confidence</th>
                  <th>Links</th>
                  <th>Retention</th>
                  <th>Storage</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{fmtDate(d.date)}</td>
                    <td>
                      <Badge>{d.kind.replace(/_/g, " ")}</Badge>
                    </td>
                    <td>
                      <div className="max-w-[320px] truncate font-medium" title={d.title}>
                        {d.title}
                      </div>
                      <div className="mono text-faint">{d.id}</div>
                    </td>
                    <td className="r">{d.amount ? <Money value={d.amount} currency={d.currency} /> : ""}</td>
                    <td className={`r ${d.classificationConfidence < 0.7 ? "text-warn" : ""}`}>{fmtPercent(d.classificationConfidence, 0)}</td>
                    <td className="text-[11px] text-muted">
                      {d.linkedTransactionIds.length ? `${d.linkedTransactionIds.length} tx ` : ""}
                      {d.linkedJournalEntryIds.length ? `${d.linkedJournalEntryIds.length} JE` : ""}
                      {!d.linkedTransactionIds.length && !d.linkedJournalEntryIds.length ? <Badge tone="warn">unlinked</Badge> : null}
                    </td>
                    <td className="text-[11px] text-muted">{d.retention.retainUntil ? `until ${fmtDate(d.retention.retainUntil)}` : "indefinite"}</td>
                    <td className="mono text-[11px] text-faint">{d.storagePath.startsWith("synthetic://") ? "synthetic" : d.storagePath}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {filtered.length > 300 ? <Notice>Showing 300 of {filtered.length}. Filter by kind to narrow.</Notice> : null}
        </div>
      ) : null}

      {tab === "missing" ? (
        <div className="space-y-3">
          {threshold.status !== "CONFIRMED" ? <Notice tone="warn" title="Receipt threshold unconfirmed">Per-transaction receipt checks are skipped until the owner confirms the receipt threshold policy; a config alert is raised instead.</Notice> : null}
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Kind</th>
                  <th>Target</th>
                  <th>Message</th>
                  <th className="r">Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className={a.severity === "HIGH" ? "hl-bad" : ""}>
                    <td>
                      <StatusPill status={a.severity} />
                    </td>
                    <td className="mono text-[11px]">{a.kind}</td>
                    <td className="text-[11px] text-muted">
                      {a.targetType} <span className="mono">{a.targetId}</span>
                    </td>
                    <td className="max-w-[480px]">{a.message}</td>
                    <td className="r">{a.amount ? <Money value={a.amount} /> : ""}</td>
                    <td>{a.date ? fmtDate(a.date) : ""}</td>
                  </tr>
                ))}
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted">
                      No missing-document alerts.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : null}

      {tab === "matching" ? (
        <div className="space-y-3">
          <Notice>Proposals score amount, date proximity and vendor name. Links at or above 80% are auto-link eligible; everything else is a suggestion for a human. Applying links is a governed bookkeeping action.</Notice>
          {proposals.length === 0 ? <EmptyState title="No unmatched receipts" /> : null}
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Transaction</th>
                  <th className="r">Confidence</th>
                  <th>Reasons</th>
                  <th>Eligible</th>
                </tr>
              </thead>
              <tbody>
                {proposals.slice(0, 200).map((p) => {
                  const d = docById.get(p.documentId);
                  const t = txById.get(p.transactionId);
                  return (
                    <tr key={`${p.documentId}-${p.transactionId}`}>
                      <td>
                        <div className="max-w-[260px] truncate">{d?.title ?? p.documentId}</div>
                        <div className="text-[11px] text-muted">
                          {d ? `${fmtDate(d.date)} · ${d.amount ? fmtMoney(d.amount) : ""}` : ""}
                        </div>
                      </td>
                      <td>
                        <div className="max-w-[260px] truncate">{t?.descriptionRaw ?? p.transactionId}</div>
                        <div className="text-[11px] text-muted">{t ? `${fmtDate(t.date)} · ${fmtMoney(t.amount)}` : ""}</div>
                      </td>
                      <td className="r">{fmtPercent(p.confidence, 0)}</td>
                      <td className="text-[11px] text-muted">{p.reasons.join("; ")}</td>
                      <td>{p.autoLinkEligible ? <Badge tone="ok">auto-link</Badge> : <Badge tone="warn">review</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : null}

      {tab === "retention" ? (
        <Card padded={false}>
          <CardHeader title="Retention policy by document kind" className="px-4 pt-3" subtitle="Defaults are UNCONFIRMED until the CPA confirms them; they are not asserted as law." />
          <TableWrap className="border-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className="r">Documents</th>
                  <th>Years</th>
                  <th>Permanent</th>
                  <th>Basis</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {retentionKinds.map((k) => {
                  const r = retentionFor(k, rt.policies, rt.asOfDate);
                  return (
                    <tr key={k}>
                      <td className="font-medium">{titleCase(k)}</td>
                      <td className="r">{docs.filter((d) => d.kind === k).length}</td>
                      <td>{r.permanent ? "—" : r.years ?? "unknown"}</td>
                      <td>{r.permanent ? "yes" : "no"}</td>
                      <td>
                        <StatusPill status={r.basis} />
                      </td>
                      <td className="max-w-[420px] text-[11px] text-muted">{r.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <p className="px-4 py-2 text-[11px] text-faint">Policy {POLICY_KEYS.DOCUMENT_RETENTION} · last computed {fmtDateTime(new Date().toISOString())}</p>
        </Card>
      ) : null}
    </>
  );
}
