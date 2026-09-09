import { describe, expect, it } from "vitest";
import { insufficient, makeCalc } from "@/lib/finance/calc-result";
import { compareScenarios } from "@/lib/finance/scenario";
import { deterministicId, fingerprint } from "@/lib/core/ids";

describe("makeCalc", () => {
  it("builds deterministic ids, fingerprints and normalizes inputs", () => {
    const a = makeCalc({ name: "x", value: 1, unit: "RATIO", formula: "f", inputs: { a: 1, b: "2.5000", c: undefined }, asOfDate: "2026-09-09", sourceIds: ["s", "s"] });
    expect(a.id).toBe(deterministicId("calc", "x", fingerprint({ a: 1, b: "2.5000", c: null })));
    expect(a.fingerprint).toBe(fingerprint({ formula: "f", inputs: { a: 1, b: "2.5000", c: null } }));
    expect(a.sourceIds).toEqual(["s"]);
    expect(a.assumptions).toEqual([]);
    expect(a.notes).toBeUndefined();
  });
  it("insufficient() never substitutes zero", () => {
    const r = insufficient({ name: "y", unit: "USD", formula: "f", inputs: { cash: null }, asOfDate: "2026-09-09", missing: ["cash balance", "policy"] });
    expect(r.value).toBeNull();
    expect(r.notes).toEqual(["INSUFFICIENT_INFORMATION: cash balance; policy"]);
    expect(r.assumptions.map((a) => a.status)).toEqual(["UNCONFIRMED", "UNCONFIRMED"]);
  });
});

describe("compareScenarios", () => {
  const base = { id: "base", label: "Base", openingCash: "100000", months: [
    { month: "2026-10", netCashFlow: "-10000" }, { month: "2026-11", netCashFlow: "-10000" }, { month: "2026-12", netCashFlow: "5000" },
  ] };
  const downside = { id: "down", label: "Lost client", openingCash: "100000", months: [
    { month: "2026-10", netCashFlow: "-30000" }, { month: "2026-11", netCashFlow: "-30000" }, { month: "2026-12", netCashFlow: "-30000" },
  ] };
  const upside = { id: "up", label: "New client", openingCash: "100000", months: [
    { month: "2026-10", netCashFlow: "-10000" }, { month: "2026-11", netCashFlow: "0" }, { month: "2026-12", netCashFlow: "20000" },
  ] };
  it("computes ending / cumulative / min cash and deltas", () => {
    const r = compareScenarios(base, [downside, upside], { asOfDate: "2026-09-30" });
    const v = r.value;
    expect(v.base.endingCash).toBe("85000.0000");
    expect(v.base.cumulativeNet).toBe("-15000.0000");
    expect(v.base.minCash).toBe("80000.0000");
    expect(v.base.minCashMonth).toBe("2026-11");
    const down = v.scenarios.find((s) => s.id === "down")!;
    expect(down.endingCash).toBe("10000.0000");
    expect(down.endingCashDelta).toBe("-75000.0000");
    expect(down.minCash).toBe("10000.0000");
    expect(down.minCashMonth).toBe("2026-12");
    const up = v.scenarios.find((s) => s.id === "up")!;
    expect(up.endingCash).toBe("110000.0000");
    expect(up.minCashDelta).toBe("10000.0000");
    expect(v.rows[1].scenarios.down.cashDelta).toBe("-40000.0000");
    expect(v.rows[0].scenarios.up.netDelta).toBe("0.0000");
    expect(r.unit).toBe("TABLE");
  });
  it("notes cash-negative scenarios", () => {
    const r = compareScenarios(base, [{ ...downside, openingCash: "50000" }], { asOfDate: "2026-09-30" });
    expect(r.notes?.[0]).toContain("goes cash-negative");
  });
});
