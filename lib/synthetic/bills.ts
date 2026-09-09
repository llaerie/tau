/**
 * Vendor bills through AP: the monthly coworking desk (bill on the 1st, paid by ACH within days)
 * and the quarterly CPA fee, which is accrued at quarter end, reversed on the 1st of the next
 * month and then billed and paid through AP. One CPA bill arrives twice with different numbers.
 */
import { entryForAccrual, entryForBillPayment, entryForBillReceived } from "@/lib/accounting/posting-helpers";
import { addDays, monthEnd, nextBusinessDay } from "@/lib/core/dates";
import { money } from "@/lib/core/money";
import type { Bill, ISODate, Payment, Vendor } from "@/lib/core/types";
import { GENERATOR_ACTOR, acct, sid, type GenContext } from "./context";

export const COWORKING_MONTHLY = "450";
export const CPA_QUARTERLY_FEE = "350";

interface BillSpec {
  key: string;
  vendor: Vendor;
  number: string;
  receivedDate: ISODate;
  billDate: ISODate;
  dueDate: ISODate;
  total: string;
  expenseCode: string;
  description: string;
}

function recordBill(ctx: GenContext, spec: BillSpec): Bill {
  const bill: Bill = {
    id: sid("bill", spec.key),
    vendorId: spec.vendor.id,
    number: spec.number,
    receivedDate: spec.receivedDate,
    billDate: spec.billDate,
    dueDate: spec.dueDate,
    currency: "USD",
    total: money(spec.total),
    amountPaid: money(0),
    status: "APPROVED",
    expenseAccountId: acct(spec.expenseCode),
    description: spec.description,
    paymentIds: [],
  };
  const doc = ctx.addDoc({
    key: `bill:${spec.key}`,
    kind: "VENDOR_BILL",
    title: `${spec.vendor.name} bill ${spec.number}`,
    date: spec.receivedDate,
    vendorId: spec.vendor.id,
    amount: spec.total,
    storagePath: `synthetic://bills/${spec.number}.pdf`,
    extracted: { billNumber: spec.number, vendor: spec.vendor.name, total: money(spec.total), billDate: spec.billDate, dueDate: spec.dueDate, description: spec.description },
    tags: ["ap"],
  });
  bill.documentId = doc.id;
  ctx.ds.bills.push(bill);
  const entryId = sid("je", `bill:${spec.key}`);
  ctx.schedule(spec.billDate, (ledger) => {
    const entry = ledger.createEntry(entryForBillReceived(bill, { id: entryId, post: true }), GENERATOR_ACTOR);
    bill.journalEntryId = entry.id;
    doc.linkedJournalEntryIds.push(entry.id);
  });
  return bill;
}

function payBill(ctx: GenContext, bill: Bill, vendor: Vendor, key: string, date: ISODate, description: string): Payment | null {
  if (!ctx.inRange(date)) return null;
  const tx = ctx.addTx({
    key: `bank:${key}`,
    source: "checking",
    date,
    amount: `-${bill.total}`,
    description,
    merchant: vendor.name,
    counterparty: { type: "VENDOR", id: vendor.id },
    categoryCode: "2000",
    reason: `Bill payment — settles AP for ${bill.number}`,
    meta: { billId: bill.id },
  });
  const payment: Payment = {
    id: sid("pay", key),
    direction: "OUT",
    date,
    amount: money(bill.total),
    currency: "USD",
    method: "ACH",
    counterpartyRef: { type: "VENDOR", id: vendor.id },
    applications: [{ targetType: "BILL", targetId: bill.id, amount: money(bill.total) }],
    transactionId: tx.id,
    memo: `Payment of ${bill.number}`,
  };
  ctx.ds.payments.push(payment);
  bill.paymentIds.push(payment.id);
  bill.amountPaid = money(bill.total);
  bill.status = "PAID";
  const entryId = sid("je", `bill-payment:${key}`);
  ctx.schedule(date, (ledger) => {
    const entry = ledger.createEntry(entryForBillPayment(bill, payment, "1000", { id: entryId, post: true }), GENERATOR_ACTOR);
    payment.journalEntryId = entry.id;
    ctx.link(tx, entry);
  });
  return payment;
}

