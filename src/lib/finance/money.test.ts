import { describe, expect, it } from "vitest";
import {
  addTotals,
  dollarsToCents,
  formatCents,
  formatTotal,
  known,
  monthlyEquivalent,
  percentOf,
  percentOfTotal,
  subtractTotals,
  sumAmounts,
  total,
  unknown,
} from "./money";

describe("money", () => {
  it("sums known amounts and keeps unknowns unknown", () => {
    const t = sumAmounts([known(1000), unknown("payroll tax rate not set"), known(250)]);
    expect(t.knownCents).toBe(1250);
    expect(t.unknowns).toEqual(["payroll tax rate not set"]);
    expect(t.complete).toBe(false);
  });

  it("never coerces an unknown to zero when formatting", () => {
    expect(formatTotal(total(1400000, ["income tax reserve rate not set"]))).toBe("$14,000 known · 1 unknown");
    expect(formatTotal(total(1400000))).toBe("$14,000");
  });

  it("propagates unknowns through subtraction", () => {
    const r = subtractTotals(total(3000000), total(800000, ["overhead unknown"]));
    expect(r.knownCents).toBe(2200000);
    expect(r.complete).toBe(false);
  });

  it("percentOf with a null rate is unknown, not zero", () => {
    const a = percentOf(known(600000), null, "withholding rate not set");
    expect(a.kind).toBe("unknown");
    const b = percentOf(known(600000), 25, "x");
    expect(b).toEqual(known(150000));
  });

  it("percentOfTotal refuses to compute on an incomplete base", () => {
    const a = percentOfTotal(total(100, ["x"]), 10, "tax");
    expect(a.kind).toBe("unknown");
  });

  it("normalizes cadences to monthly", () => {
    expect(monthlyEquivalent(known(120000), "annual")).toEqual(known(10000));
    expect(monthlyEquivalent(known(30000), "quarterly")).toEqual(known(10000));
    expect(monthlyEquivalent(known(2500), "weekly")).toEqual(known(Math.round((2500 * 52) / 12)));
    expect(monthlyEquivalent(known(999), "one_time")).toEqual(known(0));
    expect(monthlyEquivalent(unknown("?"), "annual").kind).toBe("unknown");
  });

  it("formats and parses dollars", () => {
    expect(formatCents(3000000)).toBe("$30,000");
    expect(formatCents(-150000)).toBe("−$1,500");
    expect(formatCents(123456, { cents: true })).toBe("$1,234.56");
    expect(dollarsToCents("$1,234.56")).toBe(123456);
    expect(dollarsToCents(3000)).toBe(300000);
  });

  it("addTotals accumulates unknown reasons", () => {
    const t = addTotals(total(1, ["a"]), total(2, ["b"]));
    expect(t.knownCents).toBe(3);
    expect(t.unknowns).toEqual(["a", "b"]);
  });
});
