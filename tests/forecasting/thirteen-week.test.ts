import { describe, expect, it } from "vitest";
import { D, add, sub } from "@/lib/core/money";
import { buildThirteenWeekForecast, delayedReceiptScenario, flowsFromDataset, stressTest, type ScheduledFlow, type ThirteenWeekInput } from "@/lib/forecasting/thirteen-week";
import { AS_OF, buildFixtureDataset } from "./fixture";

const flow = (id: string, date: string, amount: string, category: ScheduledFlow["category"] = "OTHER", confidence: ScheduledFlow["confidence"] = "EXPECTED"): ScheduledFlow => ({ id, label: id, date, amount, category, confidence, sourceIds: [`src_${id}`] });

const input: ThirteenWeekInput = {
  asOfDate: AS_OF, // Wednesday 2026-09-09
  openingCash: "20000",
  receipts: [
    flow("r_overdue", "2026-09-01", "3000", "REVENUE"), // before asOf → week 0, overdue
    flow("r_w1", "2026-09-18", "8000", "REVENUE"),
    flow("r_w5", "2026-10-15", "12000", "REVENUE"),
    flow("r_far", "2027-01-15", "50000", "REVENUE"), // beyond horizon → excluded
  ],
  disbursements: [
    flow("d_pay_w1", "2026-09-15", "9000", "PAYROLL", "CONFIRMED"),
    flow("d_tax_w1", "2026-09-15", "2000", "PAYROLL_TAX"),
    flow("d_pay_w3", "2026-09-30", "9000", "PAYROLL", "CONFIRMED"),
    flow("d_rent_w3", "2026-10-01", "2000", "RENT"),
    flow("d_pay_w5", "2026-10-15", "9000", "PAYROLL", "CONFIRMED"),
    flow("d_w12", "2026-12-04", "1000", "SOFTWARE"),
  ],
  minimumCash: "5000",
  assumptions: [],
};

