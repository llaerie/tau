import { describe, expect, it } from "vitest";
import { accountBalance, billStatuses, monthPeriod, summarizeFlows, type LedgerTransaction } from "./classify";

const scope = { accountIds: new Set(["chk", "card", "sav"]) };
const period = monthPeriod("2026-09");

const txns: LedgerTransaction[] = [
  { id: "1", date: "2026-09-01", amountCents: 225000, kind: "income", accountId: "chk", description: "Payroll (net)" },
  { id: "2", date: "2026-09-01", amountCents: 75000, kind: "payroll_withholding", accountId: "chk", description: "Withholding" },
  { id: "3", date: "2026-09-03", amountCents: 12000, kind: "expense", accountId: "card", description: "Groceries" },
  { id: "4", date: "2026-09-10", amountCents: 12000, kind: "cc_payment", accountId: "chk", counterAccountId: "card", description: "Card payment" },
  { id: "5", date: "2026-09-12", amountCents: 50000, kind: "savings_allocation", accountId: "chk", counterAccountId: "sav", description: "Travel fund" },
  { id: "6", date: "2026-09-15", amountCents: 80000, kind: "transfer", accountId: "chk", counterAccountId: "house-chk", description: "Household contribution" },
  { id: "7", date: "2026-09-20", amountCents: 6000, kind: "bill_payment", accountId: "chk", billId: "phone", description: "Phone bill" },
  { id: "8", date: "2026-08-20", amountCents: 6000, kind: "bill_payment", accountId: "chk", billId: "phone", description: "Phone bill (last month)" },
  { id: "9", date: "2026-09-21", amountCents: 999, kind: "expense", accountId: "other", description: "Not in scope" },
];

describe("single-count flow summary", () => {
  it("does not double count card payments, internal transfers, withholding or savings", () => {
    const s = summarizeFlows(txns, scope, period);
    expect(s.incomeCents).toBe(225000);
    expect(s.spendingCents).toBe(12000 + 6000);
    expect(s.excluded.ccPaymentsCents).toBe(12000);
    expect(s.excluded.internalTransfersCents).toBe(50000);
    expect(s.savingsAllocatedCents).toBe(50000);
    expect(s.withholdingCents).toBe(75000);
    expect(s.contributionsOutCents).toBe(80000);
    expect(s.netCashFlowCents).toBe(225000 - 18000 - 80000);
    expect(s.transactionCount).toBe(7);
  });

  it("counts a cross-space transfer as a contribution in for the receiving scope", () => {
    const s = summarizeFlows(txns, { accountIds: new Set(["house-chk"]) }, period);
    expect(s.contributionsInCents).toBe(80000);
    expect(s.spendingCents).toBe(0);
  });

  it("marks a paid bill so it is not counted again as committed", () => {
    const r = billStatuses(
      [
        { id: "phone", monthlyCents: 6000 },
        { id: "gym", monthlyCents: 4000 },
        { id: "mystery", monthlyCents: null },
      ],
      txns,
      period,
    );
    expect(r.statuses[0]).toEqual({ billId: "phone", paid: true, paidCents: 6000, dueCents: 6000 });
    expect(r.unpaidCommittedCents).toBe(4000);
    expect(r.unknownCount).toBe(1);
  });

  it("derives account balances from the ledger", () => {
    expect(accountBalance("chk", 100000, txns)).toBe(100000 + 225000 - 12000 - 50000 - 80000 - 6000 - 6000);
    expect(accountBalance("card", -30000, txns)).toBe(-30000 - 12000 + 12000);
    expect(accountBalance("sav", 0, txns)).toBe(50000);
  });
});
