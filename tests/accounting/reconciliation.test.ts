import { describe, expect, it } from "vitest";
import { reconcileAllAccounts, reconcileBankAccount, reconcileCard, subledgerReconciliation } from "@/lib/accounting/reconciliation";
import { entryForBankFee, entryForBankTransaction, entryForBillPayment, entryForBillReceived, entryForCardCharge, entryForInvoiceIssued, entryForInvoicePayment, entryForRefund, entryForTransfer } from "@/lib/accounting/posting-helpers";
import { acct, actor, bill, invoice, makeLedger, payment, tx } from "./fixture";

describe("Bank and card reconciliation", () => {
  it("reconciles when every transaction is matched to a posted entry", () => {
    const { ledger, ds } = makeLedger();
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "5000" }, { accountCode: "3000", credit: "5000" }], post: true }, actor);
    const deposit = tx({ id: "t0", amount: "5000.00", date: "2026-01-02", descriptionRaw: "Owner deposit" });
    deposit.journalEntryId = ds.journalEntries[0].id;
    const txs = [
      tx({ id: "t1", amount: "-120.00", date: "2026-01-05", descriptionRaw: "AWS", merchantNormalized: "Amazon Web Services" }),
      tx({ id: "t2", amount: "2500.00", date: "2026-01-09", descriptionRaw: "Client wire" }),
      tx({ id: "t3", amount: "-15.00", date: "2026-01-31", descriptionRaw: "Monthly fee" }),
      tx({ id: "t4", amount: "40.00", date: "2026-01-20", descriptionRaw: "Vendor refund" }),
    ];
    ds.transactions.push(deposit, ...txs);
    const e1 = ledger.createEntry({ ...entryForBankTransaction(txs[0], "7010", "1000"), post: true }, actor);
    const e2 = ledger.createEntry({ ...entryForBankTransaction(txs[1], "4000", "1000"), post: true }, actor);
    const e3 = ledger.createEntry({ ...entryForBankFee(txs[2], "1000"), post: true }, actor);
    const e4 = ledger.createEntry({ ...entryForRefund(txs[3], "7010", "1000"), post: true }, actor);
    txs[0].journalEntryId = e1.id;
    txs[1].journalEntryId = e2.id;
    txs[2].journalEntryId = e3.id;
    txs[3].journalEntryId = e4.id;
    expect(e1.description).toContain("Amazon Web Services");
    expect(e3.lines[0].accountId).toBe(acct("7500"));
    expect(e4.tags).toContain("refund");
    expect(e4.lines[0].accountId).toBe(acct("1000"));

    const rec = reconcileBankAccount(ds, "bank_checking", "2026-01-31");
    expect(rec.glBalance).toBe("7405.0000");
    expect(rec.bankBalance).toBe("7405.0000");
    expect(rec.difference).toBe("0.0000");
    expect(rec.unmatchedTransactions).toEqual([]);
    expect(rec.unmatchedJournalLines).toEqual([]);
    expect(rec.reconciled).toBe(true);

    // An unmatched feed transaction and an unmatched journal line break the reconciliation.
    ds.transactions.push(tx({ id: "t5", amount: "-99.00", date: "2026-01-25" }));
    ledger.createEntry({ date: "2026-01-26", description: "manual", source: "MANUAL", lines: [{ accountCode: "7000", debit: "10" }, { accountCode: "1000", credit: "10" }], post: true }, actor);
    const rec2 = reconcileBankAccount(ds, "bank_checking", "2026-01-31");
    expect(rec2.reconciled).toBe(false);
    expect(rec2.unmatchedTransactions.map((t) => t.id)).toEqual(["t5"]);
    expect(rec2.unmatchedJournalLines).toHaveLength(1);
    expect(rec2.unmatchedJournalLines[0].line.credit).toBe("10.0000");
    expect(rec2.difference).toBe("89.0000"); // GL 7395 vs bank 7306
    // As of an earlier date neither problem exists yet.
    expect(reconcileBankAccount(ds, "bank_checking", "2026-01-24").reconciled).toBe(true);
  });

  it("reconciles a credit card (liability) and card payments via transfer", () => {
    const { ledger, ds } = makeLedger();
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "5000" }, { accountCode: "3000", credit: "5000" }], post: true }, actor);
    const charges = [
      tx({ id: "c1", sourceKind: "CARD", sourceAccountId: "card_main", amount: "-200.00", date: "2026-01-04", descriptionRaw: "Figma" }),
      tx({ id: "c2", sourceKind: "CARD", sourceAccountId: "card_main", amount: "-55.55", date: "2026-01-06", descriptionRaw: "Notion" }),
      tx({ id: "c3", sourceKind: "CARD", sourceAccountId: "card_main", amount: "25.00", date: "2026-01-08", descriptionRaw: "Figma credit" }),
      tx({ id: "c4", sourceKind: "CARD", sourceAccountId: "card_main", amount: "100.00", date: "2026-01-20", descriptionRaw: "Payment received" }),
    ];
    ds.transactions.push(...charges);
    charges[0].journalEntryId = ledger.createEntry({ ...entryForCardCharge(charges[0], "7000"), post: true }, actor).id;
    charges[1].journalEntryId = ledger.createEntry({ ...entryForCardCharge(charges[1], "7000"), post: true }, actor).id;
    charges[2].journalEntryId = ledger.createEntry({ ...entryForCardCharge(charges[2], "7000"), post: true }, actor).id;
    charges[3].journalEntryId = ledger.createEntry({ ...entryForTransfer("1000", "2050", "100.00", "2026-01-20"), post: true }, actor).id;
    const rec = reconcileCard(ds, "card_main", "2026-01-31");
    expect(rec.kind).toBe("CARD");
    expect(rec.glBalance).toBe("130.5500");
    expect(rec.bankBalance).toBe("130.5500");
    expect(rec.reconciled).toBe(true);
    const all = reconcileAllAccounts(ds, "2026-01-31");
    expect(all.map((r) => [r.kind, r.reconciled])).toEqual([
      ["BANK", false], // checking has no feed transactions for the capital deposit or the card payment
      ["CARD", true],
    ]);
    expect(all[0].difference).toBe("4900.0000");
  });
});