describe("buildThirteenWeekForecast", () => {
  it("weeks start on Monday and the horizon is 13 weeks", () => {
    const f = buildThirteenWeekForecast(input);
    expect(f.rows).toHaveLength(13);
    expect(f.rows[0].weekStart).toBe("2026-09-07");
    expect(f.rows[0].weekEnd).toBe("2026-09-13");
    expect(f.rows[12].weekStart).toBe("2026-11-30");
    expect(f.rows[12].weekEnd).toBe("2026-12-06");
  });

  it("ending cash of the final week = opening + sum receipts - sum disbursements (in-horizon flows)", () => {
    const f = buildThirteenWeekForecast(input);
    const receipts = ["3000", "8000", "12000"].reduce((a, b) => add(a, b), "0");
    const disb = ["9000", "2000", "9000", "2000", "9000", "1000"].reduce((a, b) => add(a, b), "0");
    expect(f.endingCash).toBe(add(sub(add("20000", receipts), disb), 0));
    expect(f.rows[12].closingCash).toBe(f.endingCash);
    expect(f.totalReceipts).toBe(D(receipts).toFixed(4));
    expect(f.totalDisbursements).toBe(D(disb).toFixed(4));
    expect(f.excludedFlows.map((x) => x.id)).toEqual(["r_far"]);
    // chain integrity
    for (let i = 1; i < f.rows.length; i++) expect(f.rows[i].openingCash).toBe(f.rows[i - 1].closingCash);
  });

  it("finds the lowest cash week and weeks below minimum", () => {
    const f = buildThirteenWeekForecast(input);
    // w0: 20000+3000 = 23000; w1: +8000 -11000 = 20000; w2: 20000; w3: -9000 -2000 = 9000; w4: 9000; w5: +12000 -9000 = 12000 ... w12: -1000 = 11000
    expect(f.rows[0].closingCash).toBe("23000.0000");
    expect(f.rows[1].closingCash).toBe("20000.0000");
    expect(f.rows[3].closingCash).toBe("9000.0000");
    expect(f.lowestCash).toBe("9000.0000");
    expect(f.lowestCashWeek).toBe(3);
    expect(f.lowestCashWeekStart).toBe("2026-09-28");
    expect(f.weeksBelowMinimum).toBe(0);
    const tight = buildThirteenWeekForecast({ ...input, minimumCash: "10000" });
    expect(tight.weeksBelowMinimum).toBe(2); // weeks 3 and 4 at 9000
    expect(tight.firstWeekBelowMinimum).toBe(3);
    expect(tight.rows[3].belowMinimum).toBe(true);
  });

  it("overdue receipts land in week 0 and are flagged; categories are broken out", () => {
    const f = buildThirteenWeekForecast(input);
    expect(f.rows[0].overdueFlowIds).toEqual(["r_overdue"]);
    expect(f.rows[1].disbursementsByCategory.PAYROLL).toBe("9000.0000");
    expect(f.rows[1].disbursementsByCategory.PAYROLL_TAX).toBe("2000.0000");
    expect(f.calc.notes?.some((n) => n.includes("overdue"))).toBe(true);
    expect(f.calc.sourceIds).toContain("src_r_w1");
    expect(f.calc.value.endingCash).toBe(f.endingCash);
  });

  it("unknown minimum cash → weeksBelowMinimum null with INSUFFICIENT_INFORMATION (never zero)", () => {
    const f = buildThirteenWeekForecast({ ...input, minimumCash: null });
    expect(f.weeksBelowMinimum).toBeNull();
    expect(f.rows[0].belowMinimum).toBeNull();
    expect(f.calc.notes?.some((n) => n.startsWith("INSUFFICIENT_INFORMATION"))).toBe(true);
    expect(f.assumptions.some((a) => a.key === "minimum_cash_reserve" && a.status === "UNCONFIRMED")).toBe(true);
  });

  it("delayed receipt scenario lowers the minimum cash", () => {
    const base = buildThirteenWeekForecast(input);
    const delayed = delayedReceiptScenario(input, 30);
    expect(D(delayed.lowestCash).lt(D(base.lowestCash))).toBe(true);
    // overdue 3000 → Oct 1 (week 3), 8000 → Oct 18 (week 5) where 9000 payroll also falls: week 5 closes at 0
    expect(delayed.rows[3].closingCash).toBe("1000.0000");
    expect(delayed.lowestCash).toBe("0.0000");
    expect(delayed.lowestCashWeek).toBe(5);
    expect(delayed.assumptions.some((a) => a.key === "scenario:delayed_receipts")).toBe(true);
    const onlyOne = delayedReceiptScenario(input, 30, ["r_w5"]);
    expect(onlyOne.rows[1].receipts).toBe("8000.0000"); // untouched
    expect(onlyOne.rows[5].receipts).toBe("0.0000");
  });

  it("stress test applies a haircut and an extra disbursement", () => {
    const s = stressTest(input, { receiptHaircut: 0.25, extraDisbursement: { amount: "4000", date: "2026-09-10", category: "TAX" } });
    expect(s.totalReceipts).toBe(D("23000").times(0.75).toFixed(4));
    expect(s.rows[0].disbursementsByCategory.TAX).toBe("4000.0000");
    expect(D(s.endingCash).lt(D(buildThirteenWeekForecast(input).endingCash))).toBe(true);
    expect(s.rows[1].receiptsByConfidence.ASSUMED).toBe("6000.0000");
  });

  it("precision: many fractional flows sum exactly", () => {
    const receipts = Array.from({ length: 50 }, (_, i) => flow(`p${i}`, "2026-09-10", "0.1"));
    const f = buildThirteenWeekForecast({ ...input, receipts, disbursements: [], openingCash: "0" });
    expect(f.endingCash).toBe("5.0000");
  });
});

