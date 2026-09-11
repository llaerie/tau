import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson, apiError } from "@/lib/ui/api";
import { fullyLoadedCost, type PayrollRateAssumptionSet, type PayrollRateAssumption } from "@/lib/finance/headcount";
import { toPlain } from "@/lib/ui/serialize";
import { decimalOrNull } from "@/lib/ui/data";
import type { Compensation } from "@/lib/core/types";

interface Body {
  amount?: string | number;
  period?: "MONTHLY" | "ANNUAL" | "HOURLY";
  type?: "SALARY" | "HOURLY" | "CONTRACT";
  hoursPerYear?: number;
  benefits?: string | number | null;
  overhead?: string | number | null;
  rates?: Record<string, string | number | null | undefined>;
}

const RATE_KEYS = ["socialSecurityRate", "socialSecurityWageBase", "medicareRate", "futaRate", "futaWageBase", "suiRate", "suiWageBase", "ettRate", "sdiRate"] as const;

/** Employer cost calculator. Rates are user-entered (UNCONFIRMED) unless a CONFIRMED CURRENT tax rule supplies them. */
export const POST = withApi(async (req) => {
  const body = await readJson<Body>(req);
  const amount = decimalOrNull(body.amount);
  if (!amount) return apiError("amount is required");
  const rt = await getRuntime();
  const rates = {} as PayrollRateAssumptionSet;
  const provenance: Record<string, string> = {};
  for (const k of RATE_KEYS) {
    const raw = body.rates?.[k];
    const v = raw === null || raw === undefined || raw === "" ? null : decimalOrNull(raw);
    // Every employer rate AND wage base is required; the engine refuses to guess a missing one (INSUFFICIENT_INFORMATION).
    const r: PayrollRateAssumption = { value: v, status: "UNCONFIRMED", note: v === null ? "not entered" : "user-entered in the console; not from a CONFIRMED rule" };
    rates[k] = r;
    provenance[k] = v === null ? "MISSING" : "USER_ENTERED_UNCONFIRMED";
  }
  // Any CURRENT tax rule with matching parameter keys is reported so the user can see what the rule store knows.
  const currentRules = rt.taxRules.list({ status: "CURRENT" }).map((r) => ({ key: r.key, status: r.status, parameters: r.parameters ?? null, sourceId: r.sourceId }));
  rates.label = "Console-entered rate set";
  rates.isSynthetic = true;
  const compensation: Compensation = { type: body.type ?? "SALARY", amount, currency: "USD", period: body.period ?? "ANNUAL", basis: "GROSS", status: "UNCONFIRMED", note: "entered in the console" };
  const calc = fullyLoadedCost({ compensation, rates, benefits: decimalOrNull(body.benefits), overhead: decimalOrNull(body.overhead), hoursPerYear: body.hoursPerYear, asOfDate: rt.asOfDate });
  return json({ calc: toPlain(calc), provenance, currentRules, warning: "Rates are not authoritative unless they come from a CONFIRMED tax rule citing an authoritative source. Treat this as an estimate for planning only." });
}, "VIEW_FINANCIALS");
