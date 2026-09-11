import { describe, expect, it } from "vitest";
import { computeCashPlan, PARTIAL_LABEL, type CashPlanInput } from "./cashplan";
import { known, total, unknown } from "./money";

const base: CashPlanInput = {
  month: "2026-10",
  recordedCash: total(4200000),
  cashAsOf: "2026-09-11",
  expectedRevenue: known(3000000),
  revenueBasis: "anticipated",
  receivedThisMonthCents: 0,
  grossWages: [
    { name: "Will", gross: known(300000) },
    { name: "Arielle", gross: known(300000) },
  ],
  employerPayrollCostRatePct: null,
  companyPaidBills: [
    { id: "rent", name: "Apartment rent", amount: known(580000), cadence: "monthly", dueDay: 1, beneficiary: "household", purpose: "personal", treatment: "review_required", paidThisPeriod: false },
    { id: "tesla", name: "Two Teslas", amount: known(120000), cadence: "monthly", dueDay: 15, beneficiary: "household", purpose: "personal", treatment: "review_required", paidThisPeriod: false },
  ],
  subscriptions: [
    { id: "c1", provider: "Anthropic", product: "Claude", tier: null, quantity: 2, unitPrice: unknown("tier to confirm"), interval: "monthly", kind: "subscription", status: "planned" },
    { id: "o1", provider: "OpenAI", product: "ChatGPT", tier: null, quantity: 2, unitPrice: unknown("tier to confirm"), interval: "monthly", kind: "subscription", status: "planned" },
    { id: "api", provider: "Anthropic", product: "API usage", tier: null, quantity: 1, unitPrice: unknown("metered"), interval: "monthly", kind: "api_usage", status: "active" },
  ],
  apiUsageLastMonthCents: 18400,
  otherOverhead: unknown("not entered"),
  purchasePlans: [
    { id: "mac", name: "Mac mini", price: known(200000), targetMonth: "2026-10", status: "planned", beneficiary: "company", purpose: "business" },
    { id: "sofa", name: "Sofa", price: known(300000), targetMonth: "2026-11", status: "planned", beneficiary: "household", purpose: "personal" },
  ],
  taxReserve: { ratePct: null, reviewStatus: "unreviewed", note: "Needs source, year and review." },
  cashReserveTargetMonths: null,
};

describe("company cash plan", () => {
  it("computes the partial remainder with its exact label and never as safe-to-spend cash", () => {
    const r = computeCashPlan(base);
    // 30,000 − 6,000 − 5,800 − 1,200 = 17,000 before unlisted costs
    expect(r.partialRemainder.total.knownCents).toBe(1700000);
    expect(r.partialRemainder.total.complete).toBe(false);
    expect(r.partialRemainder.label).toBe(PARTIAL_LABEL);
    expect(r.partialRemainder.provenance.assumptions[0]).toMatch(/not safe-to-spend/);
    expect(r.unknownCosts).toContain("Employer payroll taxes and payroll-provider fees");
    expect(r.unknownCosts.some((u) => /taxes/i.test(u))).toBe(true);
  });

  it("only two $3,000 salaries are in the forward plan and no $8,000 allocation exists", () => {
    const r = computeCashPlan(base);
    const wages = r.lines.find((l) => l.id === "wages")!;
    expect(wages.amount).toEqual(known(600000));
    expect(r.lines.some((l) => /allocation/i.test(l.label))).toBe(false);
    expect(JSON.stringify(r.lines)).not.toMatch(/800000/);
  });

  it("uses rent $5,800 and Teslas $1,200 as company-paid household costs, counted once and not as business expenses", () => {
    const r = computeCashPlan(base);
    expect(r.householdViaCompany.knownCents).toBe(700000);
    const rent = r.lines.find((l) => l.id === "bill-rent")!;
    expect(rent.group).toBe("household_via_company");
    expect(rent.note).toMatch(/review required/);
    expect(r.knownCommitments.total.knownCents).toBe(600000 + 700000);
  });

  it("no flat $5,000 tax and no zero-tax fallback", () => {
    const r = computeCashPlan(base);
    const tax = r.lines.find((l) => l.id === "tax")!;
    expect(tax.amount.kind).toBe("unknown");
    expect(JSON.stringify(r)).not.toMatch(/500000/);
    const withRate = computeCashPlan({ ...base, taxReserve: { ratePct: 20, reviewStatus: "unreviewed", note: "" } });
    expect(withRate.lines.find((l) => l.id === "tax")!.amount.kind).toBe("unknown");
  });

  it("subscriptions with unconfirmed tiers stay unknown and API usage is separate", () => {
    const r = computeCashPlan(base);
    expect(r.subscriptionsTotal.complete).toBe(false);
    expect(r.subscriptionsTotal.unknowns).toHaveLength(3);
    expect(r.lines.find((l) => l.id === "api-actual")!.amount).toEqual(known(18400));
    const priced = computeCashPlan({ ...base, subscriptions: [{ ...base.subscriptions[0], tier: "Max 5x", unitPrice: known(10000) }] });
    expect(priced.subscriptionsTotal.knownCents).toBe(20000);
  });

  it("one-time purchases affect only their target month", () => {
    const oct = computeCashPlan(base);
    expect(oct.oneTimeThisMonth.knownCents).toBe(200000);
    expect(oct.lines.filter((l) => l.group === "one_time")).toHaveLength(1);
    const nov = computeCashPlan({ ...base, month: "2026-11" });
    expect(nov.oneTimeThisMonth.knownCents).toBe(300000);
    const dec = computeCashPlan({ ...base, month: "2026-12" });
    expect(dec.oneTimeThisMonth.knownCents).toBe(0);
    // One-time plans are never part of the recurring remainder.
    expect(oct.partialRemainder.total.knownCents).toBe(nov.partialRemainder.total.knownCents);
  });

  it("expected revenue is not received cash", () => {
    const r = computeCashPlan(base);
    expect(r.expectedReceipts.total.knownCents).toBe(3000000);
    expect(r.receivedSoFar.total.knownCents).toBe(0);
    expect(r.recordedCash.total.knownCents).toBe(4200000);
  });

  it("runway uses recorded cash and known costs only; unknown cash yields no runway", () => {
    expect(computeCashPlan(base).runwayMonthsOnKnownCosts).toBe(3);
    expect(computeCashPlan({ ...base, recordedCash: total(0, ["balance missing"]) }).runwayMonthsOnKnownCosts).toBeNull();
  });
});
