import { describe, expect, it } from "vitest";
import { add, sub, within } from "@/lib/core/money";
import type { FixedAsset } from "@/lib/core/types";
import { buildDepreciationEntry } from "@/lib/accounting/depreciation";
import { Ledger } from "@/lib/accounting/ledger";
import {
  entryForAccrual,
  entryForBillPayment,
  entryForBillReceived,
  entryForDistribution,
  entryForEquipmentPurchase,
  entryForInvoiceIssued,
  entryForInvoicePayment,
  entryForPayrollRun,
  entryForTransfer,
} from "@/lib/accounting/posting-helpers";
import { acct, actor, bill, invoice, makeLedger, payment, payrollLine, payrollRun, worker } from "./fixture";

/** A realistic first half-year for a small S-corp. Returns the ledger with everything posted. */
export function realisticLedger(): { ledger: Ledger; ds: ReturnType<typeof makeLedger>["ds"] } {
  const { ledger, ds } = makeLedger();
  const post = (input: Parameters<Ledger["createEntry"]>[0]) => ledger.createEntry({ ...input, post: true }, actor);

  // Opening capital
  post({ date: "2026-01-02", description: "Opening capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "50000" }, { accountCode: "3000", credit: "50000" }] });
  // Revenue on credit and partial collection
  const inv = invoice({ id: "inv1", total: "12000.00", issueDate: "2026-01-15", dueDate: "2026-02-14" });
  ds.invoices.push(inv);
  post(entryForInvoiceIssued(inv));
  const pay = payment({ id: "pay1", amount: "7000.00", date: "2026-02-10", direction: "IN", applications: [{ targetType: "INVOICE", targetId: inv.id, amount: "7000.00" }] });
  inv.amountPaid = "7000.0000";
  inv.status = "PARTIALLY_PAID";
  post(entryForInvoicePayment(inv, pay));
  // Expenses: bill received and paid, software paid from checking, accrual
  const b = bill({ id: "b1", total: "2000.00", billDate: "2026-01-20", expenseAccountId: acct("7100") });
  ds.bills.push(b);
  post(entryForBillReceived(b));
  const bp = payment({ id: "pay2", amount: "2000.00", date: "2026-02-05", direction: "OUT", applications: [{ targetType: "BILL", targetId: b.id, amount: "2000.00" }] });
  b.amountPaid = "2000.0000";
  b.status = "PAID";
  post(entryForBillPayment(b, bp));
  post({ date: "2026-02-15", description: "Software", source: "BANK_IMPORT", lines: [{ accountCode: "7000", debit: "300.00" }, { accountCode: "1000", credit: "300.00" }] });
  post(entryForAccrual("7200", "1250.00", "2026-03-31"));
  // Payroll
  const workers = [worker("w_owner", true), worker("w_emp", false)];
  ds.workers.push(...workers);
  const run = payrollRun("pr1", "2026-03-31", [payrollLine("w_owner", "8000"), payrollLine("w_emp", "6000")]);
  ds.payrollRuns.push(run);
  post(entryForPayrollRun(run, workers));
  // Equipment and depreciation
  post(entryForEquipmentPurchase("3600.00", "2026-01-10"));
  const asset: FixedAsset = {
    id: "fa1",
    name: "Laptop",
    acquiredDate: "2026-01-10",
    cost: "3600.00",
    salvageValue: "0",
    usefulLifeMonths: 36,
    method: "STRAIGHT_LINE",
    assetAccountId: acct("1500"),
    accumulatedDepreciationAccountId: acct("1590"),
    depreciationExpenseAccountId: acct("7700"),
    inServiceDate: "2026-01-10",
    taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED",
  };
  ds.fixedAssets.push(asset);
  for (const m of ["2026-01", "2026-02", "2026-03"]) post(buildDepreciationEntry(ledger, m)!);
  // Transfer to savings and a distribution
  post(entryForTransfer("1000", "1010", "5000.00", "2026-03-20"));
  post(entryForDistribution("4000.00", "2026-03-25"));
  return { ledger, ds };
}

describe("Financial statements over a realistic sequence", () => {
  it("income statement reports the expected sections", () => {
    const { ledger } = realisticLedger();
    const is = ledger.incomeStatement("2026-01-01", "2026-03-31");
    expect(is.revenue).toBe("12000.0000");
    expect(is.costOfRevenue).toBe("0.0000");
    expect(is.grossProfit).toBe("12000.0000");
    // rent 2000 + software 300 + accrual 1250 + payroll gross 14000 + employer taxes + depreciation 300
    const employerTaxes = add("8000", "6000"); // gross
    const erRate = 0.062 + 0.0145 + 0.006 + 0.034 + 0.001;
    const expectedEr = (Number(employerTaxes) * erRate).toFixed(2);
    const expectedOpex = add("2000", "300", "1250", "14000", expectedEr, "300");
    expect(is.operatingExpenses).toBe(expectedOpex);
    expect(is.operatingIncome).toBe(sub("12000", expectedOpex));
    expect(is.netIncome).toBe(is.operatingIncome);
    const officer = is.lines.find((l) => l.code === "6010");
    expect(officer?.amount).toBe("8000.0000");
    expect(is.lines.find((l) => l.label === "Net Income")?.isTotal).toBe(true);
    expect(is.lines.every((l) => typeof l.level === "number")).toBe(true);
  });

  it("balance sheet balances and reflects cash, AR, AP, payroll liabilities, equipment and equity", () => {
    const { ledger } = realisticLedger();
    const bs = ledger.balanceSheet("2026-03-31");
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe("0.0000");
    expect(within(bs.totalAssets, add(bs.totalLiabilities, bs.totalEquity))).toBe(true);
    const line = (label: string) => bs.lines.find((l) => l.label === label)?.amount;
    expect(line("Accounts Receivable")).toBe("5000.0000");
    expect(line("Computer Equipment")).toBe("3600.0000");
    expect(line("Accumulated Depreciation")).toBe("-300.0000");
    expect(line("Business Savings / Reserve")).toBe("5000.0000");
    expect(line("Shareholder Distributions")).toBe("-4000.0000");
    expect(line("Shareholder Capital / Paid-in Capital")).toBe("50000.0000");
    expect(line("Retained Earnings")).toBe("0.0000");
    expect(bs.currentYearEarnings).toBe(ledger.incomeStatement("2026-01-01", "2026-03-31").netIncome);
    expect(bs.cash).toBe(add(ledger.accountBalance(acct("1000"), "2026-03-31"), ledger.accountBalance(acct("1010"), "2026-03-31")));
    expect(bs.currentLiabilities).toBe(bs.totalLiabilities);
  });

  it("cash flow statement reconciles opening + activity to closing cash", () => {
    const { ledger } = realisticLedger();
    const cf = ledger.cashFlowStatement("2026-01-01", "2026-03-31");
    expect(cf.reconciled).toBe(true);
    expect(cf.openingCash).toBe("0.0000");
    expect(cf.closingCash).toBe(ledger.balanceSheet("2026-03-31").cash);
    expect(add(cf.openingCash, cf.netChange)).toBe(cf.closingCash);
    expect(cf.netIncome).toBe(ledger.incomeStatement("2026-01-01", "2026-03-31").netIncome);
    expect(cf.operatingAdjustments.find((l) => l.label.startsWith("Depreciation"))?.amount).toBe("300.0000");
    expect(cf.operatingAdjustments.find((l) => l.code === "1100")?.amount).toBe("-5000.0000"); // AR grew
    expect(cf.investing).toBe("-3600.0000");
    expect(cf.financing).toBe("46000.0000"); // 50,000 capital − 4,000 distributions
    // A sub-period also reconciles (opening cash comes from prior activity).
    const feb = ledger.cashFlowStatement("2026-02-01", "2026-02-28");
    expect(feb.reconciled).toBe(true);
    expect(feb.openingCash).toBe(ledger.accountBalance(acct("1000"), "2026-01-31"));
  });

  it("integrity checks pass on the realistic ledger", () => {
    const { ledger } = realisticLedger();
    const report = ledger.runIntegrityChecks("2026-03-31");
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.checks.map((c) => c.key)).toEqual(
      expect.arrayContaining(["entries-balance", "trial-balance", "balance-sheet", "cash-flow", "suspense-locked", "locked-period-posting", "accumulated-depreciation", "ar-subledger", "ap-subledger", "entry-numbers-unique", "posted-lines-accounts"]),
    );
  });

  it("flags AR subledger drift as a warning and duplicate entry numbers as an error", () => {
    const { ledger, ds } = realisticLedger();
    ds.invoices[0].amountPaid = "0.0000";
    let report = ledger.runIntegrityChecks("2026-03-31");
    const ar = report.checks.find((c) => c.key === "ar-subledger")!;
    expect(ar.passed).toBe(false);
    expect(ar.severity).toBe("WARNING");
    expect(report.passed).toBe(true);
    ds.journalEntries[1].entryNumber = ds.journalEntries[0].entryNumber;
    report = ledger.runIntegrityChecks("2026-03-31");
    expect(report.checks.find((c) => c.key === "entry-numbers-unique")!.passed).toBe(false);
    expect(report.passed).toBe(false);
  });
});
