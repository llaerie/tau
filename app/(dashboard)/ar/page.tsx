import type { Metadata } from "next";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { arReport, customerName, invoiceOpen } from "@/lib/ui/data";
import { AGING_BUCKETS } from "@/lib/finance/aging";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState, Details } from "@/components/ui";
import { fmtDate, fmtMoney, toNum } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Receivables" };
export const dynamic = "force-dynamic";

const TABS = ["invoices", "aging", "matching", "overdue"];

export default async function ArPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, asOf } = await pageCtx();
  const ds = rt.dataset;
  const report = arReport(rt);
  const aging = report.value;
  const invoices = [...ds.invoices].sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  const paymentsIn = [...ds.payments].filter((p) => p.direction === "IN").sort((a, b) => (a.date < b.date ? 1 : -1));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const unmatchedReceipts = ds.transactions.filter((t) => t.sourceKind === "BANK" && !t.amount.startsWith("-") && !t.flags.includes("TRANSFER") && !ds.payments.some((p) => p.transactionId === t.id) && !t.journalEntryId);
  const related = ds.customers.filter((c) => c.relatedParty);
  const company = ds.profile.displayName;

  return (
    <>
      <PageHeader title="Receivables" description="Invoices, aging, payment matching and overdue follow-up. Reminders are drafted for review only — the console never sends anything." />
      <Grid cols={4} className="mb-5">
        <Stat label="Open receivables" value={fmtMoney(aging.total)} sub={`${aging.items.length} open invoices`} />
        <Stat label="Overdue" value={fmtMoney(aging.overdueTotal)} sub={`${aging.overdue.length} invoices past due`} tone={toNum(aging.overdueTotal) > 0 ? "warn" : "ok"} />
        <Stat label="Customers" value={ds.customers.length} sub={related.length ? `${related.length} related party — disclosure required` : "no related parties"} tone={related.length ? "warn" : "neutral"} />
        <Stat label="Unmatched receipts" value={unmatchedReceipts.length} sub="Bank inflows without a payment application" tone={unmatchedReceipts.length ? "warn" : "ok"} />
      </Grid>
      <Tabs basePath="/ar" active={tab} tabs={[{ key: "invoices", label: "Invoices", count: invoices.length }, { key: "aging", label: "Aging" }, { key: "matching", label: "Matching", count: paymentsIn.length }, { key: "overdue", label: "Overdue & reminders", count: aging.overdue.length }]} />

      {tab === "invoices" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Service period</th>
                <th>Status</th>
                <th className="r">Total</th>
                <th className="r">Paid</th>
                <th className="r">Open</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const cust = ds.customers.find((c) => c.id === inv.customerId);
                const overdue = inv.status !== "PAID" && inv.status !== "VOID" && inv.dueDate < asOf && toNum(invoiceOpen(inv)) > 0;
                return (
                  <tr key={inv.id} className={overdue ? "hl" : ""}>
                    <td className="font-medium">{inv.number}</td>
                    <td>
                      {customerName(rt, inv.customerId)}
                      {cust?.relatedParty ? <Badge tone="warn" className="ml-1">related</Badge> : null}
                    </td>
                    <td>{fmtDate(inv.issueDate)}</td>
                    <td className={overdue ? "text-bad" : ""}>{fmtDate(inv.dueDate)}</td>
                    <td className="whitespace-nowrap text-muted">{inv.servicePeriodStart ? `${fmtDate(inv.servicePeriodStart)} – ${fmtDate(inv.servicePeriodEnd)}` : "—"}</td>
                    <td>
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="r">
                      <Money value={inv.total} currency={inv.currency} />
                    </td>
                    <td className="r">
                      <Money value={inv.amountPaid} currency={inv.currency} />
                    </td>
                    <td className="r font-medium">
                      <Money value={invoiceOpen(inv)} currency={inv.currency} />
                    </td>
                    <td className="text-[11px] text-muted">
                      {inv.journalEntryId ? "JE " : <span className="text-warn">no JE </span>}
                      {inv.documentId ? "📎 " : ""}
                      {inv.paymentIds.length ? `${inv.paymentIds.length} pmt` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "aging" ? (
        <div className="space-y-4">
          <Grid cols={6}>
            {AGING_BUCKETS.map((b) => (
              <Stat key={b} label={b === "CURRENT" ? "Current" : `${b} days`} value={fmtMoney(aging.buckets[b])} tone={b === "CURRENT" ? "neutral" : b === "90+" ? "bad" : "warn"} />
            ))}
            <Stat label="Total" value={fmtMoney(aging.total)} />
          </Grid>
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Customer</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="r">
                      {b}
                    </th>
                  ))}
                  <th className="r">Total</th>
                  <th className="r">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {aging.rows.map((r) => (
                  <tr key={r.counterpartyId}>
                    <td className="font-medium">{r.counterpartyName}</td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className="r">
                        {r.buckets[b] !== "0.0000" ? fmtMoney(r.buckets[b]) : ""}
                      </td>
                    ))}
                    <td className="r font-medium">
                      <Money value={r.total} />
                    </td>
                    <td className="r">{r.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mono text-[11px] text-muted">calc {report.id} · {report.formula}</p>
        </div>
      ) : null}

      {tab === "matching" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padded={false}>
            <CardHeader title="Payments received and their applications" className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th className="r">Amount</th>
                    <th>Applied to</th>
                    <th>Bank tx</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsIn.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td>
                      <td>{p.method}</td>
                      <td className="r">
                        <Money value={p.amount} currency={p.currency} />
                      </td>
                      <td>
                        {p.applications.map((a) => (
                          <div key={a.targetId} className="whitespace-nowrap">
                            {invoiceById.get(a.targetId)?.number ?? a.targetId} · {fmtMoney(a.amount)}
                          </div>
                        ))}
                        {p.applications.length === 0 ? <Badge tone="warn">unapplied</Badge> : null}
                      </td>
                      <td>{p.transactionId ? <Badge tone="ok">matched</Badge> : <Badge tone="warn">no bank match</Badge>}</td>
                    </tr>
                  ))}
                  {paymentsIn.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-muted">
                        No incoming payments.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card padded={false}>
            <CardHeader title="Bank inflows without a payment application" className="px-4 pt-3" subtitle="Candidates for ar.match_payment." />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="r">Amount</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedReceipts.slice(0, 40).map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.date)}</td>
                      <td className="max-w-[260px] truncate">{t.descriptionRaw}</td>
                      <td className="r">
                        <Money value={t.amount} />
                      </td>
                      <td>
                        <StatusPill status={t.category.status} />
                      </td>
                    </tr>
                  ))}
                  {unmatchedReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted">
                        Every inflow is matched.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}

      {tab === "overdue" ? (
        <div className="space-y-3">
          <Notice tone="warn" title="Drafts only — nothing is sent">Collection reminders are YELLOW actions (SEND_COLLECTION_REMINDER). The console shows the draft text so a human can copy, edit and send it; the CFO has no email or messaging integration.</Notice>
          {aging.overdue.length === 0 ? <EmptyState title="No overdue invoices" /> : null}
          {aging.overdue.map((it) => {
            const inv = invoiceById.get(it.id);
            const cust = ds.customers.find((c) => c.id === it.counterpartyId);
            const draft = `Subject: Friendly reminder — invoice ${it.number} (${fmtMoney(it.openAmount)}) past due\n\nHello ${it.counterpartyName},\n\nOur records show invoice ${it.number} issued ${fmtDate(it.issueDate)} for ${fmtMoney(it.total)} was due on ${fmtDate(it.dueDate)} and ${fmtMoney(it.openAmount)} remains open (${it.daysPastDue} days past due).\n\nIf payment has already been sent, thank you — please disregard this note. Otherwise, could you let us know when we can expect it?\n\nKind regards,\n${company}`;
            return (
              <Card key={it.id} padded={false}>
                <CardHeader title={`${it.number} · ${it.counterpartyName}`} className="px-4 pt-3" subtitle={`${it.daysPastDue} days past due · open ${fmtMoney(it.openAmount)} · bucket ${it.bucket}${cust?.relatedParty ? " · related party" : ""}`} actions={<Badge tone={it.daysPastDue > 60 ? "bad" : "warn"}>{it.bucket}</Badge>} />
                <div className="px-4 pb-3">
                  <Details summary="Draft reminder (not sent)">
                    <pre className="whitespace-pre-wrap font-sans text-[13px]">{draft}</pre>
                    {inv?.paymentIds.length ? <p className="mt-2 text-[11px] text-muted">Partial payments on file: {inv.paymentIds.length}</p> : null}
                  </Details>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
