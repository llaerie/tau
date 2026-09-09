/**
 * Customer invoicing: Harbor Analytics (30,000/month, invoiced on the 1st, net 15, paid by ACH
 * between the 12th and 20th — one month 25 days late) and Meridian Robotics (occasional project
 * invoices, one of which is paid in two instalments).
 */
import { entryForInvoiceIssued, entryForInvoicePayment } from "@/lib/accounting/posting-helpers";
import { addDays, monthEnd, nextBusinessDay, pad2 } from "@/lib/core/dates";
import { add, money } from "@/lib/core/money";
import type { Customer, DecimalString, ISODate, Invoice, Payment, Transaction } from "@/lib/core/types";
import { GENERATOR_ACTOR, acct, sid, type GenContext } from "./context";

export const HARBOR_MONTHLY_FEE = "30000";
export const PARTIAL_INVOICE_TOTAL = "8000";
export const PARTIAL_INVOICE_FIRST_PAYMENT = "5000";

interface InvoiceSpec {
  key: string;
  customer: Customer;
  number: string;
  issueDate: ISODate;
  total: DecimalString;
  description: string;
  revenueCode: string;
  servicePeriod?: [ISODate, ISODate];
}

function issueInvoice(ctx: GenContext, spec: InvoiceSpec): Invoice {
  const invoice: Invoice = {
    id: sid("inv", spec.key),
    number: spec.number,
    customerId: spec.customer.id,
    issueDate: spec.issueDate,
    dueDate: addDays(spec.issueDate, spec.customer.paymentTermsDays),
    servicePeriodStart: spec.servicePeriod?.[0],
    servicePeriodEnd: spec.servicePeriod?.[1],
    currency: "USD",
    total: money(spec.total),
    amountPaid: money(0),
    status: "SENT",
    lines: [{ id: sid("invl", spec.key), description: spec.description, quantity: money(1), unitPrice: money(spec.total), amount: money(spec.total), revenueAccountId: acct(spec.revenueCode) }],
    paymentIds: [],
  };
  const doc = ctx.addDoc({
    key: `invoice:${spec.key}`,
    kind: "CUSTOMER_INVOICE",
    title: `Invoice ${spec.number} — ${spec.customer.name}`,
    date: spec.issueDate,
    customerId: spec.customer.id,
    amount: spec.total,
    storagePath: `synthetic://invoices/${spec.number}.pdf`,
    extracted: { invoiceNumber: spec.number, customer: spec.customer.name, total: money(spec.total), dueDate: invoice.dueDate, description: spec.description },
    tags: ["ar"],
  });
  invoice.documentId = doc.id;
  ctx.ds.invoices.push(invoice);
  const entryId = sid("je", `invoice:${spec.key}`);
  ctx.schedule(spec.issueDate, (ledger) => {
    const entry = ledger.createEntry(entryForInvoiceIssued(invoice, { id: entryId, post: true }), GENERATOR_ACTOR);
    invoice.journalEntryId = entry.id;
    doc.linkedJournalEntryIds.push(entry.id);
  });
  return invoice;
}

function receivePayment(ctx: GenContext, invoice: Invoice, customer: Customer, key: string, date: ISODate, amount: DecimalString, description: string): { payment: Payment; tx: Transaction } | null {
  if (!ctx.inRange(date)) return null;
  const tx = ctx.addTx({
    key: `bank:${key}`,
    source: "checking",
    date,
    amount,
    description,
    merchant: customer.name,
    counterparty: { type: "CUSTOMER", id: customer.id },
    categoryCode: "1100",
    reason: `Customer receipt applied to invoice ${invoice.number}`,
    flags: customer.relatedParty ? ["RELATED_PARTY"] : [],
    meta: { invoiceId: invoice.id },
  });
  const payment: Payment = {
    id: sid("pay", key),
    direction: "IN",
    date,
    amount: money(amount),
    currency: "USD",
    method: "ACH",
    counterpartyRef: { type: "CUSTOMER", id: customer.id },
    applications: [{ targetType: "INVOICE", targetId: invoice.id, amount: money(amount) }],
    transactionId: tx.id,
    memo: `Applied to ${invoice.number}`,
  };
  ctx.ds.payments.push(payment);
  invoice.paymentIds.push(payment.id);
  invoice.amountPaid = add(invoice.amountPaid, amount);
  const entryId = sid("je", `payment:${key}`);
  ctx.schedule(date, (ledger) => {
    const entry = ledger.createEntry(entryForInvoicePayment(invoice, payment, "1000", { id: entryId, post: true }), GENERATOR_ACTOR);
    payment.journalEntryId = entry.id;
    ctx.link(tx, entry);
  });
  return { payment, tx };
}

