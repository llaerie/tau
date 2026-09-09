import { describe, expect, it } from "vitest";
import { D, add, sub } from "@/lib/core/money";
import { SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS } from "@/lib/synthetic";
import { defaultDataset } from "./fixture";

describe("synthetic payroll", () => {
  it("labels the rate set as synthetic and non-authoritative", () => {
    expect(SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS.label).toContain("NOT AUTHORITATIVE");
    expect(SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS.synthetic).toBe(true);
    expect(SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS.socialSecurityEmployee).toBe("0.062");
    const ds = defaultDataset();
    expect(ds.payrollRuns.every((r) => r.rateAssumptionSetId === SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS.id)).toBe(true);
  });

  it("runs monthly for the three US employees with correct arithmetic", () => {
    const ds = defaultDataset();
    expect(ds.payrollRuns).toHaveLength(15);
    for (const run of ds.payrollRuns) {
      expect(run.lines).toHaveLength(3);
      expect([0, 6]).not.toContain(new Date(`${run.payDate}T00:00:00Z`).getUTCDay());
      expect(run.payDate.slice(0, 7)).toBe(run.periodStart.slice(0, 7));
      for (const l of run.lines) {
        const employeeTaxes = add(l.federalIncomeTaxWithheld, l.stateIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.stateDisabilityEmployee);
        expect(sub(sub(l.gross, employeeTaxes), l.otherDeductions)).toBe(l.netPay);
        const employerTaxes = add(l.socialSecurityEmployer, l.medicareEmployer, l.federalUnemploymentEmployer, l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer);
        expect(add(l.gross, employerTaxes, l.otherEmployerCosts)).toBe(l.totalEmployerCost);
        expect(D(l.netPay).gt(0)).toBe(true);
      }
      const t = run.totals;
      expect(t.gross).toBe(add(...run.lines.map((l) => l.gross)));
      expect(t.netPay).toBe(add(...run.lines.map((l) => l.netPay)));
      expect(sub(sub(t.gross, t.employeeTaxes), t.otherDeductions)).toBe(t.netPay);
      expect(t.totalEmployerCost).toBe(add(t.gross, t.employerTaxes));
      expect(t.gross).toBe("11500.0000");
      // Net pay leaves checking as one transaction per employee.
      expect(run.netPayTransactionIds).toHaveLength(3);
      const txs = run.netPayTransactionIds.map((id) => ds.transactions.find((x) => x.id === id)!);
      expect(txs.every((x) => x.descriptionRaw.startsWith("PAYROLL NET PAY - "))).toBe(true);
      expect(add(...txs.map((x) => x.amount))).toBe(`-${t.netPay}`);
      expect(txs.every((x) => x.journalEntryId === run.journalEntryId)).toBe(true);
      const entry = ds.journalEntries.find((e) => e.id === run.journalEntryId)!;
      expect(entry.source).toBe("PAYROLL");
      expect(entry.lines.some((l) => l.accountId === "acct_6010" && l.debit === "3000.0000")).toBe(true);
      expect(add(...entry.lines.filter((l) => l.accountId === "acct_6000").map((l) => l.debit))).toBe("8500.0000");
    }
    // Wage-base taxes stop after 7,000 of calendar-year wages.
    const aug2025 = ds.payrollRuns.find((r) => r.payDate.startsWith("2025-08"))!;
    const sep2025 = ds.payrollRuns.find((r) => r.payDate.startsWith("2025-09"))!;
    expect(aug2025.lines[0].federalUnemploymentEmployer).toBe("6.0000"); // 1,000 remaining × 0.006
    expect(sep2025.lines.every((l) => l.federalUnemploymentEmployer === "0.0000" && l.stateUnemploymentEmployer === "0.0000")).toBe(true);
  });

  it("accrues liabilities per run and pays them the following month", () => {
    const ds = defaultDataset();
    const liabilities = ds.payrollLiabilities;
    expect(liabilities.every((l) => l.dueDate === null && l.dueDateSourceRuleId === undefined)).toBe(true);
    const runsById = new Map(ds.payrollRuns.map((r) => [r.id, r]));
    for (const l of liabilities) {
      expect(runsById.has(l.payrollRunId)).toBe(true);
      expect(D(l.amount).gt(0)).toBe(true);
      if (l.status === "PAID") {
        const tx = ds.transactions.find((t) => t.id === l.paidTransactionId)!;
        expect(tx).toBeDefined();
        expect(tx.date > l.accruedDate).toBe(true);
        expect(["IRS USATAXPYMT", "EDD EFT PAYMENT", "IRS USATAXPYMT FUTA 940", "EDD EFT PAYMENT UI/ETT"]).toContain(tx.descriptionRaw);
      }
    }
    const fedJuly = liabilities.find((l) => l.kind === "FEDERAL_WITHHOLDING_AND_FICA" && l.accruedDate.startsWith("2025-06"))!;
    expect(fedJuly.status).toBe("PAID");
    expect(ds.transactions.find((t) => t.id === fedJuly.paidTransactionId)!.date.slice(0, 7)).toBe("2025-07");
    // The most recent federal liability (August payroll, due in September after asOf) is still accrued.
    const fedAug = liabilities.find((l) => l.kind === "FEDERAL_WITHHOLDING_AND_FICA" && l.accruedDate.startsWith("2026-08"))!;
    expect(fedAug.status).toBe("ACCRUED");
    expect(ds.transactions.filter((t) => t.descriptionRaw === "PAYSTREAM PAYROLL SVC FEE")).toHaveLength(16);
  });

  it("flags the China-based workers for professional review with every cross-border fact unknown", () => {
    const ds = defaultDataset();
    const cn = ds.workers.filter((w) => w.country === "CN");
    expect(cn).toHaveLength(2);
    for (const w of cn) {
      expect(w.workerType).toBe("UNRESOLVED");
      expect(w.classificationStatus).toBe("UNRESOLVED_PROFESSIONAL_REVIEW");
      expect(w.payMethod).toBe("INTERNATIONAL_PLATFORM");
      expect(w.compensation).toMatchObject({ type: "CONTRACT", amount: "1500.0000", basis: "CONTRACT_FEE", currency: "USD", period: "MONTHLY", status: "UNCONFIRMED" });
      expect(w.internationalReview?.status).toBe("INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED");
      expect(w.internationalReview?.reviewerRole).toBe("ATTORNEY");
      expect(w.internationalReview?.fields).toHaveLength(13);
      for (const f of w.internationalReview!.fields) {
        expect(f.value).toBeNull();
        expect(f.status).toBe("PROFESSIONAL_REVIEW_REQUIRED");
        expect(f.requiredConfirmer).toBe("ATTORNEY");
      }
      expect(ds.documents.some((d) => d.workerId === w.id && d.kind === "W9")).toBe(false);
    }
    const wires = ds.transactions.filter((t) => t.descriptionRaw.startsWith("INTL PAYMENT PLATFORM WIRE"));
    expect(wires.length).toBe(15 * 2); // September's wires fall after the asOf date
    for (const t of wires) {
      expect(t.amount).toBe("-1500.0000");
      expect(t.category.accountId).toBe("acct_6060");
      expect(t.category.status).toBe("SUGGESTED");
      expect(t.flags).toContain("INTERNATIONAL");
    }
    const owner = ds.workers.find((w) => w.isOwner)!;
    expect(owner.compensation.status).toBe("PROFESSIONAL_REVIEW_REQUIRED");
    expect(owner.compensation.note).toBe("proposed; reasonable compensation is a professional judgment");
    expect(owner.relatedParty).toBe(true);
    const finance = ds.workers.find((w) => w.roleTitle === "Finance Operator")!;
    expect(finance.relatedParty).toBe(true);
    expect(finance.compensation.status).toBe("UNCONFIRMED");
  });
});
