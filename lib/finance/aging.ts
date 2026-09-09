/**
 * AR / AP aging. Buckets by days past due as of a date:
 *   CURRENT (not yet due, daysPastDue <= 0), 1-30, 31-60, 61-90, 90+ (> 90 days).
 */
import type { Bill, CalcResult, Customer, DecimalString, ID, ISODate, Invoice, Vendor } from "@/lib/core/types";
import { daysBetween } from "@/lib/core/dates";
import { D, add, sub } from "@/lib/core/money";
import { makeCalc } from "./calc-result";

export type AgingBucket = "CURRENT" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["CURRENT", "1-30", "31-60", "61-90", "90+"];

export type BucketTotals = Record<AgingBucket, DecimalString>;

export interface AgingItem {
  id: ID;
  number: string;
  counterpartyId: ID;
  counterpartyName: string;
  issueDate: ISODate;
  dueDate: ISODate;
  daysPastDue: number;
  bucket: AgingBucket;
  total: DecimalString;
  amountPaid: DecimalString;
  openAmount: DecimalString;
  status: string;
}

export interface AgingCounterpartyRow {
  counterpartyId: ID;
  counterpartyName: string;
  buckets: BucketTotals;
  total: DecimalString;
  itemCount: number;
}

export interface AgingReport {
  kind: "AR" | "AP";
  asOfDate: ISODate;
  buckets: BucketTotals;
  total: DecimalString;
  overdueTotal: DecimalString;
  rows: AgingCounterpartyRow[];
  items: AgingItem[];
  overdue: AgingItem[];
}

export function bucketForDaysPastDue(days: number): AgingBucket {
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

const emptyBuckets = (): BucketTotals => ({ CURRENT: "0.0000", "1-30": "0.0000", "31-60": "0.0000", "61-90": "0.0000", "90+": "0.0000" });

interface OpenDoc {
  id: ID;
  number: string;
  counterpartyId: ID;
  issueDate: ISODate;
  dueDate: ISODate;
  total: DecimalString;
  amountPaid: DecimalString;
  status: string;
}

function buildReport(kind: "AR" | "AP", docs: OpenDoc[], asOf: ISODate, names: Map<ID, string>): AgingReport {
  const items: AgingItem[] = [];
  for (const d of docs) {
    const open = sub(d.total, d.amountPaid);
    if (D(open).lte(0)) continue;
    const daysPastDue = daysBetween(d.dueDate, asOf);
    items.push({
      id: d.id,
      number: d.number,
      counterpartyId: d.counterpartyId,
      counterpartyName: names.get(d.counterpartyId) ?? d.counterpartyId,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      daysPastDue,
      bucket: bucketForDaysPastDue(daysPastDue),
      total: D(d.total).toFixed(4),
      amountPaid: D(d.amountPaid).toFixed(4),
      openAmount: open,
      status: d.status,
    });
  }
  items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : 1));

  const buckets = emptyBuckets();
  const byParty = new Map<ID, AgingCounterpartyRow>();
  for (const it of items) {
    buckets[it.bucket] = add(buckets[it.bucket], it.openAmount);
    let row = byParty.get(it.counterpartyId);
    if (!row) {
      row = { counterpartyId: it.counterpartyId, counterpartyName: it.counterpartyName, buckets: emptyBuckets(), total: "0.0000", itemCount: 0 };
      byParty.set(it.counterpartyId, row);
    }
    row.buckets[it.bucket] = add(row.buckets[it.bucket], it.openAmount);
    row.total = add(row.total, it.openAmount);
    row.itemCount += 1;
  }
  const rows = Array.from(byParty.values()).sort((a, b) => (D(b.total).gt(D(a.total)) ? 1 : D(b.total).lt(D(a.total)) ? -1 : a.counterpartyId < b.counterpartyId ? -1 : 1));
  const overdue = items.filter((i) => i.bucket !== "CURRENT");
  const total = AGING_BUCKETS.reduce((acc, b) => add(acc, buckets[b]), "0.0000");
  const overdueTotal = overdue.reduce((acc, i) => add(acc, i.openAmount), "0.0000");
  return { kind, asOfDate: asOf, buckets, total, overdueTotal, rows, items, overdue };
}

const OPEN_INVOICE_STATUSES = new Set<Invoice["status"]>(["SENT", "PARTIALLY_PAID", "OVERDUE"]);
const OPEN_BILL_STATUSES = new Set<Bill["status"]>(["RECEIVED", "APPROVED", "SCHEDULED", "DISPUTED"]);

/** Accounts receivable aging as of a date (open invoices only: SENT / PARTIALLY_PAID / OVERDUE). */
export function arAging(invoices: Invoice[], asOf: ISODate, customers: Customer[] = []): CalcResult<AgingReport> {
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const docs: OpenDoc[] = invoices
    .filter((i) => OPEN_INVOICE_STATUSES.has(i.status))
    .map((i) => ({ id: i.id, number: i.number, counterpartyId: i.customerId, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, amountPaid: i.amountPaid, status: i.status }));
  const report = buildReport("AR", docs, asOf, names);
  return makeCalc<AgingReport>({
    name: "ar_aging",
    value: report,
    unit: "TABLE",
    formula: "open = total - amountPaid; days_past_due = asOf - dueDate; buckets CURRENT(<=0) | 1-30 | 31-60 | 61-90 | 90+(>90)",
    inputs: { asOf, invoiceIds: report.items.map((i) => i.id), openAmounts: report.items.map((i) => i.openAmount), dueDates: report.items.map((i) => i.dueDate) },
    sourceIds: report.items.map((i) => i.id),
    asOfDate: asOf,
    notes: report.overdue.length ? [`${report.overdue.length} invoice(s) overdue totalling ${report.overdueTotal}`] : [],
  });
}

/** Accounts payable aging as of a date (open bills only: RECEIVED / APPROVED / SCHEDULED / DISPUTED). */
export function apAging(bills: Bill[], asOf: ISODate, vendors: Vendor[] = []): CalcResult<AgingReport> {
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  const docs: OpenDoc[] = bills
    .filter((b) => OPEN_BILL_STATUSES.has(b.status))
    .map((b) => ({ id: b.id, number: b.number, counterpartyId: b.vendorId, issueDate: b.billDate, dueDate: b.dueDate, total: b.total, amountPaid: b.amountPaid, status: b.status }));
  const report = buildReport("AP", docs, asOf, names);
  return makeCalc<AgingReport>({
    name: "ap_aging",
    value: report,
    unit: "TABLE",
    formula: "open = total - amountPaid; days_past_due = asOf - dueDate; buckets CURRENT(<=0) | 1-30 | 31-60 | 61-90 | 90+(>90)",
    inputs: { asOf, billIds: report.items.map((i) => i.id), openAmounts: report.items.map((i) => i.openAmount), dueDates: report.items.map((i) => i.dueDate) },
    sourceIds: report.items.map((i) => i.id),
    asOfDate: asOf,
    notes: report.overdue.length ? [`${report.overdue.length} bill(s) overdue totalling ${report.overdueTotal}`] : [],
  });
}
