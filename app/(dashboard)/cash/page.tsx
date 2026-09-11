import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { cashPosition, thirteenWeek, runwayInfo, decimalOrNull } from "@/lib/ui/data";
import { PageHeader, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, KeyValue, Details, Sparkline } from "@/components/ui";
import { fmtDate, fmtMoney, fmtPercent, toNum, titleCase } from "@/lib/ui/format";
import { isValidISODate } from "@/lib/core/dates";
import type { FlowCategory } from "@/lib/forecasting/drivers";

export const metadata: Metadata = { title: "Cash" };
export const dynamic = "force-dynamic";

const CATEGORIES: FlowCategory[] = ["PAYROLL", "PAYROLL_TAX", "AP", "RENT", "SOFTWARE", "TAX", "DISTRIBUTION", "TRANSFER", "OTHER"];

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const { rt, asOf } = await pageCtx();
  const delayDays = Math.max(0, Math.min(365, Number(sp(q.delay, "0")) || 0));
  const haircut = Math.max(0, Math.min(100, Number(sp(q.haircut, "0")) || 0)) / 100;
  const extraAmount = decimalOrNull(sp(q.extra));
  const extraDate = isValidISODate(sp(q.extraDate)) ? sp(q.extraDate) : undefined;
  const scenarioActive = delayDays > 0 || haircut > 0 || (extraAmount && extraAmount !== "0.0000");

  const cash = cashPosition(rt);
  const base = thirteenWeek(rt);
  const fc = scenarioActive ? thirteenWeek(rt, { delayDays, receiptHaircut: haircut, extraDisbursement: extraAmount && extraAmount !== "0.0000" ? { amount: extraAmount, date: extraDate, label: "Scenario: extra disbursement" } : undefined }) : base;
  const rw = runwayInfo(rt);
  const reservePolicy = rt.thresholds.minimumCashReserve;
  const usedCategories = CATEGORIES.filter((c) => fc.rows.some((r) => r.disbursementsByCategory[c] && r.disbursementsByCategory[c] !== "0.0000"));

  return (
    <>
      <PageHeader eyebrow={`As of ${fmtDate(asOf)}`} title="Cash" description="Cash position, the 13-week forecast built from open invoices, bills, payroll cadence and recurring vendors, plus runway and reserve policy." />
      <Grid cols={4} className="mb-5">
        <Stat label="Cash today" value={fmtMoney(cash.totalCash)} sub={`${cash.accounts.filter((a) => a.kind === "BANK").length} accounts`} size="lg" />
        <Stat label="Lowest 13-week cash" value={fmtMoney(fc.lowestCash)} sub={`Week ${fc.lowestCashWeek} · ${fmtDate(fc.lowestCashWeekStart)}${scenarioActive ? ` · base ${fmtMoney(base.lowestCash)}` : ""}`} tone={toNum(fc.lowestCash) < 0 ? "bad" : fc.weeksBelowMinimum ? "warn" : "ok"} size="lg" />
        <Stat label="Monthly burn (3-mo avg)" value={rw.burn.value === null ? "—" : fmtMoney(rw.burn.value)} sub={rw.burn.value !== null && toNum(rw.burn.value) <= 0 ? "Net cash generation" : rw.burn.notes?.[0] ?? rw.burn.formula} tone={rw.burn.value !== null && toNum(rw.burn.value) > 0 ? "warn" : "ok"} />
        <Stat label="Runway" value={rw.runway.value === null ? (rw.burn.value !== null && toNum(rw.burn.value) <= 0 ? "Unbounded" : "—") : `${rw.runway.value.toFixed(1)} mo`} sub={rw.runway.notes?.[0] ?? rw.runway.formula} tone={rw.runway.value === null ? "ok" : rw.runway.value < 3 ? "bad" : rw.runway.value < 6 ? "warn" : "ok"} />
      </Grid>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <CardHeader title="Cash position by account" className="px-4 pt-3" />
          <TableWrap className="border-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Institution</th>
                  <th>Kind</th>
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
                    <td>{a.kind === "BANK" ? "Bank" : "Card liability"}</td>
                    <td className="r">
                      <Money value={a.balance} currency={a.currency} />
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>Total bank cash</td>
                  <td className="r">
                    <Money value={cash.totalCash} />
                  </td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Reserve policy" actions={<StatusPill status={reservePolicy === null ? "POLICY_NOT_SET" : rt.thresholds.status} label={reservePolicy === null ? "policy not set" : rt.thresholds.status} />} />
          {reservePolicy === null ? (
            <Notice tone="warn" title="Minimum cash reserve: policy not set">
              The company has not confirmed a reserve policy, so the forecast cannot flag weeks below minimum. Set it under Settings → Materiality or Company setup.
            </Notice>
          ) : (
            <KeyValue
              items={[
                { k: "Minimum reserve", v: fmtMoney(reservePolicy) },
                { k: "Cash vs policy", v: rw.reserve.value ? `${fmtMoney(rw.reserve.value.surplus)} surplus` : "—" },
                { k: "Coverage", v: rw.reserve.value?.coverageRatio ? `${rw.reserve.value.coverageRatio.toFixed(2)}×` : "—" },
                { k: "Weeks below minimum", v: fc.weeksBelowMinimum ?? "—" },
              ]}
            />
          )}
          <div className="mt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Closing cash by week</div>
            <Sparkline values={fc.rows.map((r) => toNum(r.closingCash))} labels={fc.rows.map((r) => `W${r.weekIndex} ${r.weekStart}`)} height={56} width={300} />
          </div>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader title="Scenario controls" subtitle="Recompute the 13-week forecast with delayed receipts or a stress test. Scenarios are labelled UNCONFIRMED assumptions; nothing is stored." actions={scenarioActive ? <a href="/cash" className="text-[12px] text-accent">Reset to base</a> : null} />
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="text-[12px] text-muted">
            Delay all receipts (days)
            <input type="number" name="delay" min={0} max={365} defaultValue={delayDays} className="input mt-1" />
          </label>
          <label className="text-[12px] text-muted">
            Receipt haircut (%)
            <input type="number" name="haircut" min={0} max={100} defaultValue={Math.round(haircut * 100)} className="input mt-1" />
          </label>
          <label className="text-[12px] text-muted">
            Extra disbursement ($)
            <input type="number" name="extra" min={0} step="0.01" defaultValue={extraAmount && extraAmount !== "0.0000" ? Number(extraAmount).toFixed(2) : ""} className="input mt-1" />
          </label>
          <label className="text-[12px] text-muted">
            Disbursement date
            <input type="date" name="extraDate" defaultValue={extraDate ?? ""} className="input mt-1" />
          </label>
          <div className="flex items-end">
            <button className="inline-flex h-8 w-full items-center justify-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg">Recompute</button>
          </div>
        </form>
        {scenarioActive ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {fc.assumptions
              .filter((a) => a.key.startsWith("scenario:"))
              .map((a) => (
                <Badge key={a.key} tone="warn">
                  {a.description}
                </Badge>
              ))}
          </div>
        ) : null}
      </Card>

      <Card padded={false} className="mb-5">
        <CardHeader title={`13-week cash forecast${scenarioActive ? " — scenario" : ""}`} subtitle={`Opening cash ${fmtMoney(fc.openingCash)} · receipts ${fmtMoney(fc.totalReceipts)} · disbursements ${fmtMoney(fc.totalDisbursements)} · ending ${fmtMoney(fc.endingCash)}`} className="px-4 pt-3" />
        <TableWrap className="border-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>Week</th>
                <th>Starts</th>
                <th className="r">Opening</th>
                <th className="r">Receipts</th>
                <th className="r text-ok">confirmed</th>
                <th className="r">expected</th>
                <th className="r text-muted">assumed</th>
                {usedCategories.map((c) => (
                  <th key={c} className="r">
                    {titleCase(c)}
                  </th>
                ))}
                <th className="r">Disbursements</th>
                <th className="r">Net</th>
                <th className="r">Closing</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {fc.rows.map((r) => {
                const lowest = r.weekIndex === fc.lowestCashWeek;
                const cls = toNum(r.closingCash) < 0 ? "hl-bad" : lowest ? "hl" : "";
                return (
                  <tr key={r.weekIndex} className={cls}>
                    <td className="mono">W{r.weekIndex}</td>
                    <td className="whitespace-nowrap">{fmtDate(r.weekStart)}</td>
                    <td className="r">
                      <Money value={r.openingCash} />
                    </td>
                    <td className="r font-medium">
                      <Money value={r.receipts} />
                    </td>
                    <td className="r">
                      <Money value={r.receiptsByConfidence.CONFIRMED} />
                    </td>
                    <td className="r">
                      <Money value={r.receiptsByConfidence.EXPECTED} />
                    </td>
                    <td className="r text-muted">
                      <Money value={r.receiptsByConfidence.ASSUMED} />
                    </td>
                    {usedCategories.map((c) => (
                      <td key={c} className="r text-muted">
                        {r.disbursementsByCategory[c] && r.disbursementsByCategory[c] !== "0.0000" ? fmtMoney(r.disbursementsByCategory[c]) : ""}
                      </td>
                    ))}
                    <td className="r font-medium">
                      <Money value={r.disbursements} />
                    </td>
                    <td className="r">
                      <Money value={r.net} colorize />
                    </td>
                    <td className="r font-semibold">
                      <Money value={r.closingCash} colorize />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {lowest ? <Badge tone="warn">lowest</Badge> : null}
                        {r.belowMinimum ? <Badge tone="bad">below min</Badge> : null}
                        {r.overdueFlowIds.length ? <Badge tone="info">{r.overdueFlowIds.length} overdue</Badge> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Details summary={`Forecast assumptions (${fc.assumptions.length})`}>
          <ul className="space-y-1 text-[13px]">
            {fc.assumptions.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2">
                <StatusPill status={a.status} />
                <span>{a.description}</span>
                {a.requiresProfessionalReview ? <Badge tone="bad">professional review</Badge> : null}
              </li>
            ))}
          </ul>
        </Details>
        <Details summary={`Excluded flows (${fc.excludedFlows.length}) & calculation`}>
          {fc.excludedFlows.length ? (
            <ul className="mb-3 space-y-1 text-[13px]">
              {fc.excludedFlows.map((f) => (
                <li key={f.id}>
                  {f.label} · {fmtDate(f.date)} · {fmtMoney(f.amount)} <Badge>{f.confidence}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[13px] text-muted">No flows fell outside the horizon.</p>
          )}
          <KeyValue dense items={[{ k: "Calc id", v: fc.calc.id, mono: true }, { k: "Formula", v: fc.calc.formula, mono: true }, { k: "Burn formula", v: rw.burn.formula, mono: true }, { k: "Reserve status", v: rw.reserve.value === null ? "INSUFFICIENT_INFORMATION (policy not set)" : fmtPercent(rw.reserve.value.coverageRatio) }]} />
        </Details>
      </div>
    </>
  );
}