export function generateInvoicing(ctx: GenContext): void {
  const { harbor, meridian } = ctx.refs.customers;
  const lateMonth = ctx.monthFromEnd(6);

  // --- Harbor Analytics: monthly retainer
  ctx.months.forEach((month) => {
    const issueDate = `${month}-01`;
    if (!ctx.inRange(issueDate)) return;
    const invoice = issueInvoice(ctx, {
      key: `harbor:${month}`,
      customer: harbor,
      number: `NL-${month.replace("-", "")}-H`,
      issueDate,
      total: HARBOR_MONTHLY_FEE,
      description: `AI services retainer — ${month}`,
      revenueCode: "4000",
      servicePeriod: [issueDate, monthEnd(issueDate)],
    });
    const isLate = month === lateMonth;
    const payDate = isLate ? nextBusinessDay(addDays(invoice.dueDate, 25)) : nextBusinessDay(`${month}-${pad2(ctx.rng.int(12, 20))}`);
    const result = receivePayment(ctx, invoice, harbor, `harbor-receipt:${month}`, payDate, HARBOR_MONTHLY_FEE, `ACH CREDIT HARBOR ANALYTICS GRP ${invoice.number}`);
    if (result) {
      ctx.caseTx("related_party_customer", result.tx);
      if (isLate) {
        ctx.caseTx("late_customer_payment", result.tx);
        ctx.caseEntity("late_customer_payment", invoice.id, result.payment.id);
      }
    }
  });
  ctx.caseEntity("related_party_customer", harbor.id);

  // --- Meridian Robotics: project invoices every ~3 months (offsets from the start of the timeline).
  const partialOffset = ctx.months.length - 1 - 4; // four months before the current month
  const offsets = [2, 5, 8, 11, 14].filter((o) => o < ctx.months.length);
  if (!offsets.includes(partialOffset)) offsets.push(partialOffset);
  for (const offset of [...new Set(offsets)].sort((a, b) => a - b)) {
    const month = ctx.months[offset];
    const issueDate = nextBusinessDay(`${month}-${pad2(ctx.rng.int(5, 15))}`);
    const isPartial = offset === partialOffset;
    const total = isPartial ? PARTIAL_INVOICE_TOTAL : money(ctx.rng.int(80, 180) * 50);
    if (!ctx.inRange(issueDate)) continue;
    const invoice = issueInvoice(ctx, {
      key: `meridian:${month}`,
      customer: meridian,
      number: `NL-${month.replace("-", "")}-M`,
      issueDate,
      total,
      description: isPartial ? "Model evaluation pipeline — fixed-fee project" : `Consulting project — ${month}`,
      revenueCode: "4100",
    });
    if (isPartial) {
      const first = receivePayment(ctx, invoice, meridian, `meridian-receipt:${month}:1`, nextBusinessDay(addDays(issueDate, 27)), PARTIAL_INVOICE_FIRST_PAYMENT, `ACH CREDIT MERIDIAN ROBOTICS ${invoice.number} PART 1`);
      const second = receivePayment(ctx, invoice, meridian, `meridian-receipt:${month}:2`, nextBusinessDay(addDays(issueDate, 69)), money(Number(PARTIAL_INVOICE_TOTAL) - Number(PARTIAL_INVOICE_FIRST_PAYMENT)), `ACH CREDIT MERIDIAN ROBOTICS ${invoice.number} BALANCE`);
      ctx.caseEntity("partial_invoice_payment", invoice.id);
      for (const r of [first, second]) {
        if (r) {
          ctx.caseTx("partial_invoice_payment", r.tx);
          ctx.caseEntity("partial_invoice_payment", r.payment.id);
        }
      }
    } else {
      const payDate = nextBusinessDay(addDays(invoice.dueDate, ctx.rng.int(-3, 5)));
      receivePayment(ctx, invoice, meridian, `meridian-receipt:${month}`, payDate, total, `ACH CREDIT MERIDIAN ROBOTICS ${invoice.number}`);
    }
  }
}

/** Derive invoice statuses from amounts paid as of the dataset's asOf date. */
export function finalizeInvoiceStatuses(ctx: GenContext): void {
  for (const inv of ctx.ds.invoices) {
    if (money(inv.amountPaid) === money(inv.total)) inv.status = "PAID";
    else if (Number(inv.amountPaid) > 0) inv.status = "PARTIALLY_PAID";
    else if (inv.dueDate < ctx.asOf) inv.status = "OVERDUE";
    else inv.status = "SENT";
  }
}
