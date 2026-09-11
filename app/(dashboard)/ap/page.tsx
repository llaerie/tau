import type { Metadata } from "next";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { apReport, cashPosition, vendorName } from "@/lib/ui/data";
import { AGING_BUCKETS } from "@/lib/finance/aging";
import { addDays, weekStart } from "@/lib/core/dates";
import { add, sub } from "@/lib/core/money";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ui/ActionButton";
import { fmtDate, fmtMoney, toNum, titleCase } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";

export const metadata: Metadata = { title: "Payables" };
export const dynamic = "force-dynamic";

const TABS = ["bills", "aging", "schedule", "vendors"];

export default async function ApPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor, asOf } = await pageCtx();
  const ds = rt.dataset;
  const aging = apReport(rt).value;
  const bills = [...ds.bills].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const openBills = bills.filter((b) => b.status !== "PAID" && b.status !== "VOID" && b.status !== "DUPLICATE").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const dupes = bills.filter((b) => b.status === "DUPLICATE" || b.duplicateOfId);
  const cash = cashPosition(rt);
  const canPropose = can(actor.role, "PROPOSE_ACTIONS");

  // Payment schedule recommendation: open bills by due week with running cash.
  const weeks = new Map<string, { weekStart: string; bills: typeof openBills; total: string }>();
  for (const b of openBills) {
    const ws = weekStart(b.dueDate < asOf ? asOf : b.dueDate);
    const cur = weeks.get(ws) ?? { weekStart: ws, bills: [], total: "0.0000" };
    cur.bills.push(b);
    cur.total = add(cur.total, sub(b.total, b.amountPaid));
    weeks.set(ws, cur);
  }
  const schedule = Array.from(weeks.values()).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  let running = cash.totalCash;

  return (
    <>
      <PageHeader title="Payables" description="Bills, aging, duplicate detection, a recommended payment schedule and vendor tax-document status. Payments are never executed in Phase One." />
      <Grid cols={4} className="mb-5">
        <Stat label="Open payables" value={fmtMoney(aging.total)} sub={`${aging.items.length} open bills`} />
        <Stat label="Overdue" value={fmtMoney(aging.overdueTotal)} sub={`${aging.overdue.length} bills past due`} tone={toNum(aging.overdueTotal) > 0 ? "warn" : "ok"} />
        <Stat label="Due in 14 days" value={fmtMoney(openBills.filter((b) => b.dueDate <= addDays(asOf, 14)).reduce((s, b) => add(s, sub(b.total, b.amountPaid)), "0.0000"))} sub="Recommended for the next payment run" />
        <Stat label="Duplicate flags" value={dupes.length} sub={`${ds.vendors.filter((v) => v.taxDocStatus === "UNKNOWN" || v.taxDocStatus === "REQUESTED").length} vendors missing W-9 status`} tone={dupes.length ? "bad" : "ok"} />
      </Grid>
      <Tabs basePath="/ap" active={tab} tabs={[{ key: "bills", label: "Bills", count: bills.length }, { key: "aging", label: "Aging" }, { key: "schedule", label: "Payment schedule" }, { key: "vendors", label: "Vendors", count: ds.vendors.length }]} />

      {tab === "bills" ? (
        <div className="space-y-3">
          <Notice tone="warn" title="Pay is intentionally blocked">Phase One has no payment rails. Pressing Pay proposes EXECUTE_PAYMENT through governance so the block is recorded in the audit log — the action is RED and prohibited, so it never executes, even if approved.</Notice>
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Vendor</th>
                  <th>Bill date</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="r">Total</th>
                  <th className="r">Open</th>
                  <th>Doc</th>
                  <th>Flags</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const open = sub(b.total, b.amountPaid);
                  const overdue = b.status !== "PAID" && b.dueDate < asOf;
                  return (
                    <tr key={b.id} className={b.status === "DUPLICATE" || b.duplicateOfId ? "hl-bad" : overdue ? "hl" : ""}>
                      <td>
                        <div className="font-medium">{b.number}</div>
                        <div className="max-w-[240px] truncate text-[11px] text-muted" title={b.description}>
                          {b.description}
                        </div>
                      </td>
                      <td>{vendorName(rt, b.vendorId)}</td>
                      <td>{fmtDate(b.billDate)}</td>
                      <td className={overdue ? "text-bad" : ""}>{fmtDate(b.dueDate)}</td>
                      <td>
                        <StatusPill status={b.status} />
                      </td>
                      <td className="r">
                        <Money value={b.total} currency={b.currency} />
                      </td>
                      <td className="r font-medium">
                        <Money value={open} currency={b.currency} />
                      </td>
                      <td>{b.documentId ? <span title={b.documentId}>📎</span> : <Badge tone="warn">no doc</Badge>}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {b.duplicateOfId ? <Badge tone="bad">dup of {b.duplicateOfId.slice(0, 10)}…</Badge> : null}
                          {b.approvalId ? <Badge tone="info">approval</Badge> : null}
                        </div>
                      </td>
                      <td>{b.status !== "PAID" && b.status !== "VOID" ? <ActionButton url="/api/ap/pay" body={{ billId: b.id }} variant="danger" disabled={!canPropose}>Pay (blocked)</ActionButton> : null}</td>
                    </tr>
                  );
                })}
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-muted">
                      No bills.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableWrap>
        </div>
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
                  <th>Vendor</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="r">
                      {b}
                    </th>
                  ))}
                  <th className="r">Total</th>
                  <th className="r">Bills</th>
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
          <p className="mono text-[11px] text-muted">calc {apReport(rt).id} · {apReport(rt).formula}</p>
        </div>
      ) : null}

      {tab === "schedule" ? (
        <div className="space-y-3">
          <Notice>Recommendation only. Bills are grouped by the week they fall due (overdue bills go into the current week) with running cash after each week, starting from today&apos;s bank cash of {fmtMoney(cash.totalCash)}. Receipts are not netted here — see the 13-week forecast for the full picture.</Notice>
          {schedule.length === 0 ? <EmptyState title="Nothing to schedule" /> : null}
          {schedule.map((w) => {
            running = sub(running, w.total);
            const after = running;
            return (
              <Card key={w.weekStart} padded={false}>
                <CardHeader title={`Week of ${fmtDate(w.weekStart)}`} className="px-4 pt-3" subtitle={`${w.bills.length} bills · ${fmtMoney(w.total)} · cash after ${fmtMoney(after)}`} actions={toNum(after) < 0 ? <Badge tone="bad">cash shortfall</Badge> : rt.thresholds.minimumCashReserve && toNum(after) < toNum(rt.thresholds.minimumCashReserve) ? <Badge tone="warn">below reserve</Badge> : <Badge tone="ok">fundable</Badge>} />
                <TableWrap className="border-0">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Bill</th>
                        <th>Vendor</th>
                        <th>Due</th>
                        <th>Status</th>
                        <th className="r">Open</th>
                        <th>Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.bills.map((b) => (
                        <tr key={b.id}>
                          <td>{b.number}</td>
                          <td>{vendorName(rt, b.vendorId)}</td>
                          <td className={b.dueDate < asOf ? "text-bad" : ""}>{fmtDate(b.dueDate)}</td>
                          <td>
                            <StatusPill status={b.status} />
                          </td>
                          <td className="r">
                            <Money value={sub(b.total, b.amountPaid)} />
                          </td>
                          <td className="text-muted">{b.dueDate < asOf ? "Pay immediately — overdue" : b.status === "DISPUTED" ? "Hold — disputed" : b.status === "RECEIVED" ? "Approve, then pay on due date" : "Pay on due date"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </Card>
            );
          })}
        </div>
      ) : null}

      {tab === "vendors" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Category</th>
                <th>Country</th>
                <th>Terms</th>
                <th>Recurring</th>
                <th>W-9 / tax doc</th>
                <th>Default account</th>
                <th>Approved by</th>
              </tr>
            </thead>
            <tbody>
              {[...ds.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => (
                <tr key={v.id} className={v.active ? "" : "opacity-60"}>
                  <td className="font-medium">
                    {v.name}
                    {!v.active ? <Badge className="ml-1">inactive</Badge> : null}
                  </td>
                  <td className="text-muted">{v.category ?? "—"}</td>
                  <td>{v.country}</td>
                  <td>{v.paymentTermsDays !== undefined ? `Net ${v.paymentTermsDays}` : "—"}</td>
                  <td>{v.isRecurring ? <Badge tone="info">recurring</Badge> : ""}</td>
                  <td>
                    <StatusPill status={v.taxDocStatus} label={titleCase(v.taxDocStatus)} />
                  </td>
                  <td className="text-muted">{v.defaultAccountId ? ds.accounts.find((a) => a.id === v.defaultAccountId)?.name ?? v.defaultAccountId : "—"}</td>
                  <td className="text-muted">{v.approvedBy ?? <span className="text-warn">not approved</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
    </>
  );
}