describe("Subledger reconciliation", () => {
  it("AR and AP subledgers tie to the GL when invoices/bills and payments are recorded through the helpers", () => {
    const { ledger, ds } = makeLedger();
    ledger.createEntry({ date: "2026-01-02", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "5000" }, { accountCode: "3000", credit: "5000" }], post: true }, actor);
    const inv1 = invoice({ id: "i1", total: "1000.00", issueDate: "2026-01-10" });
    const inv2 = invoice({
      id: "i2",
      total: "750.50",
      issueDate: "2026-01-12",
      lines: [
        { id: "i2a", description: "Services", quantity: "1", unitPrice: "500.50", amount: "500.50", revenueAccountId: acct("4000") },
        { id: "i2b", description: "Consulting", quantity: "1", unitPrice: "250.00", amount: "250.00", revenueAccountId: acct("4100") },
      ],
    });
    ds.invoices.push(inv1, inv2);
    ledger.createEntry({ ...entryForInvoiceIssued(inv1), post: true }, actor);
    const i2 = ledger.createEntry({ ...entryForInvoiceIssued(inv2), post: true }, actor);
    expect(i2.lines).toHaveLength(3);
    const p1 = payment({ id: "p1", amount: "400.00", date: "2026-01-20", direction: "IN", applications: [{ targetType: "INVOICE", targetId: inv1.id, amount: "400.00" }] });
    ledger.createEntry({ ...entryForInvoicePayment(inv1, p1), post: true }, actor);
    inv1.amountPaid = "400.0000";
    inv1.status = "PARTIALLY_PAID";

    const b1 = bill({ id: "b1", total: "320.00", billDate: "2026-01-15" });
    const b2 = bill({ id: "b2", total: "80.25", billDate: "2026-01-18", expenseAccountId: acct("7000") });
    ds.bills.push(b1, b2);
    ledger.createEntry({ ...entryForBillReceived(b1), post: true }, actor);
    ledger.createEntry({ ...entryForBillReceived(b2), post: true }, actor);
    const p2 = payment({ id: "p2", amount: "80.25", date: "2026-01-25", direction: "OUT", applications: [{ targetType: "BILL", targetId: b2.id, amount: "80.25" }] });
    ledger.createEntry({ ...entryForBillPayment(b2, p2), post: true }, actor);
    b2.amountPaid = "80.2500";
    b2.status = "PAID";

    const rec = subledgerReconciliation(ds, "2026-01-31");
    expect(rec.ar.glBalance).toBe("1350.5000");
    expect(rec.ar.subledgerBalance).toBe("1350.5000");
    expect(rec.ar.openItems.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(rec.ar.reconciled).toBe(true);
    expect(rec.ap.glBalance).toBe("320.0000");
    expect(rec.ap.subledgerBalance).toBe("320.0000");
    expect(rec.ap.openItems.map((i) => i.id)).toEqual(["b1"]);
    expect(rec.reconciled).toBe(true);

    // A payment recorded in the subledger but not in the GL is detected.
    inv2.amountPaid = "750.5000";
    inv2.status = "PAID";
    const drift = subledgerReconciliation(ds, "2026-01-31");
    expect(drift.ar.reconciled).toBe(false);
    expect(drift.ar.difference).toBe("750.5000");
    expect(ledger.runIntegrityChecks("2026-01-31").checks.find((c) => c.key === "ar-subledger")!.passed).toBe(false);
  });

  it("rejects an invoice whose lines do not sum to its total", () => {
    const inv = invoice({ id: "bad", total: "100.00", issueDate: "2026-01-10", lines: [{ id: "l", description: "x", quantity: "1", unitPrice: "90", amount: "90", revenueAccountId: acct("4000") }] });
    expect(() => entryForInvoiceIssued(inv)).toThrow(/line total/);
  });
});
