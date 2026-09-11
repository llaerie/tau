/** Duplicate bills and duplicate outflow transactions (flagged, linked, or same vendor/amount within a short window). */
import { daysBetween } from "@/lib/core/dates";
import { abs, eq } from "@/lib/core/money";
import { isSpendOutflow, makeItem, merchantKey } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const DUPLICATE_BILL_WINDOW_DAYS = 30;
export const DUPLICATE_TX_WINDOW_DAYS = 3;

export const duplicateVendorPayment: Monitor = {
  key: "duplicate_vendor_payment",
  description: "Possible duplicate vendor bills or duplicate payments/charges.",
  run(ctx): AttentionItem[] {
    const { dataset } = ctx;
    const items: AttentionItem[] = [];
    const vendorName = new Map(dataset.vendors.map((v) => [v.id, v.name]));
    const seenPairs = new Set<string>();
    const pairKey = (a: string, b: string) => [a, b].sort().join("|");

    const bills = dataset.bills.filter((b) => b.status !== "VOID");
    for (const b of bills) {
      if (b.status === "DUPLICATE" || b.duplicateOfId) {
        items.push(
          makeItem(ctx, {
            kind: "duplicate_vendor_payment",
            severity: "WARNING",
            title: `Bill ${b.number} from ${vendorName.get(b.vendorId) ?? b.vendorId} is marked duplicate`,
            detail: `Bill ${b.number} (${b.total}) is ${b.status}${b.duplicateOfId ? ` and linked to ${b.duplicateOfId}` : ""}. Confirm it is not paid twice.`,
            amount: b.total,
            relatedIds: [b.id, ...(b.duplicateOfId ? [b.duplicateOfId] : [])],
          }),
        );
      }
    }
    for (let i = 0; i < bills.length; i++) {
      for (let j = i + 1; j < bills.length; j++) {
        const a = bills[i];
        const b = bills[j];
        if (a.vendorId !== b.vendorId || !eq(a.total, b.total)) continue;
        if (Math.abs(daysBetween(a.billDate, b.billDate)) > DUPLICATE_BILL_WINDOW_DAYS) continue;
        if (a.duplicateOfId === b.id || b.duplicateOfId === a.id) continue;
        const k = pairKey(a.id, b.id);
        if (seenPairs.has(k)) continue;
        seenPairs.add(k);
        items.push(
          makeItem(ctx, {
            kind: "duplicate_vendor_payment",
            severity: "WARNING",
            title: `Possible duplicate bills ${a.number} / ${b.number} — ${vendorName.get(a.vendorId) ?? a.vendorId}`,
            detail: `Two bills from the same vendor for ${a.total} dated ${a.billDate} and ${b.billDate}${a.number === b.number ? " with the same bill number" : ""}. Statuses: ${a.status} / ${b.status}.`,
            amount: a.total,
            relatedIds: [a.id, b.id, a.vendorId],
          }),
        );
      }
    }

    const txs = dataset.transactions.filter(isSpendOutflow);
    for (const t of dataset.transactions) {
      if (t.flags.includes("POSSIBLE_DUPLICATE") || t.duplicateOfId) {
        items.push(
          makeItem(ctx, {
            kind: "duplicate_vendor_payment",
            severity: "WARNING",
            title: `Transaction flagged as possible duplicate: ${t.merchantNormalized ?? t.descriptionRaw} ${abs(t.amount)}`,
            detail: `${t.date}: ${t.descriptionRaw}${t.duplicateOfId ? ` duplicates ${t.duplicateOfId}` : " carries the POSSIBLE_DUPLICATE flag"}.`,
            amount: abs(t.amount),
            relatedIds: [t.id, ...(t.duplicateOfId ? [t.duplicateOfId] : [])],
            suggestedTask: { kind: "accounting.detect_duplicates", params: { transactionIds: [t.id] } },
          }),
        );
      }
    }
    for (let i = 0; i < txs.length; i++) {
      for (let j = i + 1; j < txs.length; j++) {
        const a = txs[i];
        const b = txs[j];
        if (a.sourceAccountId !== b.sourceAccountId || !eq(a.amount, b.amount) || merchantKey(a) !== merchantKey(b)) continue;
        if (Math.abs(daysBetween(a.date, b.date)) > DUPLICATE_TX_WINDOW_DAYS) continue;
        const k = pairKey(a.id, b.id);
        if (seenPairs.has(k)) continue;
        seenPairs.add(k);
        items.push(
          makeItem(ctx, {
            kind: "duplicate_vendor_payment",
            severity: "WARNING",
            title: `Possible duplicate charge: ${a.merchantNormalized ?? a.descriptionRaw} ${abs(a.amount)} twice within ${DUPLICATE_TX_WINDOW_DAYS} days`,
            detail: `${a.date} and ${b.date}: identical amount and merchant on the same account. Confirm with the vendor before paying or categorizing both.`,
            amount: abs(a.amount),
            relatedIds: [a.id, b.id],
            suggestedTask: { kind: "accounting.detect_duplicates", params: { transactionIds: [a.id, b.id] } },
          }),
        );
      }
    }
    return items;
  },
};
