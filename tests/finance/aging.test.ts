import { describe, expect, it } from "vitest";
import type { Bill, Invoice } from "@/lib/core/types";
import { apAging, arAging, bucketForDaysPastDue } from "@/lib/finance/aging";

const asOf = "2026-09-09";

const inv = (id: string, dueDate: string, total: string, paid = "0", status: Invoice["status"] = "SENT", customerId = "cust_a"): Invoice => ({
  id, number: id.toUpperCase(), customerId, issueDate: "2026-01-01", dueDate, currency: "USD", total, amountPaid: paid, status, lines: [], paymentIds: [],
});

describe("aging buckets", () => {
  it("bucket boundaries", () => {
    expect(bucketForDaysPastDue(-5)).toBe("CURRENT");
    expect(bucketForDaysPastDue(0)).toBe("CURRENT");
    expect(bucketForDaysPastDue(1)).toBe("1-30");
    expect(bucketForDaysPastDue(30)).toBe("1-30");
    expect(bucketForDaysPastDue(31)).toBe("31-60");
    expect(bucketForDaysPastDue(60)).toBe("31-60");
    expect(bucketForDaysPastDue(61)).toBe("61-90");
    expect(bucketForDaysPastDue(90)).toBe("61-90");
    expect(bucketForDaysPastDue(91)).toBe("90+");
  });

  it("AR aging assigns invoices by days past due with boundary days", () => {
    const invoices = [
      inv("inv_due_today", "2026-09-09", "100"), // 0 → CURRENT
      inv("inv_future", "2026-09-20", "50"), // CURRENT
      inv("inv_1", "2026-09-08", "200"), // 1 → 1-30
      inv("inv_30", "2026-08-10", "300"), // 30 → 1-30
      inv("inv_31", "2026-08-09", "400", "100", "PARTIALLY_PAID"), // 31 → 31-60 (open 300)
      inv("inv_60", "2026-07-11", "500"), // 60 → 31-60
      inv("inv_61", "2026-07-10", "600", "0", "OVERDUE", "cust_b"), // 61 → 61-90
      inv("inv_90", "2026-06-11", "700", "0", "OVERDUE", "cust_b"), // 90 → 61-90
      inv("inv_91", "2026-06-10", "800", "0", "OVERDUE", "cust_b"), // 91 → 90+
      inv("inv_paid", "2026-01-01", "999", "999", "PAID"), // excluded
      inv("inv_void", "2026-01-01", "999", "0", "VOID"), // excluded
    ];
    const r = arAging(invoices, asOf, [{ id: "cust_a", name: "Alpha", paymentTermsDays: 30, country: "US", relatedParty: false, active: true }]);
    const v = r.value;
    expect(v.buckets.CURRENT).toBe("150.0000");
    expect(v.buckets["1-30"]).toBe("500.0000");
    expect(v.buckets["31-60"]).toBe("800.0000");
    expect(v.buckets["61-90"]).toBe("1300.0000");
    expect(v.buckets["90+"]).toBe("800.0000");
    expect(v.total).toBe("3550.0000");
    expect(v.overdue.map((i) => i.id)).not.toContain("inv_due_today");
    expect(v.overdue).toHaveLength(7);
    expect(v.overdueTotal).toBe("3400.0000");
    expect(v.items.find((i) => i.id === "inv_31")?.openAmount).toBe("300.0000");
    const alpha = v.rows.find((row) => row.counterpartyId === "cust_a");
    expect(alpha?.counterpartyName).toBe("Alpha");
    expect(alpha?.total).toBe("1450.0000");
    expect(v.rows[0].counterpartyId).toBe("cust_b"); // largest first
    expect(r.unit).toBe("TABLE");
    expect(r.sourceIds).toContain("inv_91");
    expect(r.sourceIds).not.toContain("inv_paid");
  });

  it("AP aging on bills", () => {
    const bill = (id: string, dueDate: string, total: string, status: Bill["status"] = "RECEIVED"): Bill => ({
      id, vendorId: "ven_x", number: id, receivedDate: "2026-08-01", billDate: "2026-08-01", dueDate, currency: "USD", total, amountPaid: "0", status, expenseAccountId: "acct_7000", description: "", paymentIds: [],
    });
    const r = apAging([bill("b1", "2026-09-30", "100"), bill("b2", "2026-08-01", "250", "APPROVED"), bill("b3", "2026-05-01", "1000", "PAID"), bill("b4", "2026-05-01", "1000", "DUPLICATE")], asOf);
    expect(r.value.buckets.CURRENT).toBe("100.0000");
    expect(r.value.buckets["31-60"]).toBe("250.0000");
    expect(r.value.total).toBe("350.0000");
    expect(r.value.overdue.map((i) => i.id)).toEqual(["b2"]);
  });
});
