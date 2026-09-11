import type { Metadata } from "next";
import { pageCtx, type SearchParams } from "@/lib/ui/page";
import { nextPayroll } from "@/lib/ui/data";
import { redactForRole, REDACTED } from "@/lib/security/redaction";
import { detectPayrollCadence, projectPayDates } from "@/lib/forecasting/drivers";
import { addDays } from "@/lib/core/dates";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState, Details } from "@/components/ui";
import { EmployerCostCalculator } from "@/components/payroll/EmployerCostCalculator";
import { fmtDate, fmtMoney, titleCase } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";
import type { PayrollRun, Worker } from "@/lib/core/types";

export const metadata: Metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

const TABS = ["calendar", "runs", "liabilities", "workers", "calculator"];

function money(v: string): string {
  return v === REDACTED ? REDACTED : fmtMoney(v);
}

export default async function PayrollPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor, asOf } = await pageCtx();
  const ds = rt.dataset;
  const detail = can(actor.role, "VIEW_PAYROLL_DETAIL");
  const runs = redactForRole([...ds.payrollRuns].sort((a, b) => (a.payDate < b.payDate ? 1 : -1)), actor.role) as PayrollRun[];
  const workers = redactForRole(ds.workers, actor.role) as Worker[];
  const liabilities = [...ds.payrollLiabilities].sort((a, b) => (a.accruedDate < b.accruedDate ? 1 : -1));
  const pattern = detectPayrollCadence(ds.payrollRuns);
  const upcoming = projectPayDates(pattern, asOf, addDays(asOf, 120));
  const next = nextPayroll(rt);
  const openLiab = liabilities.filter((l) => l.status !== "PAID");
  const openLiabTotal = openLiab.reduce((s, l) => s + Number(l.amount), 0);
  const unresolved = workers.filter((w) => w.classificationStatus !== "CONFIRMED" || w.workerType === "UNRESOLVED");
  const workerName = (id: string) => workers.find((w) => w.id === id)?.displayName ?? id;
  const acctName = (id: string) => ds.accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Payroll & workforce" description="Payroll is executed by the provider with human authorization — never by the CFO. The console monitors runs, liabilities, cadence and worker classification." />
      {!detail ? <Notice tone="warn" className="mb-4" title="Per-worker payroll amounts are redacted for your role">Totals remain visible. Roles with VIEW_PAYROLL_DETAIL (owner, CPA, auditor) see line detail.</Notice> : null}
      <Grid cols={4} className="mb-5">
        <Stat label="Next pay date" value={next.date ? fmtDate(next.date) : "Unknown"} sub={`${titleCase(pattern.cadence)} cadence · last ${pattern.lastPayDate ?? "—"}`} />
        <Stat label="Expected employer cost" value={next.expectedEmployerCost ? fmtMoney(next.expectedEmployerCost) : "—"} sub={next.basis} />
        <Stat label="Open payroll liabilities" value={openLiab.length ? fmtMoney(openLiabTotal) : "None accrued"} sub={openLiab.length ? `${openLiab.length} accrued · ${openLiab.filter((l) => l.dueDate === null).length} with unknown due date` : ds.payrollRuns.length ? "No open liabilities" : "No payroll runs recorded — nothing accrued"} tone={openLiab.some((l) => l.dueDate === null) ? "warn" : "neutral"} />
        <Stat label="Workers" value={workers.length} sub={`${workers.filter((w) => w.workerType === "EMPLOYEE").length} employees · ${workers.filter((w) => w.workerType === "CONTRACTOR").length} contractors · ${unresolved.length} unresolved`} tone={unresolved.length ? "bad" : "ok"} />
      </Grid>
      <Tabs basePath="/payroll" active={tab} tabs={[{ key: "calendar", label: "Calendar" }, { key: "runs", label: "Runs", count: runs.length }, { key: "liabilities", label: "Liabilities", count: openLiab.length }, { key: "workers", label: "Workers", count: workers.length }, { key: "calculator", label: "Employer cost calculator" }]} />

      {tab === "calendar" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padded={false}>
            <CardHeader title="Projected pay dates (next 120 days)" className="px-4 pt-3" subtitle={`Pattern: ${titleCase(pattern.cadence)} · pay days of month ${pattern.payDaysOfMonth.join(", ") || "—"} · avg gap ${pattern.averageGapDays ?? "—"} days`} />
            {upcoming.length === 0 ? (
              <EmptyState title="Cadence unknown" className="m-3">
                Not enough payroll history to project dates.
              </EmptyState>
            ) : (
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Pay date</th>
                      <th className="r">Projected net pay</th>
                      <th className="r">Projected employer cost</th>
                      <th>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((d) => (
                      <tr key={d}>
                        <td>{fmtDate(d)}</td>
                        <td className="r">
                          <Money value={next.expectedNetPay} />
                        </td>
                        <td className="r">
                          <Money value={next.expectedEmployerCost} />
                        </td>
                        <td>
                          <Badge tone="warn">assumed = last run</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card padded={false}>
            <CardHeader title="Recent pay dates" className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pay date</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th className="r">Net pay</th>
                    <th className="r">Employer cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.payDate)}</td>
                      <td className="whitespace-nowrap text-muted">
                        {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td className="r">{money(r.totals.netPay)}</td>
                      <td className="r">{money(r.totals.totalEmployerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
      ) : null}

      {tab === "runs" ? (
        <div className="space-y-2">
          {runs.map((r) => (
            <details key={r.id} className="group rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
                <span className="w-24">{fmtDate(r.payDate)}</span>
                <span className="text-muted">
                  {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
                </span>
                <StatusPill status={r.status} />
                {r.reconciliation ? <StatusPill status={r.reconciliation.status} /> : null}
                <span className="ml-auto num">gross {money(r.totals.gross)}</span>
                <span className="num">net {money(r.totals.netPay)}</span>
                <span className="num font-medium">employer cost {money(r.totals.totalEmployerCost)}</span>
              </summary>
              <div className="border-t border-line px-4 py-3">
                <div className="scroll-x">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th className="r">Gross</th>
                        <th className="r">Fed WH</th>
                        <th className="r">State WH</th>
                        <th className="r">SS (ee)</th>
                        <th className="r">Medicare (ee)</th>
                        <th className="r">SDI</th>
                        <th className="r">Net</th>
                        <th className="r">Employer taxes</th>
                        <th className="r">Total cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.lines.map((l) => (
                        <tr key={l.workerId}>
                          <td>{workerName(l.workerId)}</td>
                          <td className="r">{money(l.gross)}</td>
                          <td className="r">{money(l.federalIncomeTaxWithheld)}</td>
                          <td className="r">{money(l.stateIncomeTaxWithheld)}</td>
                          <td className="r">{money(l.socialSecurityEmployee)}</td>
                          <td className="r">{money(l.medicareEmployee)}</td>
                          <td className="r">{money(l.stateDisabilityEmployee)}</td>
                          <td className="r font-medium">{money(l.netPay)}</td>
                          <td className="r">{l.socialSecurityEmployer === REDACTED ? REDACTED : fmtMoney(String(Number(l.socialSecurityEmployer) + Number(l.medicareEmployer) + Number(l.federalUnemploymentEmployer) + Number(l.stateUnemploymentEmployer) + Number(l.stateTrainingTaxEmployer)))}</td>
                          <td className="r font-medium">{money(l.totalEmployerCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                  <span>
                    id <span className="mono">{r.id}</span>
                  </span>
                  {r.providerRef ? <span>provider ref {r.providerRef}</span> : null}
                  {r.journalEntryId ? (
                    <span>
                      journal <span className="mono">{r.journalEntryId}</span>
                    </span>
                  ) : (
                    <span className="text-warn">not yet posted to ledger</span>
                  )}
                  {r.rateAssumptionSetId ? <span>rate set {r.rateAssumptionSetId} (synthetic, not authoritative)</span> : null}
                  {r.reconciliation?.varianceAmount ? <span className="text-bad">variance {fmtMoney(r.reconciliation.varianceAmount)}</span> : null}
                  {r.reconciliation?.notes?.map((n, i) => (
                    <span key={i}>{n}</span>
                  ))}
                </div>
              </div>
            </details>
          ))}
          {runs.length === 0 ? <EmptyState title="No payroll runs" /> : null}
        </div>
      ) : null}

      {tab === "liabilities" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Run</th>
                <th>Accrued</th>
                <th>Due</th>
                <th>Status</th>
                <th className="r">Amount</th>
                <th>GL account</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id} className={l.status !== "PAID" && l.dueDate === null ? "hl" : ""}>
                  <td>{titleCase(l.kind)}</td>
                  <td className="mono text-muted">{l.payrollRunId.slice(0, 18)}</td>
                  <td>{fmtDate(l.accruedDate)}</td>
                  <td>{l.dueDate ? fmtDate(l.dueDate) : <span className="text-warn">Pending authoritative source + CPA confirmation</span>}</td>
                  <td>
                    <StatusPill status={l.status} />
                  </td>
                  <td className="r">
                    <Money value={l.amount} currency={l.currency} />
                  </td>
                  <td className="text-muted">{acctName(l.glAccountId)}</td>
                </tr>
              ))}
              {liabilities.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted">
                    No payroll liabilities.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "workers" ? (
        <div className="space-y-4">
          {unresolved.length ? <Notice tone="bad" title="Worker classification is a professional decision">{unresolved.length} worker(s) are UNRESOLVED. The CFO flags them and records the open questions; it never decides employee vs contractor status or cross-border treatment.</Notice> : null}
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Role</th>
                  <th>Country</th>
                  <th>Type</th>
                  <th>Classification</th>
                  <th>Compensation</th>
                  <th>Pay method</th>
                  <th>International review</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id} className={w.classificationStatus !== "CONFIRMED" ? "hl" : ""}>
                    <td className="font-medium">{w.displayName}</td>
                    <td className="text-muted">{w.roleTitle}</td>
                    <td>{w.country}</td>
                    <td>
                      <StatusPill status={w.workerType} />
                    </td>
                    <td>
                      <StatusPill status={w.classificationStatus} label={w.classificationStatus === "CONFIRMED" ? "confirmed" : "professional review"} />
                    </td>
                    <td className="num">
                      {w.compensation.amount === REDACTED ? REDACTED : `${fmtMoney(w.compensation.amount, w.compensation.currency)} / ${w.compensation.period.toLowerCase()}`} <span className="text-[11px] text-muted">{w.compensation.basis}</span>
                    </td>
                    <td className="text-muted">{titleCase(w.payMethod ?? "UNKNOWN")}</td>
                    <td>{w.internationalReview ? <StatusPill status={w.internationalReview.status} label={w.internationalReview.status === "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED" ? "INCOMPLETE — review required" : w.internationalReview.status} /> : <span className="text-faint">n/a</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {w.isOwner ? <Badge tone="info">owner</Badge> : null}
                        {w.relatedParty ? <Badge tone="warn">related party</Badge> : null}
                        {w.endDate ? <Badge>ended {w.endDate}</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {workers.filter((w) => w.internationalReview).map((w) => (
            <Details key={w.id} summary={`International review — ${w.displayName} (${w.country})`}>
              <Notice tone="bad" className="mb-2">INCOMPLETE — CROSS-BORDER PROFESSIONAL REVIEW REQUIRED · reviewer role {w.internationalReview?.reviewerRole}</Notice>
              <ul className="space-y-1 text-[13px]">
                {w.internationalReview?.fields.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-2">
                    <StatusPill status={f.status} />
                    <span>{f.label}</span>
                    <span className={f.value === null ? "text-bad" : "num"}>{f.value === null ? "null (unknown)" : String(f.value)}</span>
                    {f.note ? <span className="text-[11px] text-muted">{f.note}</span> : null}
                  </li>
                ))}
              </ul>
            </Details>
          ))}
        </div>
      ) : null}

      {tab === "calculator" ? <EmployerCostCalculator canUse={can(actor.role, "VIEW_FINANCIALS")} /> : null}
    </>
  );
}
