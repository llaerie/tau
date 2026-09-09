import { describe, expect, it } from "vitest";
import { annuityPayment, breakEven, breakEvenRevenue, contributionMargin, irr, npv, paybackPeriod, profitabilityIndex, roi, wacc } from "@/lib/finance/corporate-finance";
import { D } from "@/lib/core/money";

const meta = { asOfDate: "2026-09-09", sourceIds: ["src_test"] };

describe("npv / irr (textbook values)", () => {
  it("NPV of [-1000, 500, 500, 500] at 10% = 243.43", () => {
    const r = npv(0.1, ["-1000", "500", "500", "500"], meta);
    expect(r.value).not.toBeNull();
    expect(D(r.value as string).toDecimalPlaces(2).toString()).toBe("243.43");
    expect(r.unit).toBe("USD");
    expect(r.formula).toContain("(1 + rate)^t");
    expect(r.id).toMatch(/^calc_/);
    expect(r.fingerprint).toHaveLength(24);
    expect(r.sourceIds).toEqual(["src_test"]);
  });

  it("IRR of [-1000, 500, 500, 500] ≈ 23.38%", () => {
    const r = irr(["-1000", "500", "500", "500"], meta);
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeCloseTo(0.2338, 4);
    expect(r.unit).toBe("PERCENT");
  });

  it("IRR falls back to bisection when Newton diverges and still finds the root", () => {
    const r = irr(["-1000", "500", "500", "500"], meta, { guess: 50 });
    expect(r.value as number).toBeCloseTo(0.2338, 3);
  });

  it("IRR returns null with a note when there is no sign change", () => {
    const r = irr(["100", "200", "300"], meta);
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toContain("No sign change");
  });

  it("NPV with an unknown cash flow → null + INSUFFICIENT_INFORMATION", () => {
    const r = npv(0.1, ["-1000", null, "500"], meta);
    expect(r.value).toBeNull();
    expect(r.notes?.[0]).toMatch(/^INSUFFICIENT_INFORMATION: cash flow at t=1/);
    expect(r.assumptions[0].status).toBe("UNCONFIRMED");
  });

  it("is deterministic: same inputs → same id and fingerprint", () => {
    const a = npv(0.1, ["-1000", "500", "500", "500"], meta);
    const b = npv(0.1, [-1000, 500, 500, 500], meta);
    expect(a.id).toBe(b.id);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("payback", () => {
  it("simple payback is fractional", () => {
    const r = paybackPeriod(["-1000", "400", "400", "400"], meta);
    expect(r.value?.simple).toBe(2.5);
    expect(r.value?.discounted).toBeNull();
    expect(r.notes?.some((n) => n.includes("no discount rate"))).toBe(true);
  });
  it("discounted payback is longer than simple", () => {
    const r = paybackPeriod(["-1000", "500", "500", "500"], meta, { rate: 0.1 });
    expect(r.value?.simple).toBe(2);
    // PV: 454.55, 413.22, 375.66 → cumulative -132.23 after t2 → 2 + 132.23 / 375.66
    expect(r.value?.discounted as number).toBeCloseTo(2.352, 3);
    // at 10% the 400/400/400 stream never recovers 1000 in PV terms
    expect(paybackPeriod(["-1000", "400", "400", "400"], meta, { rate: 0.1 }).value?.discounted).toBeNull();
  });
  it("never pays back → null", () => {
    const r = paybackPeriod(["-1000", "100", "100"], meta);
    expect(r.value?.simple).toBeNull();
  });
});

describe("break-even / contribution margin / ROI / PI / annuity / WACC", () => {
  it("break-even units = fixed / (price - variable)", () => {
    const r = breakEven({ fixedCosts: "10000", pricePerUnit: "50", variableCostPerUnit: "30" }, meta);
    expect(r.value).toBe(500);
    expect(r.unit).toBe("COUNT");
  });
  it("break-even unreachable when contribution margin <= 0", () => {
    expect(breakEven({ fixedCosts: "10000", pricePerUnit: "30", variableCostPerUnit: "30" }, meta).value).toBeNull();
  });
  it("break-even revenue = fixed / CM ratio", () => {
    expect(breakEvenRevenue({ fixedCosts: "10000", contributionMarginRatio: 0.4 }, meta).value).toBe("25000.0000");
  });
  it("contribution margin amount and ratio", () => {
    const r = contributionMargin({ revenue: "100000", variableCosts: "35000" }, meta);
    expect(r.value?.amount).toBe("65000.0000");
    expect(r.value?.ratio).toBe(0.65);
  });
  it("roi", () => {
    expect(roi({ gain: "1500", cost: "1000" }, meta).value).toBe(0.5);
  });
  it("profitability index of [-1000, 500, 500, 500] at 10% ≈ 1.2434", () => {
    expect(profitabilityIndex(0.1, ["-1000", "500", "500", "500"], meta).value as number).toBeCloseTo(1.2434, 4);
  });
  it("annuity payment: 100000 at 0.5%/month over 360 = 599.55", () => {
    const r = annuityPayment({ principal: "100000", ratePerPeriod: 0.005, periods: 360 }, meta);
    expect(D(r.value as string).toDecimalPlaces(2).toString()).toBe("599.55");
    expect(annuityPayment({ principal: "1200", ratePerPeriod: 0, periods: 12 }, meta).value).toBe("100.0000");
  });
  it("wacc with all inputs, and null with note when any input is unknown", () => {
    const ok = wacc({ equityValue: "600", debtValue: "400", costOfEquity: 0.12, costOfDebt: 0.06, taxRate: 0.25 }, meta);
    expect(ok.value as number).toBeCloseTo(0.6 * 0.12 + 0.4 * 0.06 * 0.75, 8);
    expect(ok.assumptions.some((a) => a.requiresProfessionalReview)).toBe(true);
    const bad = wacc({ equityValue: "600", debtValue: "400", costOfEquity: null, costOfDebt: 0.06, taxRate: 0.25 }, meta);
    expect(bad.value).toBeNull();
    expect(bad.notes?.[0]).toContain("INSUFFICIENT_INFORMATION: cost of equity");
  });
});
