/**
 * The empty company workspace must never produce a fabricated number: cash is UNKNOWN (not 0.00),
 * nothing is NaN, and Ask CFO answers INSUFFICIENT_INFORMATION for the cash position.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { askCfo } from "@/lib/agents/ask";
import { buildCompanyWorkspace, CASH_UNKNOWN_LABEL, hasBookData } from "@/lib/db/workspace";
import { createLabRuntime, seedKnowledgeInto, type LabRuntime } from "@/lib/db/runtime";
import { MemoryStore } from "@/lib/db/memory-store";
import { buildAttentionQueue, CASH_UNKNOWN_TITLE, cashPosition, thirteenWeekFor } from "@/lib/monitors";
import { buildWeeklyBrief, financialHealth, renderWeeklyBriefMarkdown } from "@/lib/workflows";
import { cashPosition as uiCashPosition, localAttentionQueue, localFinancialHealth, runwayInfo, thirteenWeek as uiThirteenWeek, monthlyPnl } from "@/lib/ui/data";
import { normalizeBrief, normalizeHealth } from "@/lib/ui/normalize";
import type { Actor } from "@/lib/core/types";

const AS_OF = "2026-09-11";
const OWNER: Actor = { type: "USER", id: "owner", role: "OWNER", displayName: "Owner" };

/** Walk any JSON-able value and collect NaN / Infinity numbers and "NaN"/"undefined" strings. */
function fabricated(value: unknown, path = "$", out: string[] = []): string[] {
  if (typeof value === "number" && !Number.isFinite(value)) out.push(`${path}=${value}`);
  else if (typeof value === "string" && (value === "NaN" || value === "undefined" || /\bNaN\b/.test(value))) out.push(`${path}="${value}"`);
  else if (Array.isArray(value)) value.forEach((v, i) => fabricated(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) fabricated(v, `${path}.${k}`, out);
  return out;
}

describe("empty company workspace — no fabricated numbers", () => {
  let rt: LabRuntime;
  beforeAll(async () => {
    const ds = seedKnowledgeInto(buildCompanyWorkspace({ asOfDate: AS_OF }));
    rt = await createLabRuntime({ store: new MemoryStore(ds), asOfDate: AS_OF, skipRetrieval: true });
  });

  it("has empty books and an unknown cash position", () => {
    expect(hasBookData(rt.dataset)).toBe(false);
    const cash = cashPosition(rt.dataset, rt.ledger, AS_OF);
    expect(cash.known).toBe(false);
    expect(cash.calc.value.total).toBeNull();
    expect(cash.calc.assumptions.some((a) => a.key === "cash_unknown_no_book_data" && a.value === null && a.status === "UNCONFIRMED")).toBe(true);
    const tw = thirteenWeekFor(rt.dataset, rt.ledger, rt.thresholds, AS_OF);
    expect(tw.cash.known).toBe(false);
    expect(tw.forecast.rows).toHaveLength(13);
    expect(tw.forecast.assumptions[0]).toMatchObject({ key: "opening_cash_unknown", value: null, status: "UNCONFIRMED" });
    expect(fabricated(tw.forecast)).toEqual([]);
  });

  it("weekly brief reports cash as unknown, not $0.00, and contains no NaN", async () => {
    const brief = await buildWeeklyBrief(rt, AS_OF);
    expect(brief.isSyntheticData).toBe(false);
    expect(brief.cashToday.known).toBe(false);
    expect(brief.cashToday.total).toBeNull();
    expect(brief.thirteenWeekLowestCash.amount).toBeNull();
    expect(brief.thirteenWeekLowestCash.endingCash).toBeNull();
    expect(brief.executiveSummary).toContain(CASH_UNKNOWN_LABEL);
    expect(brief.executiveSummary).not.toMatch(/Cash today is \$0\.00/);
    expect(brief.executiveSummary).not.toMatch(/bottoms at \$0\.00/);
    expect(brief.payrollUpcoming.cadence).toBe("UNKNOWN");
    expect(brief.missingInformation.setupItems).toHaveLength(26);
    expect(brief.recommendedActions[0].title).toMatch(/Cash is unknown/);
    expect(fabricated(JSON.parse(JSON.stringify(brief)))).toEqual([]);
    expect(fabricated(brief)).toEqual([]);
    const md = renderWeeklyBriefMarkdown(brief);
    expect(md).toContain(CASH_UNKNOWN_LABEL);
    expect(md).not.toMatch(/\*\*Total\*\* \| \*\*\$0\.00\*\*/);
    expect(md).not.toMatch(/NaN/);
    const view = normalizeBrief(brief, md);
    expect(view.keyNumbers.find((n) => n.label === "Cash today")?.value).toBe(CASH_UNKNOWN_LABEL);
    expect(view.keyNumbers.find((n) => n.label === "13-week lowest cash")?.value).toBe(CASH_UNKNOWN_LABEL);
  });

  it("attention queue flags the unknown cash position and never raises a cash-shortfall alarm", async () => {
    const queue = await buildAttentionQueue(rt, AS_OF);
    const cashItems = queue.filter((i) => i.kind === "low_projected_cash");
    expect(cashItems.map((i) => i.title)).toEqual([CASH_UNKNOWN_TITLE]);
    expect(cashItems[0].severity).toBe("INFO");
    expect(queue.some((i) => i.kind === "finance_setup_incomplete")).toBe(true);
    expect(queue.filter((i) => i.kind === "international_worker_review").length).toBeGreaterThanOrEqual(2);
    expect(queue.some((i) => i.kind === "monitor_error")).toBe(false);
    expect(queue.every((i) => i.amount === undefined || /^-?\d+\.\d{4}$/.test(i.amount))).toBe(true);
    expect(fabricated(queue)).toEqual([]);
    const local = localAttentionQueue(rt, AS_OF);
    expect(local.find((i) => i.id === "books:empty")).toMatchObject({ severity: "INFO", kind: "BOOKS" });
  });

  it("financial health scores cash as unknown (null), runway unknown, and has no NaN", async () => {
    const h = await financialHealth(rt, AS_OF);
    expect(h.isSyntheticData).toBe(false);
    expect(h.cash.known).toBe(false);
    expect(h.cash.value).toBeNull();
    expect(h.cash.status).toBe("WATCH");
    expect(h.cash.note).toContain(CASH_UNKNOWN_LABEL);
    expect(h.runwayMonths.value).toBeNull();
    expect(h.runwayMonths.burnRate).toBeNull();
    expect(h.runwayMonths.note).toContain(CASH_UNKNOWN_LABEL);
    expect(h.unknownConfigCount.value).toBe(26);
    expect(h.integrityPassed.value).toBe(true);
    expect(fabricated(h)).toEqual([]);
    const card = normalizeHealth(h, AS_OF);
    expect(card.metrics.find((m) => m.key === "cash")?.value).toBe(CASH_UNKNOWN_LABEL);
    expect(card.metrics.find((m) => m.key === "runwayMonths")?.value).toBe("unknown");
    const local = localFinancialHealth(rt, AS_OF);
    expect(local.metrics.find((m) => m.key === "cash")).toMatchObject({ value: CASH_UNKNOWN_LABEL, status: "UNKNOWN" });
    expect(local.metrics.find((m) => m.key === "runway")).toMatchObject({ value: CASH_UNKNOWN_LABEL, status: "UNKNOWN" });
    expect(fabricated(local)).toEqual([]);
  });

  it("console loaders: cash unknown, runway insufficient, 13-week and monthly P&L finite", () => {
    const cash = uiCashPosition(rt);
    expect(cash.known).toBe(false);
    expect(cash.accounts).toEqual([]);
    const rw = runwayInfo(rt);
    expect(rw.burn.value).toBeNull();
    expect(rw.runway.value).toBeNull();
    expect(rw.reserve.value).toBeNull();
    expect(rw.runway.notes?.[0]).toMatch(/INSUFFICIENT_INFORMATION/);
    const tw = uiThirteenWeek(rt);
    expect(tw.assumptions[0].key).toBe("opening_cash_unknown");
    expect(fabricated(tw)).toEqual([]);
    const pnl = monthlyPnl(rt, 12);
    expect(pnl).toHaveLength(12);
    expect(pnl.every((p) => p.revenue === "0.0000" && p.netIncome === "0.0000")).toBe(true);
  });

  it("Ask CFO: cash position is INSUFFICIENT_INFORMATION, never 0", async () => {
    const res = await askCfo(rt, "What is our cash position?", { actor: OWNER });
    expect(res.agent).toBe("treasury");
    expect(res.intent).toBe("cash.position");
    expect(res.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
    expect(res.structured.value).toBeNull();
    expect(res.response.answer).toContain(CASH_UNKNOWN_LABEL);
    expect(res.response.answer).not.toMatch(/\$0\.00/);
    expect(res.response.answer).not.toMatch(/\b0\.0000\b/);
    expect(res.response.answer).not.toMatch(/synthetic/i);
    expect(res.response.numbers.some((f) => /0\.00/.test(String(f.value)) && /cash/i.test(f.label))).toBe(false);
    expect(fabricated(JSON.parse(JSON.stringify(res)))).toEqual([]);
  });

  it("Ask CFO: health summary marks cash unknown and escalates instead of reporting zero cash", async () => {
    const res = await askCfo(rt, "How are we doing financially?", { actor: OWNER });
    expect(res.intent).toBe("cfo.health");
    expect(res.response.answer).toContain(CASH_UNKNOWN_LABEL);
    expect(res.response.answer).not.toMatch(/cash \$?0\.0000/);
    const values = res.structured.values as Record<string, unknown> | undefined;
    expect(values?.cash ?? null).toBeNull();
    expect(fabricated(JSON.parse(JSON.stringify(res)))).toEqual([]);
  });

  it("13-week forecast via Ask CFO escalates INSUFFICIENT_INFORMATION on empty books", async () => {
    const res = await askCfo(rt, "Run a 13-week cash flow forecast", { actor: OWNER });
    expect(res.intent).toBe("cash.thirteen_week");
    expect(res.escalation?.type).toBe("INSUFFICIENT_INFORMATION");
    expect(fabricated(JSON.parse(JSON.stringify(res)))).toEqual([]);
  });
});