describe("flowsFromDataset", () => {
  const ds = buildFixtureDataset();
  const derived = flowsFromDataset(ds, AS_OF);

  it("open invoices → EXPECTED receipts on due date; void/paid excluded", () => {
    const ids = derived.receipts.map((r) => r.id);
    expect(ids).toContain("rcpt_inv_inv_aug");
    expect(ids).toContain("rcpt_inv_inv_extra");
    expect(ids).not.toContain("rcpt_inv_inv_void");
    expect(ids).not.toContain("rcpt_inv_inv_jun");
    const aug = derived.receipts.find((r) => r.id === "rcpt_inv_inv_aug")!;
    expect(aug.date).toBe("2026-08-31");
    expect(aug.amount).toBe("10000.0000");
    expect(aug.confidence).toBe("EXPECTED");
    expect(aug.sourceIds).toEqual(["inv_aug"]);
  });

  it("recurring revenue is ASSUMED only for months not yet invoiced", () => {
    const withMrr = flowsFromDataset(ds, AS_OF, { recurringRevenue: { monthlyAmount: "10000", dayOfMonth: 15 } });
    const mrr = withMrr.receipts.filter((r) => r.id.startsWith("rcpt_mrr_"));
    // Sep, Oct, Nov within horizon (Dec 15 is past Dec 6); Aug already invoiced
    expect(mrr.map((r) => r.date)).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
    expect(mrr.every((r) => r.confidence === "ASSUMED")).toBe(true);
    expect(derived.receipts.some((r) => r.id.startsWith("rcpt_mrr_"))).toBe(false); // no active forecast → none
    expect(derived.notes.some((n) => n.includes("No recurring revenue assumption"))).toBe(true);
  });

  it("open bills → AP; far bills excluded from horizon at build time; paid excluded", () => {
    const ap = derived.disbursements.filter((d) => d.category === "AP");
    expect(ap.map((d) => d.id)).toEqual(["disb_bill_bill_open", "disb_bill_bill_far"]);
    expect(ap[0].date).toBe("2026-09-25");
    const f = buildThirteenWeekForecast({ asOfDate: AS_OF, openingCash: "100000", receipts: derived.receipts, disbursements: derived.disbursements, minimumCash: null, assumptions: derived.assumptions });
    expect(f.excludedFlows.map((x) => x.id)).toContain("disb_bill_bill_far");
  });

  it("payroll pattern detected as semi-monthly and projected with tax deposits", () => {
    const pay = derived.disbursements.filter((d) => d.category === "PAYROLL");
    expect(pay.map((d) => d.date)).toEqual(["2026-09-15", "2026-09-30", "2026-10-15", "2026-10-31", "2026-11-15", "2026-11-30"]);
    expect(pay.every((d) => d.amount === "3500.0000" && d.confidence === "ASSUMED")).toBe(true);
    const tax = derived.disbursements.filter((d) => d.category === "PAYROLL_TAX");
    expect(tax.find((d) => d.id === "disb_payroll_tax_2026-09-15")?.amount).toBe("1350.0000");
    expect(tax.find((d) => d.id === "disb_pliab_pl_1")?.amount).toBe("900.0000");
    expect(derived.assumptions.some((a) => a.key === "payroll_pattern" && a.requiresProfessionalReview)).toBe(true);
    expect(derived.assumptions.some((a) => a.key === "payroll_liabilities_unknown_due")).toBe(true);
  });

  it("recurring vendor charges (≥3 months, same merchant) → SOFTWARE / RENT; one-offs, payroll and transfers ignored", () => {
    const gh = derived.disbursements.filter((d) => d.label === "Recurring: github");
    expect(gh.map((d) => d.date)).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
    expect(gh[0].category).toBe("SOFTWARE");
    expect(gh[0].amount).toBe("100.0000");
    const ww = derived.disbursements.filter((d) => d.label === "Recurring: wework");
    expect(ww.map((d) => d.date)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(ww[0].category).toBe("RENT");
    expect(ww[0].amount).toBe("2000.0000"); // median of 2000, 2100, 2000, 2000
    expect(derived.disbursements.some((d) => d.label.includes("apple"))).toBe(false);
    expect(derived.disbursements.some((d) => d.label.includes("gusto"))).toBe(false);
    expect(derived.disbursements.some((d) => d.label.includes("transfer"))).toBe(false);
  });

  it("tax obligations with known due date and amount → TAX; unknowns become assumptions, never zero", () => {
    const tax = derived.disbursements.filter((d) => d.category === "TAX");
    expect(tax).toHaveLength(1);
    expect(tax[0].id).toBe("disb_tax_t_q3");
    expect(tax[0].amount).toBe("800.0000");
    expect(derived.assumptions.find((a) => a.key === "tax_obligation:t_unknown_amount")?.description).toContain("amount unknown");
    expect(derived.assumptions.find((a) => a.key === "tax_obligation:t_unknown_due")?.description).toContain("due date unknown");
  });
});