export function generateBills(ctx: GenContext): void {
  const coworking = ctx.refs.vendors.coworking;
  const cpa = ctx.refs.vendors.cpa;
  const accrualCaseMonth = ctx.monthFromEnd(3); // the most recent quarter end with a full accrual/reversal/bill cycle by default

  ctx.months.forEach((month, i) => {
    const first: ISODate = `${month}-01`;
    if (!ctx.inRange(first)) return;

    // --- Coworking desk: bill dated the 1st, paid within a few days.
    const bill = recordBill(ctx, {
      key: `cowork:${month}`,
      vendor: coworking,
      number: `BW-${month.replace("-", "")}-001`,
      receivedDate: i === 0 ? first : addDays(first, -5),
      billDate: first,
      dueDate: addDays(first, 7),
      total: COWORKING_MONTHLY,
      expenseCode: "7100",
      description: `Dedicated desk — ${month}`,
    });
    payBill(ctx, bill, coworking, `cowork-payment:${month}`, nextBusinessDay(addDays(first, ctx.rng.int(1, 3))), "BRIGHTWORK COWORKING ACH");

    // --- CPA fee: accrue at quarter end, reverse next month, then bill + pay through AP.
    const mm = Number(month.slice(5, 7));
    const isQuarterEnd = mm % 3 === 0;
    const qEnd = monthEnd(first);
    if (!isQuarterEnd || i === 0 || !ctx.inRange(qEnd)) return;
    const year = month.slice(0, 4);
    const quarter = mm / 3;
    const accrualId = sid("je", `accrual:cpa:${month}`);
    const reversalId = sid("je", `accrual-reversal:cpa:${month}`);
    const reversalDate = addDays(qEnd, 1);
    ctx.schedule(qEnd, (ledger) => {
      ledger.createEntry(entryForAccrual("7200", CPA_QUARTERLY_FEE, qEnd, { id: accrualId, post: true, description: `Accrue Q${quarter} ${year} CPA fee (bill not yet received)`, memo: "Month-end accrual" }), GENERATOR_ACTOR);
    });
    if (ctx.inRange(reversalDate)) {
      ctx.schedule(reversalDate, (ledger) => {
        ledger.reverseEntry(accrualId, reversalDate, GENERATOR_ACTOR, "Auto-reverse quarter-end accrual; actual bill recorded through AP", undefined, { id: reversalId, tags: ["accrual-reversal"] });
      });
    }
    const billDate = addDays(qEnd, 8);
    let cpaBill: Bill | undefined;
    if (ctx.inRange(billDate)) {
      cpaBill = recordBill(ctx, {
        key: `cpa:${month}`,
        vendor: cpa,
        number: `KTA-${year}-Q${quarter}`,
        receivedDate: billDate,
        billDate,
        dueDate: addDays(billDate, 30),
        total: CPA_QUARTERLY_FEE,
        expenseCode: "7200",
        description: `Quarterly bookkeeping review & advisory — Q${quarter} ${year}`,
      });
      payBill(ctx, cpaBill, cpa, `cpa-payment:${month}`, nextBusinessDay(addDays(billDate, 12)), "KESTREL TAX & ADVISORY ACH");
    }
    if (month === accrualCaseMonth) {
      ctx.caseEntity("month_end_accrual", accrualId, reversalId, ...(cpaBill ? [cpaBill.id] : []));
      if (cpaBill) {
        // The same bill arrives again a few days later under a re-issued number.
        const dupDate = addDays(billDate, 5);
        const dup: Bill = {
          id: sid("bill", `cpa:${month}:dup`),
          vendorId: cpa.id,
          number: `KTA-${year}-Q${quarter}-R1`,
          receivedDate: dupDate,
          billDate,
          dueDate: cpaBill.dueDate,
          currency: "USD",
          total: money(CPA_QUARTERLY_FEE),
          amountPaid: money(0),
          status: "DUPLICATE",
          expenseAccountId: acct("7200"),
          description: cpaBill.description,
          paymentIds: [],
          duplicateOfId: cpaBill.id,
        };
        const dupDoc = ctx.addDoc({
          key: `bill:cpa:${month}:dup`,
          kind: "VENDOR_BILL",
          title: `${cpa.name} bill ${dup.number} (re-issued copy)`,
          date: dupDate,
          vendorId: cpa.id,
          amount: CPA_QUARTERLY_FEE,
          storagePath: `synthetic://bills/${dup.number}.pdf`,
          extracted: { billNumber: dup.number, vendor: cpa.name, total: money(CPA_QUARTERLY_FEE), billDate, dueDate: dup.dueDate, description: dup.description, note: "Re-issued copy of an earlier bill" },
          tags: ["ap", "possible-duplicate"],
        });
        dup.documentId = dupDoc.id;
        ctx.ds.bills.push(dup);
        ctx.caseEntity("duplicate_vendor_bill", cpaBill.id, dup.id);
      }
    }
  });
}
