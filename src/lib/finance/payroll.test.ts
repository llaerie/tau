import { describe, expect, it } from "vitest";
import { known, unknown } from "./money";
import { computeTakeHome, employerPayrollCost, PAYROLL_RULES_2026 } from "./payroll";
import { total } from "./money";

describe("take-home pay", () => {
  it("subtracts FICA and SDI from gross; income tax remains unknown when not estimated", () => {
    const r = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: null, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "none" });
    expect(r.fica).toEqual(known(22950));
    expect(r.sdi).toEqual(known(3900));
    // 3,000 − 229.50 − 39 = 2,731.50 before income tax
    expect(r.beforeIncomeTax.knownCents).toBe(273150);
    expect(r.beforeIncomeTax.complete).toBe(true);
    expect(r.takeHome.complete).toBe(false);
    expect(r.status).toBe("incomplete");
    expect(r.verified).toBe(false);
  });

  it("a configured income-tax estimate produces an estimate, never a verified paycheck", () => {
    const r = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000, source: "estimate" });
    expect(r.takeHome.knownCents).toBe(248150);
    expect(r.status).toBe("estimate");
    expect(r.verified).toBe(false);
    expect(r.rangeCents).toEqual([273150 - 35000, 273150 - 15000]);
    expect(r.assumptions.join(" ")).toMatch(/Not a verified paycheck/);
  });

  it("a FICA-only result is never marked verified, and pay-stub values are", () => {
    const fica = computeTakeHome(known(300000), { ...PAYROLL_RULES_2026, sdiPct: null }, { incomeTaxCents: 25000, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "estimate" });
    expect(fica.verified).toBe(false);
    expect(fica.takeHome.complete).toBe(false);
    expect(fica.takeHome.unknowns).toContain("California SDI rate not set");
    const stub = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: 26100, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "paystub" });
    expect(stub.verified).toBe(true);
    expect(stub.status).toBe("verified");
  });

  it("withholding is never an extra expense: gross − withholding = take-home, nothing else", () => {
    const r = computeTakeHome(known(300000), PAYROLL_RULES_2026, { incomeTaxCents: 25000, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "estimate" });
    const withheld = 22950 + 3900 + 25000;
    expect(r.takeHome.knownCents + withheld).toBe(300000);
  });

  it("employer costs are separate and can be unknown", () => {
    expect(employerPayrollCost(total(600000), null).kind).toBe("unknown");
    expect(employerPayrollCost(total(600000), 10)).toEqual(known(60000));
    expect(employerPayrollCost(total(0, ["salary missing"]), 10).kind).toBe("unknown");
  });

  it("unknown gross stays unknown", () => {
    const r = computeTakeHome(unknown("not set"), PAYROLL_RULES_2026, { incomeTaxCents: 25000, incomeTaxLowCents: null, incomeTaxHighCents: null, source: "estimate" });
    expect(r.takeHome.complete).toBe(false);
    expect(r.beforeIncomeTax.knownCents).toBe(0);
  });
});
