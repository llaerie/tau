import { describe, expect, it } from "vitest";
import { add } from "@/lib/core/money";
import type { PayrollLiability } from "@/lib/core/types";
import { entryBalances } from "@/lib/accounting/statements";
import { entryForAccrual, entryForDistribution, entryForEquipmentPurchase, entryForPayrollLiabilityPayment, entryForPayrollRun, entryForPrepaidAmortization, entryForTransfer } from "@/lib/accounting/posting-helpers";
import { acct, actor, makeLedger, payrollLine, payrollRun, worker } from "./fixture";

describe("Posting helpers", () => {
  it("entryForPayrollRun splits owner vs employee wages and books every liability bucket", () => {
    const { ledger, ds } = makeLedger();
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "50000" }, { accountCode: "3000", credit: "50000" }], post: true }, actor);
    const workers = [worker("w_owner", true), worker("w_a", false), worker("w_b", false)];
    ds.workers.push(...workers);
    const run = payrollRun("pr_1", "2026-01-31", [payrollLine("w_owner", "10000"), payrollLine("w_a", "6000"), payrollLine("w_b", "4500")]);
    const input = entryForPayrollRun(run, workers);
    const e = ledger.createEntry({ ...input, post: true }, actor);
    expect(e.source).toBe("PAYROLL");
    expect(e.sourceIds).toContain("pr_1");
    expect(e.tags).toContain("restricted-account"); // officer comp is restricted
    const bal = (code: string) => ledger.accountBalance(acct(code), "2026-01-31");
    expect(bal("6010")).toBe("10000.0000");
    expect(bal("6000")).toBe("10500.0000");
    const l = run.lines;
    const sum = (f: (x: (typeof l)[number]) => string) => add(...l.map(f));
    expect(bal("6100")).toBe(run.totals.employerTaxes);
    expect(bal("2200")).toBe(sum((x) => add(x.federalIncomeTaxWithheld, x.socialSecurityEmployee, x.medicareEmployee, x.socialSecurityEmployer, x.medicareEmployer)));
    expect(bal("2210")).toBe(sum((x) => add(x.stateIncomeTaxWithheld, x.stateDisabilityEmployee)));
    expect(bal("2220")).toBe(sum((x) => x.federalUnemploymentEmployer));
    expect(bal("2230")).toBe(sum((x) => add(x.stateUnemploymentEmployer, x.stateTrainingTaxEmployer)));
    expect(bal("1000")).toBe(add("50000", `-${run.totals.netPay}`));
    expect(ledger.balanceSheet("2026-01-31").balanced).toBe(true);
    expect(() => entryForPayrollRun(run, [])).toThrow(/unknown worker/);
  });

  it("entryForPayrollLiabilityPayment clears the liability against cash", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "5000" }, { accountCode: "3000", credit: "5000" }], post: true }, actor);
    ledger.createEntry({ date: "2026-01-31", description: "accrue", source: "PAYROLL", lines: [{ accountCode: "6100", debit: "300" }, { accountCode: "2200", credit: "300" }], post: true }, actor);
    const liab: PayrollLiability = { id: "pl1", payrollRunId: "pr", kind: "FEDERAL_WITHHOLDING_AND_FICA", amount: "300.00", currency: "USD", accruedDate: "2026-01-31", dueDate: "2026-02-15", status: "ACCRUED", glAccountId: acct("2200") };
    const e = ledger.createEntry({ ...entryForPayrollLiabilityPayment(liab), post: true }, actor);
    expect(e.date).toBe("2026-02-15");
    expect(ledger.accountBalance(acct("2200"), "2026-02-28")).toBe("0.0000");
    expect(ledger.accountBalance(acct("1000"), "2026-02-28")).toBe("4700.0000");
  });

  it("simple helpers produce balanced two-line entries with the right direction", () => {
    const t = entryForTransfer("1000", "1010", "250", "2026-02-01");
    expect(t.lines).toEqual([{ accountCode: "1010", debit: "250.0000" }, { accountCode: "1000", credit: "250.0000" }]);
    const p = entryForPrepaidAmortization("100", "7250", "2026-02-28");
    expect(p.source).toBe("ADJUSTING");
    expect(p.lines).toEqual([{ accountCode: "7250", debit: "100.0000" }, { accountCode: "1200", credit: "100.0000" }]);
    const a = entryForAccrual("7200", "1200.5", "2026-02-28", { id: "je_acc", post: true });
    expect(a.id).toBe("je_acc");
    expect(a.post).toBe(true);
    expect(a.lines[1]).toEqual({ accountCode: "2100", credit: "1200.5000" });
    const d = entryForDistribution("4000", "2026-02-28");
    expect(d.lines[0]).toEqual({ accountCode: "3100", debit: "4000.0000" });
    expect(d.tags).toContain("distribution");
    const eq = entryForEquipmentPurchase("1999.99", "2026-02-02");
    expect(eq.lines[0]).toEqual({ accountCode: "1500", debit: "1999.9900" });
    expect(() => entryForTransfer("1000", "1010", "0", "2026-02-01")).toThrow(/positive/);
    const { ledger } = makeLedger();
    for (const input of [t, p, a, d, eq]) {
      const e = ledger.createEntry({ ...input, post: true }, actor);
      expect(entryBalances(e)).toBe(true);
    }
    expect(ledger.trialBalance("2026-02-28").balanced).toBe(true);
  });
});
