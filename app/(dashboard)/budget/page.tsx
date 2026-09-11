import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { activeBudget } from "@/lib/ui/data";
import { budgetVariance, type VarianceRow } from "@/lib/finance/variance";
import { actualsByAccountMonth } from "@/lib/forecasting/budget";
import { rollingForecast, applyScenario, forecastSummaryCalc } from "@/lib/forecasting/forecast";
import { buildDefaultDrivers, DRIVER_KEYS } from "@/lib/forecasting/drivers";
import { monthEnd, monthKey, addMonths } from "@/lib/core/dates";
import { PageHeader, Tabs, pickTab, Grid, Stat, Card, CardHeader, TableWrap, Money, StatusPill, Badge, Notice, EmptyState, Details, KeyValue } from "@/components/ui";
import { fmtMoney, fmtMonth, fmtPercent, toNum, fmtSigned } from "@/lib/ui/format";
import type { Scenario } from "@/lib/core/types";

export const metadata: Metadata = { title: "Budget & forecast" };
export const dynamic = "force-dynamic";

const TABS = ["variance", "forecast", "scenario", "assumptions"];

export default async function BudgetPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, asOf } = await pageCtx();
  const ds = rt.dataset;
  const budget = activeBudget(rt);
  const fyStart = `${asOf.slice(0, 4)}-01-01`;
  const actuals = actualsByAccountMonth(ds, fyStart, monthEnd(asOf));
  const months = Array.from({ length: 12 }, (_, i) => monthKey(addMonths(fyStart, i))).filter((m) => m <= monthKey(asOf));
  const variance = budget ? budgetVariance(actuals, budget, { accounts: ds.accounts, materialityRatio: rt.thresholds.varianceRatio, materialityAmount: rt.thresholds.forecastChangeAmount, months, asOfDate: asOf }) : null;
  const vr = variance?.value ?? null;

  // Rolling forecast: use the ACTIVE stored forecast if any, else build one from default drivers.
  const drivers = buildDefaultDrivers(ds, asOf);
  const active = ds.forecasts.find((f) => f.status === "ACTIVE");
  const built = rollingForecast(ds, asOf, 12, drivers.drivers, { name: "Rolling 12-month forecast (console)" });
  const forecast = active ?? built.forecast;
  const summary = forecastSummaryCalc(forecast, ds.accounts).value;

  // Scenario builder: driver overrides via query params.
  const overrides: Record<string, string> = {};
  for (const key of Object.values(DRIVER_KEYS)) {
    const v = sp(q[`d:${key}`]);
    if (v !== "" && Number.isFinite(Number(v))) overrides[key] = v;
  }
  const scenarioName = sp(q.name, "Console scenario");
  const scenario: Scenario | null = Object.keys(overrides).length
    ? { id: "scn_console", name: scenarioName, description: "Built in the console", baseForecastId: forecast.id, driverOverrides: overrides, events: [], createdAt: new Date(0).toISOString(), createdBy: "console" }
    : null;
  const scen = scenario ? applyScenario(forecast, scenario, ds.accounts) : null;
  const scenSummary = scen ? forecastSummaryCalc(scen.forecast, ds.accounts).value : null;

  const monthCols = vr ? Array.from(new Set(vr.rows.map((r) => r.month))).sort() : [];
  const byAccount = vr ? vr.byAccount : [];
  const acctById = new Map(ds.accounts.map((a) => [a.id, a]));

  return (
    <>
      <PageHeader title="Budget & forecast" description="Budget vs actual with materiality-flagged variances, the rolling forecast (actual months vs driver-based months), and a scenario builder over driver assumptions." />
      <Grid cols={4} className="mb-5">
        <Stat label="Budget" value={budget ? budget.name : "None"} sub={budget ? `FY${budget.fiscalYear} v${budget.version} · ${budget.status}` : "No budget in the dataset"} />
        <Stat label="Net variance YTD" value={vr ? fmtSigned(vr.summary.netVariance) : "—"} sub={vr ? `${vr.summary.flaggedCount} flagged lines (≥ ${fmtPercent(rt.thresholds.varianceRatio, 0)} or ${fmtMoney(rt.thresholds.forecastChangeAmount)})` : ""} tone={vr ? (toNum(vr.summary.netVariance) < 0 ? "warn" : "ok") : "neutral"} />
        <Stat label="Forecast net (12 mo)" value={fmtMoney(summary.totalForecastNet)} sub={`${summary.forecastMonths.length} forecast months · ${forecast.status}`} tone={toNum(summary.totalForecastNet) < 0 ? "warn" : "ok"} />
        <Stat label="Driver assumptions" value={Object.keys(forecast.drivers).length} sub={`${Object.values(forecast.drivers).filter((d) => d.status === "CONFIRMED").length} confirmed · ${Object.values(forecast.drivers).filter((d) => d.status !== "CONFIRMED").length} assumed`} />
      </Grid>
      <Tabs basePath="/budget" active={tab} tabs={[{ key: "variance", label: "Budget vs actual" }, { key: "forecast", label: "Rolling forecast" }, { key: "scenario", label: "Scenario builder" }, { key: "assumptions", label: "Assumptions" }]} />

      {tab === "variance" ? (
        !vr ? (
          <EmptyState title="No budget available">The synthetic dataset has no budget; build one via FP&A or seed the lab.</EmptyState>
        ) : (
          <div className="space-y-4">
            <Card padded={false}>
              <CardHeader title="By account (YTD)" className="px-4 pt-3" subtitle="Favorable = revenue above budget or expense below budget." />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="r">Actual</th>
                      <th className="r">Budget</th>
                      <th className="r">Variance</th>
                      <th className="r">%</th>
                      <th>Favorable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAccount.map((t) => {
                      const a = acctById.get(t.key);
                      return (
                        <tr key={t.key}>
                          <td>
                            <span className="mono">{a?.code}</span> {a?.name ?? t.key}
                          </td>
                          <td className="r">
                            <Money value={t.actual} />
                          </td>
                          <td className="r">
                            <Money value={t.budget} />
                          </td>
                          <td className="r">
                            <Money value={t.variance} signed />
                          </td>
                          <td className="r">{fmtPercent(t.variancePct)}</td>
                          <td>{t.favorable === null ? <Badge>n/a</Badge> : t.favorable ? <Badge tone="ok">favorable</Badge> : <Badge tone="bad">unfavorable</Badge>}</td>
                        </tr>
                      );
                    })}
                    <tr className="total">
                      <td>Revenue</td>
                      <td className="r">
                        <Money value={vr.summary.actualRevenue} />
                      </td>
                      <td className="r">
                        <Money value={vr.summary.budgetRevenue} />
                      </td>
                      <td className="r" colSpan={3}></td>
                    </tr>
                    <tr className="total">
                      <td>Expenses</td>
                      <td className="r">
                        <Money value={vr.summary.actualExpense} />
                      </td>
                      <td className="r">
                        <Money value={vr.summary.budgetExpense} />
                      </td>
                      <td className="r" colSpan={3}></td>
                    </tr>
                  </tbody>
                </table>
              </TableWrap>
            </Card>
            <Card padded={false}>
              <CardHeader title={`Flagged variances (${vr.flagged.length})`} className="px-4 pt-3" subtitle="Lines breaching the materiality ratio or amount." />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Account</th>
                      <th className="r">Actual</th>
                      <th className="r">Budget</th>
                      <th className="r">Variance</th>
                      <th>Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vr.flagged.slice(0, 60).map((r: VarianceRow) => (
                      <tr key={`${r.accountId}-${r.month}`} className={r.favorable === false ? "hl" : ""}>
                        <td>{fmtMonth(r.month)}</td>
                        <td>
                          <span className="mono">{r.accountCode}</span> {r.accountName}
                        </td>
                        <td className="r">
                          <Money value={r.actual} />
                        </td>
                        <td className="r">
                          <Money value={r.budget} />
                        </td>
                        <td className="r">
                          <Money value={r.variance} signed /> <span className="text-muted">({fmtPercent(r.variancePct)})</span>
                        </td>
                        <td className="text-muted">{r.flagReasons.join("; ")}</td>
                      </tr>
                    ))}
                    {vr.flagged.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-muted">
                          No material variances.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
            <Card padded={false}>
              <CardHeader title="By month" className="px-4 pt-3" />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="r">Actual net</th>
                      <th className="r">Budget net</th>
                      <th className="r">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vr.byMonth.map((m) => (
                      <tr key={m.key}>
                        <td>{fmtMonth(m.key)}</td>
                        <td className="r">
                          <Money value={m.actual} colorize />
                        </td>
                        <td className="r">
                          <Money value={m.budget} colorize />
                        </td>
                        <td className="r">
                          <Money value={m.variance} signed />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {monthCols.length === 0 ? <p className="p-4 text-muted">No months in range.</p> : null}
            </Card>
          </div>
        )
      ) : null}

      {tab === "forecast" ? (
        <Card padded={false}>
          <CardHeader title={forecast.name} className="px-4 pt-3" subtitle={`${active ? "Stored ACTIVE forecast" : "Built on request from default drivers (not stored)"} · as of ${forecast.asOfDate} · horizon ${forecast.horizonMonths} months`} />
          <TableWrap className="border-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Basis</th>
                  <th className="r">Revenue</th>
                  <th className="r">Expense</th>
                  <th className="r">Net</th>
                </tr>
              </thead>
              <tbody>
                {summary.months.map((m) => (
                  <tr key={m.month} className={m.basis === "FORECAST" ? "" : "text-muted"}>
                    <td>{fmtMonth(m.month)}</td>
                    <td>
                      <StatusPill status={m.basis} label={m.basis === "ACTUAL" ? "actual" : "forecast"} />
                    </td>
                    <td className="r">
                      <Money value={m.revenue} />
                    </td>
                    <td className="r">
                      <Money value={m.expense} />
                    </td>
                    <td className="r">
                      <Money value={m.net} colorize />
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={2}>Forecast months total</td>
                  <td className="r">
                    <Money value={summary.totalForecastRevenue} />
                  </td>
                  <td className="r">
                    <Money value={summary.totalForecastExpense} />
                  </td>
                  <td className="r">
                    <Money value={summary.totalForecastNet} colorize />
                  </td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <div className="px-4 py-3 text-[12px] text-muted">
            {drivers.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === "scenario" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Driver overrides" subtitle="Override any driver; the forecast months are re-projected. Overrides are UNCONFIRMED assumptions and are not stored." actions={scen ? <a href="/budget?tab=scenario" className="text-[12px] text-accent">Clear</a> : null} />
            <form method="get" className="grid gap-3">
              <input type="hidden" name="tab" value="scenario" />
              <label className="text-[12px] text-muted">
                Scenario name
                <input name="name" defaultValue={scenarioName} className="input mt-1 max-w-sm" />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.values(DRIVER_KEYS).map((key) => {
                  const d = forecast.drivers[key];
                  return (
                    <label key={key} className="text-[12px] text-muted">
                      <span className="block truncate" title={key}>
                        {d?.label ?? key} <span className="text-faint">({d?.unit ?? "?"})</span>
                      </span>
                      <input name={`d:${key}`} defaultValue={overrides[key] ?? ""} placeholder={d ? String(d.value) : "n/a"} className="input mt-1" />
                    </label>
                  );
                })}
              </div>
              <div>
                <button className="inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg">Apply scenario</button>
              </div>
            </form>
          </Card>
          {scen && scenSummary ? (
            <Card padded={false}>
              <CardHeader title={scen.forecast.name} className="px-4 pt-3" subtitle={`Forecast net ${fmtMoney(summary.totalForecastNet)} → ${fmtMoney(scenSummary.totalForecastNet)} (${fmtSigned(String(toNum(scenSummary.totalForecastNet) - toNum(summary.totalForecastNet)))})`} />
              <TableWrap className="border-0">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="r">Base revenue</th>
                      <th className="r">Scenario revenue</th>
                      <th className="r">Base expense</th>
                      <th className="r">Scenario expense</th>
                      <th className="r">Base net</th>
                      <th className="r">Scenario net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenSummary.months
                      .filter((m) => m.basis === "FORECAST")
                      .map((m) => {
                        const b = summary.months.find((x) => x.month === m.month);
                        return (
                          <tr key={m.month}>
                            <td>{fmtMonth(m.month)}</td>
                            <td className="r text-muted">
                              <Money value={b?.revenue ?? null} />
                            </td>
                            <td className="r">
                              <Money value={m.revenue} />
                            </td>
                            <td className="r text-muted">
                              <Money value={b?.expense ?? null} />
                            </td>
                            <td className="r">
                              <Money value={m.expense} />
                            </td>
                            <td className="r text-muted">
                              <Money value={b?.net ?? null} colorize />
                            </td>
                            <td className="r font-medium">
                              <Money value={m.net} colorize />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </TableWrap>
              <div className="px-4 py-3">
                <KeyValue dense items={[{ k: "Overrides", v: Object.entries(overrides).map(([k, v]) => `${k} = ${v}`).join("; "), mono: true }, { k: "Calc id", v: scen.calcs[0]?.id ?? "—", mono: true }]} />
              </div>
            </Card>
          ) : (
            <Notice>Enter one or more overrides and apply to see the scenario side by side with the base forecast.</Notice>
          )}
        </div>
      ) : null}

      {tab === "assumptions" ? (
        <div className="space-y-4">
          <Card padded={false}>
            <CardHeader title={`Forecast drivers (${Object.keys(forecast.drivers).length})`} className="px-4 pt-3" />
            <TableWrap className="border-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th className="r">Value</th>
                    <th>Unit</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(forecast.drivers)
                    .sort((a, b) => a.key.localeCompare(b.key))
                    .map((d) => (
                      <tr key={d.key}>
                        <td>
                          <div>{d.label}</div>
                          <div className="mono text-faint">{d.key}</div>
                        </td>
                        <td className="r">{String(d.value)}</td>
                        <td className="text-muted">{d.unit}</td>
                        <td>
                          <StatusPill status={d.status} />
                        </td>
                        <td className="max-w-[420px] text-muted">{d.note ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          {budget ? (
            <Details summary={`Budget assumptions (${budget.assumptions.length})`} open>
              {budget.assumptions.length === 0 ? (
                <p className="text-[13px] text-muted">The budget carries no explicit assumptions.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {budget.assumptions.map((a) => (
                    <li key={a.key} className="flex flex-wrap items-center gap-2">
                      <StatusPill status={a.status} />
                      <span>{a.description}</span>
                      <span className="num text-muted">{String(a.value)}</span>
                      {a.requiresProfessionalReview ? <Badge tone="bad">professional review</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Details>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
