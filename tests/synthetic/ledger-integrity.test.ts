import { describe, expect, it } from "vitest";
import { Ledger } from "@/lib/accounting/ledger";
import { reconcileBankAccount, reconcileCard } from "@/lib/accounting/reconciliation";
import { entryBalances } from "@/lib/accounting/statements";
import { D, add, money, within } from "@/lib/core/money";
import { defaultDataset } from "./fixture";

describe("synthetic dataset — ledger integrity", () => {
  it("passes every ERROR-level integrity check as of the asOf date", () => {
    const ds = defaultDataset();
    const report = new Ledger(ds).runIntegrityChecks(ds.profile.asOfDate);
    const failures = report.checks.filter((c) => !c.passed);
    expect(failures.filter((c) => c.severity === "ERROR")).toEqual([]);
    expect(report.passed).toBe(true);
    // No warnings either: AR/AP subledgers reconcile and cash is never overdrawn.
    expect(failures).toEqual([]);
  });

  it("balance sheet balances and cash flow reconciles fiscal YTD", () => {
    const ds = defaultDataset();
    const ledger = new Ledger(ds);
    const bs = ledger.balanceSheet(ds.profile.asOfDate);
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe("0.0000");
    expect(D(bs.cash).gt(0)).toBe(true);
    const cf = ledger.cashFlowStatement("2026-01-01", ds.profile.asOfDate);
    expect(cf.reconciled).toBe(true);
    expect(cf.difference).toBe("0.0000");
    expect(money(D(cf.openingCash).plus(D(cf.netChange)))).toBe(cf.closingCash);
    // Prior fiscal year also reconciles from a zero opening balance.
    const cf2025 = ledger.cashFlowStatement("2025-01-01", "2025-12-31");
    expect(cf2025.reconciled).toBe(true);
    expect(cf2025.openingCash).toBe("0.0000");
    const is = ledger.incomeStatement("2026-01-01", ds.profile.asOfDate);
    expect(D(is.revenue).gt(0)).toBe(true);
    expect(D(is.netIncome).gt(0)).toBe(true);
  });

  it("AR subledger equals GL accounts receivable", () => {
    const ds = defaultDataset();
    const ledger = new Ledger(ds);
    const open = ds.invoices.filter((i) => i.issueDate <= ds.profile.asOfDate && i.status !== "DRAFT" && i.status !== "VOID");
    const sub = open.reduce((acc, i) => add(acc, D(i.total).minus(D(i.amountPaid)).toFixed(4)), money(0));
    const gl = ledger.accountBalance("acct_1100", ds.profile.asOfDate);
    expect(within(sub, gl)).toBe(true);
    expect(D(gl).gt(0)).toBe(true); // the current month's Harbor invoice is still open
    const openBills = ds.bills.filter((b) => b.status !== "VOID" && b.status !== "DUPLICATE");
    const apSub = openBills.reduce((acc, b) => add(acc, D(b.total).minus(D(b.amountPaid)).toFixed(4)), money(0));
    expect(within(apSub, ledger.accountBalance("acct_2000", ds.profile.asOfDate))).toBe(true);
  });

  it("every journal entry balances, is posted (or reversed by a posted reversal), and has chronological numbering", () => {
    const ds = defaultDataset();
    expect(ds.journalEntries.length).toBeGreaterThan(400);
    let lastDate = "";
    for (const e of ds.journalEntries) {
      expect(entryBalances(e)).toBe(true);
      expect(["POSTED", "REVERSED"]).toContain(e.status);
      expect(e.postedAt).toBeDefined();
      expect(e.periodId).toBe(e.date.slice(0, 7));
      expect(e.date >= lastDate).toBe(true);
      lastDate = e.date;
      if (e.status === "REVERSED") {
        const rev = ds.journalEntries.find((x) => x.id === e.reversedByEntryId);
        expect(rev?.status).toBe("POSTED");
        expect(rev?.reversesEntryId).toBe(e.id);
      }
    }
    const numbers = ds.journalEntries.map((e) => e.entryNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(ds.journalEntries.some((e) => e.source === "CLOSING")).toBe(false);
  });

  it("links every transaction to a journal entry both ways, except the intentionally uncategorized one", () => {
    const ds = defaultDataset();
    const entries = new Map(ds.journalEntries.map((e) => [e.id, e]));
    const unlinked = ds.transactions.filter((t) => !t.journalEntryId);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].descriptionRaw).toBe("VENMO PAYMENT 4821");
    expect(unlinked[0].category.status).toBe("UNCATEGORIZED");
    expect(unlinked[0].category.accountId).toBeNull();
    for (const t of ds.transactions.filter((t) => t.journalEntryId)) {
      const e = entries.get(t.journalEntryId!);
      expect(e).toBeDefined();
      expect(e!.sourceIds).toContain(t.id);
    }
    const suspense = ds.transactions.find((t) => t.category.accountId === "acct_9999")!;
    expect(suspense.date.slice(0, 7)).toBe("2026-09");
    expect(suspense.journalEntryId).toBeDefined();
    expect(entries.get(suspense.journalEntryId!)!.lines.some((l) => l.accountId === "acct_9999")).toBe(true);
    for (const inv of ds.invoices) expect(inv.journalEntryId).toBeDefined();
    for (const bill of ds.bills.filter((b) => b.status !== "DUPLICATE")) expect(bill.journalEntryId).toBeDefined();
    for (const bill of ds.bills.filter((b) => b.status === "DUPLICATE")) expect(bill.journalEntryId).toBeUndefined();
    for (const p of ds.payments) expect(p.journalEntryId).toBeDefined();
  });

  it("bank and card feeds reconcile to the general ledger", () => {
    const ds = defaultDataset();
    const asOf = ds.profile.asOfDate;
    for (const b of ds.bankAccounts) {
      const rec = reconcileBankAccount(ds, b.id, asOf);
      // The only unmatched bank transaction is the uncategorized Venmo payment.
      expect(rec.unmatchedTransactions.map((t) => t.descriptionRaw)).toEqual(b.accountType === "CHECKING" ? ["VENMO PAYMENT 4821"] : []);
      expect(rec.difference).toBe(b.accountType === "CHECKING" ? "600.0000" : "0.0000");
    }
    const card = reconcileCard(ds, ds.cards[0].id, asOf);
    expect(card.reconciled).toBe(true);
  });

  it("includes the opening balance entry", () => {
    const ds = defaultDataset();
    const opening = ds.journalEntries.filter((e) => e.source === "OPENING_BALANCE");
    expect(opening).toHaveLength(1);
    expect(opening[0].date).toBe("2025-06-01");
    expect(opening[0].entryNumber).toBe(1);
    expect(opening[0].lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["acct_1000", "25000.0000", "0.0000"],
      ["acct_3000", "0.0000", "25000.0000"],
    ]);
    const tx = ds.transactions.find((t) => t.journalEntryId === opening[0].id)!;
    expect(tx.amount).toBe("25000.0000");
  });

  it("posts adjusting entries only through the last full month", () => {
    const ds = defaultDataset();
    const adjusting = ds.journalEntries.filter((e) => e.source === "DEPRECIATION" || (e.tags ?? []).includes("prepaid-amortization"));
    expect(adjusting.length).toBeGreaterThan(0);
    expect(adjusting.every((e) => e.date <= "2026-08-31")).toBe(true);
    const ledger = new Ledger(ds);
    expect(ledger.accountBalance("acct_1200", "2026-08-31")).toBe("198.0000"); // 1188 − 10 × 99
    const depr = ds.journalEntries.filter((e) => e.source === "DEPRECIATION");
    expect(depr.length).toBe(12); // 2025-09 .. 2026-08
  });
});
