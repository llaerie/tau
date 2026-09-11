import { describe, expect, it } from "vitest";
import { accountBalance, monthPeriod, summarizeFlows, type LedgerTransaction } from "./classify";

const period = monthPeriod("2026-09");

describe("ledger semantics", () => {
  it("a card charge increases the card liability and records spending; cash is untouched until the card is paid", () => {
    const charge: LedgerTransaction = { id: "1", date: "2026-09-03", amountCents: 12000, kind: "expense", accountId: "card", description: "Dinner" };
    expect(accountBalance("chk", 100000, [charge])).toBe(100000);
    expect(accountBalance("card", 0, [charge])).toBe(-12000);
    const payment: LedgerTransaction = { id: "2", date: "2026-09-20", amountCents: 12000, kind: "cc_payment", accountId: "chk", counterAccountId: "card", description: "Card payment" };
    expect(accountBalance("chk", 100000, [charge, payment])).toBe(88000);
    expect(accountBalance("card", 0, [charge, payment])).toBe(0);
    const flows = summarizeFlows([charge, payment], { accountIds: new Set(["chk", "card"]) }, period);
    expect(flows.spendingCents).toBe(12000);
    expect(flows.excluded.ccPaymentsCents).toBe(12000);
  });

  it("a payroll remittance does not duplicate wages already recorded as gross", () => {
    const gross: LedgerTransaction = { id: "1", date: "2026-09-25", amountCents: 600000, kind: "expense", accountId: "op", categoryId: "payroll", description: "Gross wages" };
    // The withheld part leaves later as a liability settlement to the tax agencies, not as a second wage expense.
    const remit: LedgerTransaction = { id: "2", date: "2026-09-30", amountCents: 90000, kind: "transfer", accountId: "op", counterAccountId: "payroll-liability", treatment: "liability_settlement", description: "Payroll tax remittance" };
    const flows = summarizeFlows([gross, remit], { accountIds: new Set(["op", "payroll-liability"]) }, period);
    expect(flows.spendingCents).toBe(600000);
    expect(flows.excluded.internalTransfersCents).toBe(90000);
  });

  it("transfers between the same owner's accounts are eliminated, distributions keep their classification", () => {
    const own: LedgerTransaction = { id: "1", date: "2026-09-02", amountCents: 50000, kind: "transfer", accountId: "chk", counterAccountId: "sav", description: "To savings" };
    const dist: LedgerTransaction = { id: "2", date: "2026-09-01", amountCents: 700000, kind: "transfer", accountId: "op", counterAccountId: "joint", treatment: "shareholder_distribution", economicEventId: "ev-1", description: "Owner distribution" };
    const personal = summarizeFlows([own], { accountIds: new Set(["chk", "sav"]) }, period);
    expect(personal.netCashFlowCents).toBe(0);
    expect(personal.excluded.internalTransfersCents).toBe(50000);
    const company = summarizeFlows([dist], { accountIds: new Set(["op"]) }, period);
    expect(company.contributionsOutCents).toBe(700000);
    expect(dist.treatment).toBe("shareholder_distribution");
    const household = summarizeFlows([dist], { accountIds: new Set(["joint"]) }, period);
    expect(household.contributionsInCents).toBe(700000);
  });

  it("voided transactions are ignored everywhere", () => {
    const t: LedgerTransaction = { id: "1", date: "2026-09-03", amountCents: 500, kind: "expense", accountId: "chk", description: "Mistake", voidedAt: "2026-09-04T00:00:00Z" };
    expect(accountBalance("chk", 1000, [t])).toBe(1000);
    expect(summarizeFlows([t], { accountIds: new Set(["chk"]) }, period).spendingCents).toBe(0);
  });
});
