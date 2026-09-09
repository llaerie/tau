import { describe, expect, it } from "vitest";
import { add, sub } from "@/lib/core/money";
import type { FixedAsset } from "@/lib/core/types";
import { accumulatedDepreciationThrough, buildDepreciationEntry, depreciationEntryExists, depreciationSchedule, netBookValue } from "@/lib/accounting/depreciation";
import { acct, actor, makeLedger } from "./fixture";

const asset = (over: Partial<FixedAsset> = {}): FixedAsset => ({
  id: "fa_1",
  name: "MacBook",
  acquiredDate: "2026-02-14",
  cost: "2999.99",
  salvageValue: "200.00",
  usefulLifeMonths: 36,
  method: "STRAIGHT_LINE",
  assetAccountId: acct("1500"),
  accumulatedDepreciationAccountId: acct("1590"),
  depreciationExpenseAccountId: acct("7700"),
  inServiceDate: "2026-02-14",
  taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED",
  ...over,
});

describe("Straight-line depreciation", () => {
  it("schedule sums exactly to cost − salvage with no rounding leakage", () => {
    const rows = depreciationSchedule(asset());
    expect(rows).toHaveLength(36);
    expect(rows[0].month).toBe("2026-02");
    expect(rows[35].month).toBe("2029-01");
    expect(add(...rows.map((r) => r.amount))).toBe(sub("2999.99", "200.00"));
    expect(rows[35].accumulated).toBe("2799.9900");
    expect(rows[35].netBookValue).toBe("200.0000");
    // Every monthly amount is a whole number of cents.
    expect(rows.every((r) => /^\d+\.\d{2}00$/.test(r.amount))).toBe(true);
    // Amounts differ by at most one cent.
    const cents = rows.map((r) => Math.round(Number(r.amount) * 100));
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
    expect(accumulatedDepreciationThrough(asset(), "2026-04")).toBe(add(rows[0].amount, rows[1].amount, rows[2].amount));
    expect(netBookValue(asset(), "2026-04")).toBe(sub("2999.99", accumulatedDepreciationThrough(asset(), "2026-04")));
  });

  it("handles zero-salvage, disposal and degenerate assets", () => {
    const rows = depreciationSchedule(asset({ cost: "1000", salvageValue: "0", usefulLifeMonths: 7 }));
    expect(add(...rows.map((r) => r.amount))).toBe("1000.0000");
    expect(rows.at(-1)!.netBookValue).toBe("0.0000");
    const disposed = depreciationSchedule(asset({ disposedDate: "2026-06-10" }));
    expect(disposed.map((r) => r.month)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05"]);
    expect(depreciationSchedule(asset({ cost: "100", salvageValue: "100" }))).toEqual([]);
    expect(depreciationSchedule(asset({ usefulLifeMonths: 0 }))).toEqual([]);
  });

  it("buildDepreciationEntry posts a balanced entry for all in-service assets and integrity holds", () => {
    const { ledger, ds } = makeLedger();
    ds.fixedAssets.push(asset(), asset({ id: "fa_2", name: "Desk", cost: "600", salvageValue: "0", usefulLifeMonths: 60, inServiceDate: "2026-01-05", assetAccountId: acct("1510") }));
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "10000" }, { accountCode: "3000", credit: "10000" }], post: true }, actor);
    ledger.createEntry({ date: "2026-01-05", description: "desk", source: "BANK_IMPORT", lines: [{ accountCode: "1510", debit: "600" }, { accountCode: "1000", credit: "600" }], post: true }, actor);
    ledger.createEntry({ date: "2026-02-14", description: "laptop", source: "BANK_IMPORT", lines: [{ accountCode: "1500", debit: "2999.99" }, { accountCode: "1000", credit: "2999.99" }], post: true }, actor);

    const jan = buildDepreciationEntry(ledger, "2026-01")!;
    expect(jan.lines).toHaveLength(2); // only the desk
    expect(jan.date).toBe("2026-01-31");
    expect(jan.source).toBe("DEPRECIATION");
    const feb = buildDepreciationEntry(ledger, "2026-02")!;
    expect(feb.lines).toHaveLength(4);
    expect(feb.sourceIds).toEqual(["fa_1", "fa_2"]);
    ledger.createEntry({ ...jan, post: true }, actor);
    ledger.createEntry({ ...feb, post: true }, actor);
    expect(depreciationEntryExists(ledger, "2026-02")).toBe(true);
    expect(depreciationEntryExists(ledger, "2026-03")).toBe(false);
    expect(buildDepreciationEntry(ledger, "2025-12")).toBeNull();

    const expected = add(depreciationSchedule(asset())[0].amount, "10.00", "10.00");
    expect(ledger.accountBalance(acct("7700"), "2026-02-28")).toBe(expected);
    expect(ledger.accountBalance(acct("1590"), "2026-02-28")).toBe(sub("0", expected));
    const report = ledger.runIntegrityChecks("2026-02-28");
    expect(report.checks.find((c) => c.key === "accumulated-depreciation")!.passed).toBe(true);
    expect(report.passed).toBe(true);
    expect(ledger.balanceSheet("2026-02-28").balanced).toBe(true);

    // Over-depreciation is caught.
    ledger.createEntry({ date: "2026-02-28", description: "bogus", source: "ADJUSTING", lines: [{ accountCode: "7700", debit: "5000" }, { accountCode: "1590", credit: "5000" }], post: true }, actor);
    expect(ledger.runIntegrityChecks("2026-02-28").checks.find((c) => c.key === "accumulated-depreciation")!.passed).toBe(false);
  });
});
