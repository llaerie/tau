import { describe, expect, it } from "vitest";
import { CASH_RESERVE_NOT_SET_TITLE, MONITORS, MONITOR_KEYS, SEVERITY_RANK, TAX_DUE_DATES_PENDING_TITLE, buildAttentionQueue, runMonitors } from "@/lib/monitors";
import { AS_OF, IDS, makeFixtureRuntime } from "../workflows/fixture";

describe("attention queue (monitors)", () => {
  it("registers every monitor with a unique key and description", () => {
    expect(MONITORS.length).toBe(19);
    expect(new Set(MONITOR_KEYS).size).toBe(MONITORS.length);
    for (const m of MONITORS) expect(m.description.length).toBeGreaterThan(10);
  });

  it("produces the expected kinds on the fixture", async () => {
    const rt = await makeFixtureRuntime();
    const queue = await buildAttentionQueue(rt, AS_OF);
    const kinds = new Set(queue.map((i) => i.kind));
    for (const k of ["invoice_overdue", "unknown_transaction", "personal_business_mixing", "low_projected_cash", "tax_deadline_approaching", "related_party_flow", "international_worker_review", "finance_setup_incomplete", "unusual_expense", "budget_overrun", "duplicate_vendor_payment", "payroll_upcoming", "revenue_payment_missing"]) {
      expect(kinds, `missing kind ${k}`).toContain(k);
    }
    // Overdue August invoice
    const overdue = queue.find((i) => i.kind === "invoice_overdue");
    expect(overdue?.relatedIds).toContain(IDS.augInvoice);
    expect(overdue?.amount).toBe("30000.0000");
    expect(overdue?.calcIds.length).toBeGreaterThan(0);
    // Uncategorized Venmo outflow and non-zero suspense
    const unknown = queue.filter((i) => i.kind === "unknown_transaction");
    expect(unknown.some((i) => i.relatedIds.includes(IDS.suspenseTx))).toBe(true);
    expect(unknown.some((i) => i.title.startsWith("Suspense account balance"))).toBe(true);
    // Possible personal weekend meal
    expect(queue.find((i) => i.kind === "personal_business_mixing")?.relatedIds).toContain(IDS.mealTx);
    // New merchant equipment purchase
    expect(queue.find((i) => i.kind === "unusual_expense")?.relatedIds).toContain(IDS.dellTx);
    // AWS overrun vs approved budget
    expect(queue.some((i) => i.kind === "budget_overrun" && /5000/.test(i.title) && i.relatedIds.includes(IDS.budget))).toBe(true);
    // Duplicate CPA bill
    expect(queue.some((i) => i.kind === "duplicate_vendor_payment" && i.relatedIds.includes(IDS.dupBill))).toBe(true);
    // Related-party customer without a contract; international worker unresolved
    expect(queue.some((i) => i.kind === "related_party_flow" && i.relatedIds.includes(IDS.harbor))).toBe(true);
    expect(queue.some((i) => i.kind === "international_worker_review" && i.relatedIds.includes(IDS.cn1))).toBe(true);
    // Payroll projected within 7 days (semi-monthly → Sep 15)
    expect(queue.find((i) => i.kind === "payroll_upcoming")?.dueDate).toBe("2026-09-15");
  });

  it("does not guess a cash reserve: null policy yields an INFO item, never a CRITICAL shortfall", async () => {
    const rt = await makeFixtureRuntime();
    expect(rt.thresholds.minimumCashReserve).toBeNull();
    const queue = await buildAttentionQueue(rt, AS_OF);
    const cashItems = queue.filter((i) => i.kind === "low_projected_cash");
    const info = cashItems.find((i) => i.title === CASH_RESERVE_NOT_SET_TITLE);
    expect(info?.severity).toBe("INFO");
    expect(info?.suggestedTask?.kind).toBe("cfo.config_status");
    expect(cashItems.every((i) => i.severity === "INFO" || /negative/.test(i.title))).toBe(true);
  });

  it("reports unknown tax due dates as a single INFO item instead of inventing dates", async () => {
    const rt = await makeFixtureRuntime();
    expect(rt.dataset.taxObligations).toHaveLength(0);
    const queue = await buildAttentionQueue(rt, AS_OF);
    const tax = queue.filter((i) => i.kind === "tax_deadline_approaching");
    expect(tax).toHaveLength(1);
    expect(tax[0].severity).toBe("INFO");
    expect(tax[0].title).toBe(TAX_DUE_DATES_PENDING_TITLE);
    expect(tax[0].title).toMatch(/pending authoritative source retrieval \+ CPA confirmation/);
    expect(tax[0].dueDate).toBeUndefined();
  });

  it("is deterministic, sorted by severity, and carries traceability fields", async () => {
    const a = await buildAttentionQueue(await makeFixtureRuntime(), AS_OF);
    const b = await buildAttentionQueue(await makeFixtureRuntime(), AS_OF);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    for (let i = 1; i < a.length; i++) expect(SEVERITY_RANK[a[i - 1].severity]).toBeGreaterThanOrEqual(SEVERITY_RANK[a[i].severity]);
    for (const it of a) {
      expect(it.id).toMatch(/^attn_/);
      expect(Array.isArray(it.relatedIds)).toBe(true);
      expect(Array.isArray(it.calcIds)).toBe(true);
      expect(Array.isArray(it.sourceIds)).toBe(true);
      expect(it.createdAt).toBe(`${AS_OF}T00:00:00.000Z`);
      if (it.amount !== undefined) expect(it.amount).toMatch(/^-?\d+\.\d{4}$/);
    }
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
  });

  it("runs a subset of monitors and persists the calculations they produced", async () => {
    const rt = await makeFixtureRuntime();
    const before = rt.dataset.calculations.length;
    const result = await runMonitors(rt, AS_OF, ["invoice_overdue", "unknown_transaction"]);
    expect(result.monitors.map((m) => m.key)).toEqual(["invoice_overdue", "unknown_transaction"]);
    expect(new Set(result.items.map((i) => i.kind))).toEqual(new Set(["invoice_overdue", "unknown_transaction"]));
    expect(result.monitors.every((m) => !m.error)).toBe(true);
    expect(result.calcs.length).toBeGreaterThan(0);
    expect(rt.dataset.calculations.length).toBe(before + result.calcs.length);
    for (const c of result.calcs) expect(rt.dataset.calculations.some((x) => x.id === c.id)).toBe(true);
  });

  it("never mutates the ledger or posts anything", async () => {
    const rt = await makeFixtureRuntime();
    const entries = JSON.stringify(rt.dataset.journalEntries);
    const txs = JSON.stringify(rt.dataset.transactions);
    await buildAttentionQueue(rt, AS_OF);
    expect(JSON.stringify(rt.dataset.journalEntries)).toBe(entries);
    expect(JSON.stringify(rt.dataset.transactions)).toBe(txs);
  });
});
