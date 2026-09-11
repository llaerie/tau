/**
 * Expected recurring receipt not received by its due date plus grace, and expected recurring
 * invoices that were never issued for a month. Only customers with ≥ 2 invoices count as recurring.
 */
import { addDays, daysBetween, monthKey, addMonths } from "@/lib/core/dates";
import { D, sub } from "@/lib/core/money";
import { makeItem, median } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const GRACE_DAYS = 5;

export const revenuePaymentMissing: Monitor = {
  key: "revenue_payment_missing",
  description: "Recurring customer receipts not received by due date + grace, and expected recurring invoices not issued.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const items: AttentionItem[] = [];
    for (const customer of dataset.customers) {
      const invoices = dataset.invoices
        .filter((i) => i.customerId === customer.id && i.status !== "VOID" && i.status !== "DRAFT" && i.issueDate <= asOf)
        .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
      if (invoices.length < 2) continue;

      for (const inv of invoices) {
        const open = sub(inv.total, inv.amountPaid);
        if (D(open).lte(0)) continue;
        const graceEnd = addDays(inv.dueDate, GRACE_DAYS);
        if (graceEnd >= asOf) continue;
        const late = daysBetween(inv.dueDate, asOf);
        items.push(
          makeItem(ctx, {
            kind: "revenue_payment_missing",
            severity: late > 30 ? "CRITICAL" : "WARNING",
            title: `Expected receipt from ${customer.name} not received (invoice ${inv.number})`,
            detail: `Invoice ${inv.number} for ${customer.name} was due ${inv.dueDate}; ${late} day(s) late, ${GRACE_DAYS}-day grace exceeded. Open amount ${open}.${customer.relatedParty ? " Related-party customer: document collection follow-up for CPA disclosure." : ""}`,
            amount: open,
            dueDate: inv.dueDate,
            relatedIds: [inv.id, customer.id],
            suggestedTask: { kind: "ar.collection_reminder", params: { invoiceId: inv.id } },
          }),
        );
      }

      // Expected recurring invoice not issued for the month after the latest one.
      const issueDays = invoices.map((i) => String(Number(i.issueDate.slice(8, 10))));
      const expectedDay = Number(median(issueDays));
      const lastMonth = monthKey(invoices[invoices.length - 1].issueDate);
      const expectedMonth = monthKey(addMonths(`${lastMonth}-01`, 1));
      const currentMonth = monthKey(asOf);
      const dayOfAsOf = Number(asOf.slice(8, 10));
      const overdueInvoice = expectedMonth < currentMonth || (expectedMonth === currentMonth && dayOfAsOf > expectedDay + GRACE_DAYS);
      if (overdueInvoice) {
        items.push(
          makeItem(ctx, {
            kind: "revenue_payment_missing",
            severity: "INFO",
            title: `No invoice issued to ${customer.name} for ${expectedMonth}`,
            detail: `${customer.name} has been invoiced in ${invoices.length} months (typically around day ${expectedDay}); no invoice for ${expectedMonth} exists as of ${asOf}. Confirm whether the engagement continues before projecting this revenue.`,
            relatedIds: [customer.id, expectedMonth],
            sourceIds: invoices.map((i) => i.id),
            suggestedTask: { kind: "ar.create_invoice", params: { customerId: customer.id } },
          }),
        );
      }
    }
    return items;
  },
};
