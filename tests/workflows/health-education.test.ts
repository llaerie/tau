import { describe, expect, it } from "vitest";
import { educationForContext, financialHealth } from "@/lib/workflows";
import { AS_OF, makeFixtureRuntime } from "./fixture";

describe("financial health", () => {
  it("returns null (not zero) for the unknown cash reserve and carries calc ids", async () => {
    const rt = await makeFixtureRuntime();
    const h = await financialHealth(rt, AS_OF);
    expect(rt.thresholds.minimumCashReserve).toBeNull();
    expect(h.cash.minimumReserve).toBeNull();
    expect(h.cash.surplus).toBeNull();
    expect(h.cash.reserveStatus).toBe("UNKNOWN");
    expect(h.cash.status).toBe("WATCH");
    expect(h.cash.value).toBe(rt.ledger.balanceSheet(AS_OF).cash);
    for (const key of ["cash", "runwayMonths", "arOverdue", "integrityPassed", "unknownConfigCount", "openApprovals", "budgetVariance"] as const) {
      expect(h[key].calcId).toMatch(/^calc_/);
      expect(["GOOD", "WATCH", "ACTION"]).toContain(h[key].status);
      expect(rt.dataset.calculations.some((c) => c.id === h[key].calcId)).toBe(true);
    }
    expect(h.arOverdue.value).toBe("30000.0000");
    expect(h.arOverdue.count).toBe(1);
    expect(h.integrityPassed.value).toBe(true);
    expect(h.unknownConfigCount.value).toBeGreaterThan(0);
    expect(h.openApprovals.value).toBe(0);
    expect(h.budgetVariance.value).not.toBeNull();
    expect(typeof h.runwayMonths.value === "number" || h.runwayMonths.value === null).toBe(true);
    expect(h.isSyntheticData).toBe(true);
  });

  it("reports budget variance as null when no approved budget exists", async () => {
    const rt = await makeFixtureRuntime();
    rt.dataset.budgets.length = 0;
    const h = await financialHealth(rt, AS_OF);
    expect(h.budgetVariance.value).toBeNull();
    expect(h.budgetVariance.budgetId).toBeNull();
    expect(h.budgetVariance.status).toBe("WATCH");
  });
});

describe("education for context", () => {
  it("picks at most one snippet by concept key, then topic, then loose match", () => {
    expect(educationForContext(["cash_runway"])?.key).toBe("cash_runway");
    expect(educationForContext(["nothing", "period_lock"])?.key).toBe("period_lock");
    expect(educationForContext(["payroll"])?.key).toBe("gross_vs_net");
    expect(educationForContext(["Runway"])?.key).toBe("cash_runway");
    expect(educationForContext(["zzz_unknown"])).toBeUndefined();
    expect(educationForContext([])).toBeUndefined();
    const note = educationForContext(["thirteen_week_cash"])!;
    expect(note.title).toMatch(/13-week/);
    expect(note.text.length).toBeGreaterThan(50);
  });
});
