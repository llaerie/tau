import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { isValidISODate } from "@/lib/core/dates";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, LinkButton, Notice } from "@/components/ui";
import { CpaPackagePanel } from "@/components/reports/CpaPackagePanel";
import { fmtDate, fmtMoney } from "@/lib/ui/format";
import type { StatementLine } from "@/lib/core/contracts";
import { hasBookData } from "@/lib/db/workspace";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const TABS = ["income", "balance", "cashflow", "cpa"];

function Lines({ rows }: { rows: StatementLine[] }) {
  return (
    <TableWrap className="border-0">
      <table className="tbl">
        <tbody>
          {rows.map((l, i) => (
            <tr key={`${l.label}-${i}`} className={l.isTotal ? "total" : ""}>
              <td style={{ paddingLeft: `${10 + Math.max(0, l.level - 1) * 16}px` }}>{l.label}</td>
              <td className="mono text-faint">{l.code ?? ""}</td>
              <td className="r">
                <Money value={l.amount} colorize={!l.isTotal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, asOf } = await pageCtx();
  const to = isValidISODate(sp(q.to)) ? sp(q.to) : asOf;
  const from = isValidISODate(sp(q.from)) && sp(q.from) <= to ? sp(q.from) : `${to.slice(0, 4)}-01-01`;
  const L = rt.ledger;
  const is = L.incomeStatement(from, to);
  const bs = L.balanceSheet(to);
  const cf = L.cashFlowStatement(from, to);
  const tb = L.trialBalance(to);
  const exp = (kind: string, format: "json" | "md") => `/api/reports/export?kind=${kind}&from=${from}&to=${to}&format=${format}`;

  return (
    <>
      <PageHeader title="Reports" description="Statements straight from the ledger with reconciliation badges, exportable as Markdown or JSON, plus the CPA package generator." />
      {!hasBookData(rt.dataset) ? (
        <Notice tone="warn" className="mb-4" title="No posted entries — these statements are empty, not zero">
          Nothing has been posted to the ledger, so every line below is structurally 0.00. Cash and balance-sheet figures are UNKNOWN until bank/card activity is entered or imported and opening balances are posted; do not read these as balances.
        </Notice>
      ) : null}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="text-[12px] text-muted">
          From
          <input type="date" name="from" defaultValue={from} className="input mt-1 w-40" />
        </label>
        <label className="text-[12px] text-muted">
          To
          <input type="date" name="to" defaultValue={to} className="input mt-1 w-40" />
        </label>
        <button className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Apply range</button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <LinkButton href={exp("all", "md")} size="sm">
            Export Markdown
          </LinkButton>
          <LinkButton href={exp("all", "json")} size="sm">
            Export JSON
          </LinkButton>
        </div>
      </form>
      <Grid cols={4} className="mb-5">
        <Stat label="Net income" value={fmtMoney(is.netIncome)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} tone={is.netIncome.startsWith("-") ? "bad" : "ok"} />
        <Stat label="Total assets" value={fmtMoney(bs.totalAssets)} sub={bs.balanced ? "Balance sheet balanced" : `Out of balance by ${fmtMoney(bs.difference)}`} tone={bs.balanced ? "ok" : "bad"} />
        <Stat label="Closing cash" value={fmtMoney(cf.closingCash)} sub={cf.reconciled ? "Cash flow reconciles to balance sheet" : `Unreconciled diff ${fmtMoney(cf.difference)}`} tone={cf.reconciled ? "ok" : "bad"} />
        <Stat label="Trial balance" value={tb.balanced ? "Balanced" : "Unbalanced"} sub={`Dr ${fmtMoney(tb.totalDebits)} · Cr ${fmtMoney(tb.totalCredits)}`} tone={tb.balanced ? "ok" : "bad"} />
      </Grid>
      <Tabs basePath="/reports" active={tab} preserve={{ from, to }} tabs={[{ key: "income", label: "Income statement" }, { key: "balance", label: "Balance sheet" }, { key: "cashflow", label: "Cash flow" }, { key: "cpa", label: "CPA package" }]} />

      {tab === "income" ? (
        <Card padded={false}>
          <CardHeader title={`Income statement · ${fmtDate(from)} – ${fmtDate(to)}`} className="px-4 pt-3" actions={<><LinkButton href={exp("income_statement", "md")} size="sm">MD</LinkButton><LinkButton href={exp("income_statement", "json")} size="sm">JSON</LinkButton></>} />
          <Lines rows={is.lines} />
          <div className="grid grid-cols-2 gap-2 px-4 py-3 text-[12px] sm:grid-cols-4">
            {[["Revenue", is.revenue], ["Gross profit", is.grossProfit], ["Operating income", is.operatingIncome], ["Net income", is.netIncome]].map(([l, v]) => (
              <div key={l}>
                <div className="text-muted">{l}</div>
                <div className="num font-semibold">{fmtMoney(v)}</div>
              </div>
            ))}
          </div>
          <p className="mono px-4 pb-3 text-[11px] text-faint">calcs {is.calcIds.join(", ") || "—"}</p>
        </Card>
      ) : null}

      {tab === "balance" ? (
        <Card padded={false}>
          <CardHeader title={`Balance sheet as of ${fmtDate(to)}`} className="px-4 pt-3" actions={<><StatusPill status={bs.balanced ? "BALANCED" : "UNBALANCED"} label={bs.balanced ? "balanced" : "out of balance"} /><LinkButton href={exp("balance_sheet", "md")} size="sm">MD</LinkButton><LinkButton href={exp("balance_sheet", "json")} size="sm">JSON</LinkButton></>} />
          <Lines rows={bs.lines} />
          <div className="grid grid-cols-2 gap-2 px-4 py-3 text-[12px] sm:grid-cols-4">
            {[["Total assets", bs.totalAssets], ["Total liabilities", bs.totalLiabilities], ["Total equity", bs.totalEquity], ["Current-year earnings", bs.currentYearEarnings]].map(([l, v]) => (
              <div key={l}>
                <div className="text-muted">{l}</div>
                <div className="num font-semibold">{fmtMoney(v)}</div>
              </div>
            ))}
          </div>
          {!bs.balanced ? <Notice tone="bad" className="m-4">Assets do not equal liabilities + equity (difference {fmtMoney(bs.difference)}). Run the integrity checks.</Notice> : null}
        </Card>
      ) : null}

      {tab === "cashflow" ? (
        <Card padded={false}>
          <CardHeader title={`Cash flow statement (indirect) · ${fmtDate(from)} – ${fmtDate(to)}`} className="px-4 pt-3" actions={<><StatusPill status={cf.reconciled ? "RECONCILED" : "UNRECONCILED"} label={cf.reconciled ? "reconciled" : "not reconciled"} /><LinkButton href={exp("cash_flow", "md")} size="sm">MD</LinkButton><LinkButton href={exp("cash_flow", "json")} size="sm">JSON</LinkButton></>} />
          <div className="px-4 pt-2 text-[13px]">
            Net income <span className="num font-semibold">{fmtMoney(cf.netIncome)}</span>
          </div>
          <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Operating adjustments</div>
          <Lines rows={cf.operatingAdjustments} />
          <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Investing</div>
          <Lines rows={cf.investingLines} />
          <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Financing</div>
          <Lines rows={cf.financingLines} />
          <div className="grid grid-cols-2 gap-2 px-4 py-3 text-[12px] sm:grid-cols-6">
            {[["Operating", cf.operating], ["Investing", cf.investing], ["Financing", cf.financing], ["Net change", cf.netChange], ["Opening cash", cf.openingCash], ["Closing cash", cf.closingCash]].map(([l, v]) => (
              <div key={l}>
                <div className="text-muted">{l}</div>
                <div className="num font-semibold">{fmtMoney(v)}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "cpa" ? <CpaPackagePanel from={from} to={to} /> : null}
    </>
  );
}
