import { describe, expect, it } from "vitest";
import { Ledger } from "@/lib/accounting/ledger";
import { GROUND_TRUTH_DEFINITIONS, SYNTHETIC_GROUND_TRUTH, getGroundTruthCase } from "@/lib/synthetic";
import { defaultDataset } from "./fixture";

const REQUIRED_KEYS = [
  "duplicate_subscription", "missing_receipt", "late_customer_payment", "personal_expense_on_company_card", "legitimate_business_meal",
  "transfer_between_accounts", "card_payment_transfer", "payroll_net_pay", "payroll_tax_liabilities", "equipment_purchase",
  "annual_software_prepaid", "incorrect_vendor_category", "refunded_purchase", "partial_invoice_payment", "international_worker_ambiguity",
  "owner_distribution", "owner_wage", "month_end_accrual", "prior_period_correction", "bank_fee", "franchise_tax_payment", "payroll_tax_deposit",
  "large_unusual_purchase", "uncategorized_transaction", "suspense_current_month", "vendor_missing_w9", "duplicate_vendor_bill",
];

describe("synthetic ground truth", () => {
  it("exposes every case with ids that exist in the dataset and carry the expected flags", () => {
    const ds = defaultDataset();
    const txById = new Map(ds.transactions.map((t) => [t.id, t]));
    const allIds = new Set<string>([
      ...ds.journalEntries.map((e) => e.id), ...ds.invoices.map((i) => i.id), ...ds.bills.map((b) => b.id), ...ds.payments.map((p) => p.id),
      ...ds.workers.map((w) => w.id), ...ds.vendors.map((v) => v.id), ...ds.customers.map((c) => c.id), ...ds.fixedAssets.map((f) => f.id),
      ...ds.payrollRuns.map((r) => r.id), ...ds.payrollLiabilities.map((l) => l.id), ...ds.approvals.map((a) => a.id),
    ]);
    expect(ds.groundTruth.map((c) => c.key)).toEqual(GROUND_TRUTH_DEFINITIONS.map((d) => d.key));
    for (const key of REQUIRED_KEYS) expect(ds.groundTruth.some((c) => c.key === key)).toBe(true);
    for (const c of ds.groundTruth) {
      expect(c.transactionIds.length + c.entityIds.length).toBeGreaterThan(0);
      expect(c.correctTreatment.length).toBeGreaterThan(10);
      for (const id of c.transactionIds) {
        const tx = txById.get(id);
        expect(tx, `${c.key}: transaction ${id}`).toBeDefined();
        for (const flag of c.expectedFlags) expect(tx!.flags, `${c.key}: ${tx!.descriptionRaw}`).toContain(flag);
        expect(tx!.meta?.groundTruthKeys).toContain(c.key);
      }
      for (const id of c.entityIds) expect(allIds.has(id), `${c.key}: entity ${id}`).toBe(true);
    }
  });

  it("SYNTHETIC_GROUND_TRUTH and getGroundTruthCase match the default dataset", () => {
    const ds = defaultDataset();
    expect([...SYNTHETIC_GROUND_TRUTH]).toEqual(ds.groundTruth);
    expect(SYNTHETIC_GROUND_TRUTH.length).toBe(ds.groundTruth.length);
    expect(getGroundTruthCase("owner_distribution")?.expectedCategoryCode).toBe("3100");
    expect(getGroundTruthCase("nope")).toBeUndefined();
    expect(getGroundTruthCase("missing_receipt", ds)).toEqual(ds.groundTruth.find((c) => c.key === "missing_receipt"));
  });

  it("encodes the specific difficult cases as described", () => {
    const ds = defaultDataset();
    const tx = (id: string) => ds.transactions.find((t) => t.id === id)!;
    const c = (key: string) => ds.groundTruth.find((x) => x.key === key)!;
    const ledger = new Ledger(ds);

    // Duplicate Notion charge in one month + second Zoom plan.
    const dup = c("duplicate_subscription").transactionIds.map(tx);
    const notion = dup.filter((t) => t.descriptionRaw.startsWith("NOTION"));
    expect(notion).toHaveLength(2);
    expect(new Set(notion.map((t) => t.date.slice(0, 7))).size).toBe(1);
    expect(dup.filter((t) => t.descriptionRaw === "ZOOM.US PRO SEAT 2").length).toBeGreaterThanOrEqual(3);

    // Missing receipt.
    const amazon = tx(c("missing_receipt").transactionIds[0]);
    expect(amazon.amount).toBe("-312.0000");
    const receiptKinds = (ids: string[]) => ids.map((id) => ds.documents.find((d) => d.id === id)?.kind);
    expect(receiptKinds(amazon.documentIds)).not.toContain("RECEIPT");
    expect(amazon.flags).toContain("MISSING_RECEIPT");
    expect(amazon.category.status).toBe("SUGGESTED");

    // Late Harbor payment: 25 days after due.
    const late = tx(c("late_customer_payment").transactionIds[0]);
    const lateInv = ds.invoices.find((i) => c("late_customer_payment").entityIds.includes(i.id))!;
    expect(lateInv.status).toBe("PAID");
    expect(late.date >= "2026-04-10").toBe(true);
    expect(lateInv.issueDate).toBe("2026-03-01");

    // Personal vs business meal.
    const personal = tx(c("personal_expense_on_company_card").transactionIds[0]);
    expect(personal.amount).toBe("-86.4000");
    expect(new Date(`${personal.date}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(receiptKinds(personal.documentIds)).not.toContain("RECEIPT");
    const business = tx(c("legitimate_business_meal").transactionIds[0]);
    expect(business.amount).toBe("-142.7500");
    expect([0, 6]).not.toContain(new Date(`${business.date}T00:00:00Z`).getUTCDay());
    const receipt = business.documentIds.map((id) => ds.documents.find((d) => d.id === id)!).find((d) => d.kind === "RECEIPT")!;
    expect(receipt).toBeDefined();
    expect(receipt.extracted?.attendees).toBeDefined();
    expect(receipt.extracted?.businessPurpose).toBeDefined();

    // Transfers never touch P&L.
    for (const id of [...c("transfer_between_accounts").transactionIds, ...c("card_payment_transfer").transactionIds]) {
      const t = tx(id);
      expect(t.flags).toContain("TRANSFER");
      expect(t.transferPairId).toBeDefined();
      const e = ds.journalEntries.find((x) => x.id === t.journalEntryId)!;
      const pnl = e.lines.filter((l) => ["4", "5", "6", "7", "9"].includes(ds.accounts.find((a) => a.id === l.accountId)!.code[0]));
      expect(pnl).toEqual([]);
    }

    // Equipment → fixed asset with depreciation.
    const laptop = tx(c("equipment_purchase").transactionIds[0]);
    expect(laptop.amount).toBe("-2899.0000");
    const asset = ds.fixedAssets.find((f) => f.sourceTransactionId === laptop.id)!;
    expect(asset.usefulLifeMonths).toBe(36);
    expect(asset.salvageValue).toBe("0.0000");
    expect(asset.documentId).toBeDefined();
    expect(ds.journalEntries.find((e) => e.id === laptop.journalEntryId)!.lines.some((l) => l.accountId === "acct_1500")).toBe(true);

    // Prepaid.
    const jb = tx(c("annual_software_prepaid").transactionIds[0]);
    expect(jb.amount).toBe("-1188.0000");
    expect(ds.journalEntries.find((e) => e.id === jb.journalEntryId)!.lines.some((l) => l.accountId === "acct_1200")).toBe(true);

    // Figma approved to meals.
    const figma = tx(c("incorrect_vendor_category").transactionIds[0]);
    expect(figma.category.accountId).toBe("acct_7300");
    expect(figma.category.status).toBe("APPROVED");
    expect(c("incorrect_vendor_category").expectedCategoryCode).toBe("7000");

    // Refund pair nets to zero.
    const [charge, refund] = c("refunded_purchase").transactionIds.map(tx);
    expect(charge.amount).toBe("-199.0000");
    expect(refund.amount).toBe("199.0000");
    expect(refund.flags).toContain("REFUND");
    expect(new Date(`${refund.date}T00:00:00Z`).getTime() - new Date(`${charge.date}T00:00:00Z`).getTime()).toBe(9 * 86_400_000);

    // Partial invoice payment.
    const partialInv = ds.invoices.find((i) => c("partial_invoice_payment").entityIds.includes(i.id))!;
    expect(partialInv.total).toBe("8000.0000");
    expect(partialInv.status).toBe("PAID");
    expect(c("partial_invoice_payment").transactionIds.map((id) => tx(id).amount)).toEqual(["5000.0000", "3000.0000"]);

    // Owner distribution with approval.
    const dist = tx(c("owner_distribution").transactionIds[0]);
    expect(dist.amount).toBe("-4000.0000");
    const distEntry = ds.journalEntries.find((e) => e.id === dist.journalEntryId)!;
    expect(distEntry.approvalId).toBe("apr_synthetic_distribution");
    expect(distEntry.tags).toContain("restricted-account");
    expect(ds.approvals.find((a) => a.id === "apr_synthetic_distribution")?.status).toBe("APPROVED");

    // Accrual + reversal.
    const accrual = c("month_end_accrual").entityIds.map((id) => ds.journalEntries.find((e) => e.id === id)).filter(Boolean);
    expect(accrual.some((e) => e!.source === "ADJUSTING" && e!.status === "REVERSED" && e!.date === "2026-06-30")).toBe(true);
    expect(accrual.some((e) => e!.source === "REVERSAL" && e!.date === "2026-07-01")).toBe(true);
    expect(ledger.accountBalance("acct_2100", "2026-06-30")).toBe("350.0000");
    expect(ledger.accountBalance("acct_2100", "2026-07-31")).toBe("0.0000");

    // Prior-period correction: pair dated in May, original in March.
    const ppc = c("prior_period_correction");
    const original = ds.journalEntries.find((e) => e.id === ppc.entityIds[0])!;
    expect(original.date.slice(0, 7)).toBe("2026-03");
    expect(original.status).toBe("REVERSED");
    const pair = ppc.entityIds.slice(1).map((id) => ds.journalEntries.find((e) => e.id === id)!);
    expect(pair).toHaveLength(2);
    for (const e of pair) {
      expect(e.source).toBe("CORRECTING");
      expect(e.date.slice(0, 7)).toBe("2026-05");
      expect(e.tags).toContain("prior-period-correction");
    }
    expect(ledger.accountBalance("acct_7400", "2026-03-31", "2026-03-01")).not.toBe("0.0000");

    // Franchise tax + large purchase + Venmo + suspense + W-9.
    expect(tx(c("franchise_tax_payment").transactionIds[0]).amount).toBe("-800.0000");
    expect(tx(c("large_unusual_purchase").transactionIds[0]).amount).toBe("-6500.0000");
    expect(tx(c("uncategorized_transaction").transactionIds[0]).journalEntryId).toBeUndefined();
    expect(tx(c("suspense_current_month").transactionIds[0]).category.accountId).toBe("acct_9999");
    expect(ds.vendors.find((v) => c("vendor_missing_w9").entityIds.includes(v.id))?.taxDocStatus).toBe("UNKNOWN");
    const dupBills = c("duplicate_vendor_bill").entityIds.map((id) => ds.bills.find((b) => b.id === id)!);
    expect(dupBills.map((b) => b.status)).toEqual(["PAID", "DUPLICATE"]);
    expect(dupBills[1].duplicateOfId).toBe(dupBills[0].id);
    expect(dupBills[0].number).not.toBe(dupBills[1].number);
  });
});
