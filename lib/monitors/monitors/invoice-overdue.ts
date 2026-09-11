/** AR aging: every overdue open invoice becomes an item (1-30 days WARNING, older CRITICAL). */
import { arAging } from "@/lib/finance/aging";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const invoiceOverdue: Monitor = {
  key: "invoice_overdue",
  description: "Open customer invoices past their due date (AR aging).",
  run(ctx): AttentionItem[] {
    const aging = arAging(ctx.dataset.invoices, ctx.asOf, ctx.dataset.customers);
    if (!aging.value.overdue.length) return [];
    const calcId = ctx.recordCalc(aging);
    return aging.value.overdue.map((it) =>
      makeItem(ctx, {
        kind: "invoice_overdue",
        severity: it.bucket === "1-30" ? "WARNING" : "CRITICAL",
        title: `Invoice ${it.number} overdue ${it.daysPastDue} day(s) — ${it.counterpartyName}`,
        detail: `Open ${it.openAmount} of ${it.total}, due ${it.dueDate} (bucket ${it.bucket}). Total AR overdue across all customers: ${aging.value.overdueTotal}.`,
        amount: it.openAmount,
        dueDate: it.dueDate,
        relatedIds: [it.id, it.counterpartyId],
        calcIds: [calcId],
        suggestedTask: { kind: "ar.collection_reminder", params: { invoiceId: it.id } },
      }),
    );
  },
};
