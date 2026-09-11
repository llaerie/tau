import type { Metadata } from "next";
import Link from "next/link";
import { pageCtx } from "@/lib/ui/page";
import { cashPosition, cashLabel, hasBookData, CASH_UNKNOWN_LABEL, thirteenWeek, monthlyPnl, revenueMtd, arReport, nextPayroll, localAttentionQueue, localFinancialHealth, latestEvalSummaryFromDisk, evalSummaryOf, type AttentionItem, type HealthScorecard } from "@/lib/ui/data";
import { callOptional, loadEvalHarness, loadMonitors, loadWorkflows } from "@/lib/ui/optional";
import { fmtDate, fmtMoney, fmtMonth, fmtPercent, toNum } from "@/lib/ui/format";
import { PageHeader, Grid, Card, CardHeader, Stat, RiskChip, StatusPill, Sparkline, Bars, Money, EmptyState, ModuleNotice, Notice, TableWrap } from "@/components/ui";
import { normalizeAttention, normalizeHealth } from "@/lib/ui/normalize";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { rt, asOf } = await pageCtx();
  const cash = cashPosition(rt);
  const tw = thirteenWeek(rt);
  const pnl = monthlyPnl(rt, 12);
  const rev = revenueMtd(rt);
  const ar = arReport(rt).value;
  const pay = nextPayroll(rt);
  const pending = rt.dataset.approvals.filter((a) => a.status === "PENDING");

  const monitors = await callOptional<unknown>(() => loadMonitors(), "buildAttentionQueue", rt, asOf);
  const attention: AttentionItem[] = monitors.result ? normalizeAttention(monitors.result) : localAttentionQueue(rt);
  const health = await callOptional<unknown>(() => loadWorkflows(), "financialHealth", rt, asOf);
  const scorecard: HealthScorecard = health.result ? normalizeHealth(health.result, asOf) : localFinancialHealth(rt);
  const evalMod = await callOptional<unknown>(() => loadEvalHarness(), "loadLatestEvalRun");
  const evalRun = evalSummaryOf(evalMod.result) ?? latestEvalSummaryFromDisk();

  const lowestRow = tw.rows[tw.lowestCashWeek - 1] ?? tw.rows.find((r) => r.weekIndex === tw.lowestCashWeek);
  const ni = pnl.map((p) => toNum(p.netIncome));
  const redCount = attention.filter((a) => a.severity === "RED").length;
  const books = hasBookData(rt.dataset);
  const noAccounts = cash.accounts.length === 0;

  return (
    <>
      <PageHeader eyebrow={`As of ${fmtDate(asOf)}`} title="Overview" description={`${rt.dataset.profile.displayName} — cash, obligations, plan vs actual and the CFO's readiness at a glance.`} />

      <Grid cols={4}>
        <Stat label="Cash today" value={cashLabel(cash, cash.totalCash, fmtMoney)} sub={cash.known ? `${cash.accounts.filter((a) => a.kind === "BANK").length} bank accounts · cards owe ${fmtMoney(cash.cardBalances)}` : noAccounts ? "No bank accounts or cards registered — add them on Company setup" : "No posted entries — enter or import bank/card activity"} href={cash.known ? "/cash" : noAccounts ? "/company?tab=accounts" : "/transactions"} size="lg" tone={cash.known ? "neutral" : "warn"} />
        <Stat label="13-week lowest cash" value={cash.known ? fmtMoney(tw.lowestCash) : CASH_UNKNOWN_LABEL} sub={!cash.known ? "Opening cash unknown — no forecast" : lowestRow ? `Week ${tw.lowestCashWeek} starting ${fmtDate(lowestRow.weekStart)}${tw.minimumCash === null ? " · reserve policy not set" : tw.weeksBelowMinimum ? ` · ${tw.weeksBelowMinimum} wk below minimum` : ""}` : undefined} tone={!cash.known ? "warn" : toNum(tw.lowestCash) < 0 ? "bad" : tw.weeksBelowMinimum ? "warn" : "neutral"} href="/cash" size="lg" />
        <Stat label={`Revenue MTD · ${fmtMonth(rev.month)}`} value={books ? fmtMoney(rev.actual) : "—"} sub={!books ? "No posted entries yet" : rev.budget === null ? "No budget line for this month" : `Budget ${fmtMoney(rev.budget)} · variance ${fmtMoney(rev.variance)}`} tone={!books || rev.variance === null ? "neutral" : toNum(rev.variance) < 0 ? "warn" : "ok"} href="/budget" size="lg" />
        <Stat label="AR overdue" value={rt.dataset.invoices.length ? fmtMoney(ar.overdueTotal) : "—"} sub={rt.dataset.invoices.length ? `${ar.overdue.length} invoices · open AR ${fmtMoney(ar.total)}` : "No invoices recorded yet"} tone={toNum(ar.overdueTotal) > 0 ? "warn" : rt.dataset.invoices.length ? "ok" : "neutral"} href="/ar" size="lg" />
      </Grid>

      <Grid cols={4} className="mt-3">
        <Stat label="Next payroll" value={pay.date ? fmtDate(pay.date) : "Unknown"} sub={pay.expectedEmployerCost ? `≈ ${fmtMoney(pay.expectedEmployerCost)} employer cost (${pay.cadence.toLowerCase().replace("_", "-")})` : pay.basis} href="/payroll" />
        <Stat label="Open approvals" value={pending.length} sub={`${pending.filter((p) => p.risk.level === "RED").length} RED · ${pending.filter((p) => p.risk.level === "YELLOW").length} YELLOW`} tone={pending.length ? "warn" : "ok"} href="/approvals" />
        <Stat label="Attention items" value={attention.length} sub={`${redCount} red${monitors.result ? "" : " · computed locally"}`} tone={redCount ? "bad" : attention.length ? "warn" : "ok"} href="/cfo#attention" />
        <Stat label="Latest eval pass rate" value={evalRun ? fmtPercent(evalRun.passRate ?? null) : "No run yet"} sub={evalRun ? `${evalRun.passed ?? "?"}/${evalRun.total ?? "?"} cases · ${evalRun.ranAt ? fmtDate(String(evalRun.ranAt).slice(0, 10)) : ""}` : "Run evals from the Academy"} tone={evalRun ? ((evalRun.passRate ?? 0) >= 0.9 ? "ok" : "warn") : "neutral"} href="/academy" />
      </Grid>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Net income — trailing 12 months" subtitle="From posted journal entries; current month is month-to-date." actions={<Link href="/reports" className="text-[12px] text-accent">Reports →</Link>} />
          {!books ? (
            <EmptyState title="No posted entries yet — nothing to chart">
              Revenue, expenses and net income appear here once transactions are entered or imported and posted. Nothing is estimated.
            </EmptyState>
          ) : null}
          <div className={books ? "" : "hidden"}>
          <Sparkline values={ni} labels={pnl.map((p) => fmtMonth(p.month))} height={72} width={640} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Revenue</div>
              <Bars values={pnl.map((p) => ({ label: fmtMonth(p.month), value: toNum(p.revenue), tone: "accent" }))} height={32} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Expenses</div>
              <Bars values={pnl.map((p) => ({ label: fmtMonth(p.month), value: toNum(p.expenses), tone: "warn" }))} height={32} />
            </div>
            <div className="sm:col-span-2">
              <TableWrap maxHeight="128px">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="r">Revenue</th>
                      <th className="r">Net income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pnl].reverse().slice(0, 6).map((p) => (
                      <tr key={p.month}>
                        <td>{fmtMonth(p.month)}</td>
                        <td className="r">
                          <Money value={p.revenue} />
                        </td>
                        <td className="r">
                          <Money value={p.netIncome} colorize />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Financial health" subtitle={scorecard.source} actions={<RiskChip level={scorecard.overall === "UNKNOWN" ? null : scorecard.overall} />} />
          <ul className="divide-y divide-line">
            {scorecard.metrics.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px]">{m.label}</div>
                  <div className="truncate text-[11px] text-faint" title={m.note}>
                    {m.note}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="num text-[13px] font-medium">{m.value}</span>
                  <RiskChip level={m.status === "UNKNOWN" ? null : m.status} />
                </div>
              </li>
            ))}
          </ul>
          <ModuleNotice notice={health.notice} />
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cash by account" subtitle={cash.known ? `Ledger balances as of ${fmtDate(asOf)}` : `${CASH_UNKNOWN_LABEL} — no posted entries as of ${fmtDate(asOf)}`} />
          {noAccounts ? (
            <EmptyState title="No bank accounts or cards registered">
              <Link href="/company?tab=accounts" className="text-accent underline">Register them on Company setup</Link> (last four digits only), then enter or import transactions.
            </EmptyState>
          ) : null}
          <TableWrap className={noAccounts ? "hidden" : ""}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Institution</th>
                  <th>Type</th>
                  <th className="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                {cash.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name} <span className="mono text-faint">····{a.last4}</span>
                    </td>
                    <td className="text-muted">{a.institution}</td>
                    <td>
                      <StatusPill status={a.kind} label={a.kind === "BANK" ? "Bank" : "Card"} />
                    </td>
                    <td className="r">{cash.known ? <Money value={a.balance} currency={a.currency} colorize={a.kind === "BANK"} /> : <span className="text-warn">UNKNOWN</span>}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>Total cash (bank)</td>
                  <td className="r">{cash.known ? <Money value={cash.totalCash} /> : <span className="text-warn">{CASH_UNKNOWN_LABEL}</span>}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader title="Attention needed" subtitle={monitors.result ? "From proactive monitors" : "Computed locally (lib/monitors not yet available)"} actions={<Link href="/cfo#attention" className="text-[12px] text-accent">Open CFO →</Link>} />
          {attention.length === 0 ? (
            <EmptyState title="Nothing needs attention" />
          ) : (
            <ul className="divide-y divide-line">
              {attention.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2">
                  <RiskChip level={a.severity === "INFO" ? null : a.severity} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{a.href ? <Link href={a.href}>{a.title}</Link> : a.title}</div>
                    <div className="truncate text-[12px] text-muted">{a.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {monitors.notice ? <Notice className="mt-3" tone="info">{monitors.notice}</Notice> : null}
        </Card>
      </div>
    </>
  );
}
