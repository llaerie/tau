/** Treasury agent: cash position, 13-week forecast, scenarios, runway, reserves, working capital. */
import type { RouteRule } from "../intent";
import { cashPositionTool, delayedReceiptTool, reserveCoverageTool, runwayTool, stressTestTool, thirteenWeekTool, workingCapitalTool } from "../tools/treasury-tools";
import { Specialist } from "./shared";

const rules: RouteRule[] = [
  { kind: "cash.delayed_receipt", weight: 3, any: [/\bpays? (us )?(\d+ )?(days?|weeks?) late\b/i, /\blate payment\b/i, /\bdelay(ed|s)? (the |their )?(receipt|payment|invoice)\b/i, /\bpaid (\d+ )?days? late\b/i, /\bif .* (pays?|paid) late\b/i, /\bslips? (by )?\d+ days\b/i], params: (m, e, _asOf) => ({ delayDays: e.durations.find((d) => d.unit === "DAY")?.value ?? (e.durations.find((d) => d.unit === "WEEK") ? e.durations.find((d) => d.unit === "WEEK")!.value * 7 : e.numbers[0]), receiptLabel: /\b(harbor|meridian|customer [A-Z]\w+)\b/i.exec(m)?.[1], asOf: e.dates[0] }) },
  { kind: "cash.stress_test", weight: 3, any: [/\bstress[- ]test\b/i, /\bhaircut\b/i, /\bworst[- ]case\b/i, /\bdownside\b/i, /\bif revenue (drops|falls|declines)\b/i, /\bunexpected (\$?\d[\d,]*|expense|disbursement|cost)\b/i], params: (_m, e, _asOf) => ({ receiptHaircut: e.percents[0], extraDisbursement: e.amounts[0], asOf: e.dates[0] }) },
  { kind: "cash.thirteen_week", weight: 2.8, any: [/\b(13|thirteen)[\s-]*week/i, /\bcash (flow )?forecast\b/i, /\bweekly cash\b/i, /\bcash projection\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], minimumCash: undefined }) },
  { kind: "cash.runway", weight: 2.6, any: [/\brunway\b/i, /\bburn( rate)?\b/i, /\bhow (many )?months (of cash|can we last|do we have)\b/i, /\bmonths of cash\b/i], params: (_m, e, _asOf) => ({ months: e.durations.find((d) => d.unit === "MONTH")?.value, asOf: e.dates[0] }) },
  { kind: "cash.reserve_coverage", weight: 2.6, any: [/\breserve\b/i, /\bminimum cash\b/i, /\bcash cushion\b/i, /\bsafety (net|buffer)\b/i, /\benough cash (set aside|in reserve)\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], minimumCash: e.amounts[0] }) },
  { kind: "cash.working_capital", weight: 2.6, any: [/\bworking capital\b/i, /\bcurrent ratio\b/i, /\bquick ratio\b/i, /\bliquidity\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
  { kind: "cash.position", weight: 2.2, any: [/\bcash (position|balance|on hand|today|right now|do we have)\b/i, /\bhow much (cash|money) (do we have|is in the bank|in the bank)\b/i, /\bbank balances?\b/i, /\bwhat('s| is) (our|the) cash\b/i, /\bcash today\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
];

export function createTreasuryAgent(): Specialist {
  return new Specialist({
    name: "treasury",
    description: "Treasury: cash position, 13-week cash forecast, delayed-receipt and stress scenarios, burn and runway, reserve coverage and working capital.",
    keywords: [/\bcash\b/i, /\brunway\b/i, /\bburn\b/i, /\bliquidity\b/i, /\breserve\b/i, /\b13[- ]week\b/i, /\bthirteen\b/i, /\bforecast\b/i, /\bbank\b/i, /\bworking capital\b/i],
    rules,
    tools: [
      [cashPositionTool, "cash.position"],
      [thirteenWeekTool, "cash.thirteen_week"],
      [delayedReceiptTool, "cash.delayed_receipt"],
      [stressTestTool, "cash.stress_test"],
      [runwayTool, "cash.runway"],
      [reserveCoverageTool, "cash.reserve_coverage"],
      [workingCapitalTool, "cash.working_capital"],
    ],
  });
}
