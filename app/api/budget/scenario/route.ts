import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson, apiError } from "@/lib/ui/api";
import { rollingForecast, applyScenario, forecastSummaryCalc } from "@/lib/forecasting/forecast";
import { buildDefaultDrivers } from "@/lib/forecasting/drivers";
import { toPlain } from "@/lib/ui/serialize";
import type { Scenario } from "@/lib/core/types";

/** Apply driver overrides to the active (or default) forecast and return the re-projected summary. Nothing is stored. */
export const POST = withApi(async (req) => {
  const body = await readJson<{ name?: string; driverOverrides?: Record<string, string | number>; events?: Scenario["events"] }>(req);
  const overrides = body.driverOverrides && typeof body.driverOverrides === "object" ? body.driverOverrides : {};
  if (!Object.keys(overrides).length && !(body.events?.length)) return apiError("driverOverrides or events required");
  const rt = await getRuntime();
  const ds = rt.dataset;
  const active = ds.forecasts.find((f) => f.status === "ACTIVE");
  const base = active ?? rollingForecast(ds, rt.asOfDate, 12, buildDefaultDrivers(ds, rt.asOfDate).drivers).forecast;
  const scenario: Scenario = { id: "scn_api", name: body.name ?? "API scenario", description: "", baseForecastId: base.id, driverOverrides: overrides, events: body.events ?? [], createdAt: new Date(0).toISOString(), createdBy: "console" };
  const out = applyScenario(base, scenario, ds.accounts);
  return json({ base: toPlain(forecastSummaryCalc(base, ds.accounts).value), scenario: toPlain(forecastSummaryCalc(out.forecast, ds.accounts).value), calcs: toPlain(out.calcs) });
}, "VIEW_FINANCIALS");
