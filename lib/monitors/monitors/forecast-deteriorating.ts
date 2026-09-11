/**
 * Compare the ACTIVE forecast with a fresh rolling forecast over the same forecast months.
 * Ending cash ≈ cash today + projected net; a material drop is reported.
 */
import { daysBetween } from "@/lib/core/dates";
import { D, abs, add, gt, sub } from "@/lib/core/money";
import { makeCalc, safeRatio } from "@/lib/finance/calc-result";
import { buildDefaultDrivers } from "@/lib/forecasting/drivers";
import { rollingForecast } from "@/lib/forecasting/forecast";
import type { Forecast } from "@/lib/core/types";
import { cashPosition, makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

function netOverMonths(f: Forecast, months: Set<string>, type: Map<string, string | undefined>) {
  let net = "0.0000";
  for (const l of f.lines) {
    if (l.basis !== "FORECAST" || !months.has(l.month)) continue;
    const t = type.get(l.accountId);
    if (t === "REVENUE") net = add(net, l.amount);
    else if (t === "EXPENSE") net = sub(net, l.amount);
  }
  return net;
}

export const forecastDeteriorating: Monitor = {
  key: "forecast_deteriorating",
  description: "Fresh rolling forecast projects materially lower ending cash than the ACTIVE forecast.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf, thresholds } = ctx;
    const active = dataset.forecasts.find((f) => f.status === "ACTIVE");
    if (!active) return [];
    const drivers = buildDefaultDrivers(dataset, asOf).drivers;
    const fresh = rollingForecast(dataset, asOf, active.horizonMonths, drivers, { accounts: dataset.accounts }).forecast;
    const activeMonths = new Set(active.lines.filter((l) => l.basis === "FORECAST").map((l) => l.month));
    const freshMonths = new Set(fresh.lines.filter((l) => l.basis === "FORECAST").map((l) => l.month));
    const common = new Set([...activeMonths].filter((m) => freshMonths.has(m)));
    const items: AttentionItem[] = [];
    if (daysBetween(active.asOfDate, asOf) > 60) {
      items.push(
        makeItem(ctx, {
          kind: "forecast_deteriorating",
          severity: "INFO",
          title: `Active forecast is ${daysBetween(active.asOfDate, asOf)} days old`,
          detail: `Forecast "${active.name}" (v${active.version}) is dated ${active.asOfDate}. Refresh the rolling forecast so variance and cash projections use current drivers.`,
          relatedIds: [active.id],
          suggestedTask: { kind: "fpa.rolling_forecast", params: {} },
        }),
      );
    }
    if (!common.size) return items;
    const type = new Map(dataset.accounts.map((a) => [a.id, a.type as string | undefined]));
    const cash = cashPosition(dataset, ctx.ledger, asOf);
    const activeNet = netOverMonths(active, common, type);
    const freshNet = netOverMonths(fresh, common, type);
    const activeEnding = add(cash.total, activeNet);
    const freshEnding = add(cash.total, freshNet);
    const drop = sub(activeEnding, freshEnding);
    const ratio = safeRatio(drop, abs(activeEnding));
    const calc = makeCalc({
      name: "forecast_ending_cash_comparison",
      value: { activeEndingCash: activeEnding, freshEndingCash: freshEnding, drop, ratio, months: [...common].sort() },
      unit: "OBJECT",
      formula: "ending_cash = cash_today + sum(forecast revenue - forecast expense over common months); drop = active_ending - fresh_ending",
      inputs: { activeForecastId: active.id, freshForecastId: fresh.id, cashToday: cash.total, activeNet, freshNet, months: [...common].sort() },
      sourceIds: [active.id, fresh.id, cash.calc.id],
      asOfDate: asOf,
      assumptions: Object.values(fresh.drivers).filter((d) => d.status !== "CONFIRMED").map((d) => ({ key: d.key, description: `${d.label}${d.note ? ` — ${d.note}` : ""}`, value: d.value, status: d.status })),
    });
    const calcId = ctx.recordCalc(calc);
    const material = gt(drop, thresholds.forecastChangeAmount) || (ratio !== null && ratio > thresholds.forecastChangeRatio && gt(drop, 0));
    if (!material) return items;
    items.push(
      makeItem(ctx, {
        kind: "forecast_deteriorating",
        severity: D(freshEnding).lt(0) ? "CRITICAL" : "WARNING",
        title: `Forecast ending cash down ${drop} vs active forecast`,
        detail: `Over ${common.size} common month(s): active forecast implies ending cash ${activeEnding}; a fresh driver-based forecast implies ${freshEnding}${ratio !== null ? ` (${(ratio * 100).toFixed(1)}% lower)` : ""}. Material threshold ${thresholds.forecastChangeAmount} / ${thresholds.forecastChangeRatio}${thresholds.status !== "CONFIRMED" ? " (UNCONFIRMED lab default)" : ""}.`,
        amount: drop,
        relatedIds: [active.id, fresh.id],
        calcIds: [calcId],
        sourceIds: [active.id, cash.calc.id],
        suggestedTask: { kind: "fpa.rolling_forecast", params: { horizonMonths: active.horizonMonths } },
      }),
    );
    return items;
  },
};
