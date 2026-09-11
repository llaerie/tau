/**
 * Accounts receivable tools: aging, payment matching (exact / partial / overpayment), invoice
 * drafting (RECORD_INVOICE) and collection reminder drafting (text only, never sent).
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { addDays, daysBetween } from "@/lib/core/dates";
import { D, abs, eq, gt, lt, money, sub } from "@/lib/core/money";
import type { DecimalString, Invoice } from "@/lib/core/types";
import { arAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, line, moneyFigure, ok, propose, structuredEntry, textFigure } from "./common";

const OPEN: Invoice["status"][] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

export const arAgingTool = defineTool({
  name: "ar_aging",
  description: "Accounts receivable aging by customer and bucket.",
  riskLevel: "GREEN",
  capabilityKey: "ar_collections",
  inputSchema: TASKS["ar.aging"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const calc = arAging(ctx.dataset.invoices, asOf, ctx.dataset.customers);
    const r = calc.value;
    const related = ctx.dataset.customers.filter((c) => c.relatedParty).map((c) => c.id);
    const relatedOpen = r.rows.filter((row) => related.includes(row.counterpartyId));
    return ok({
      answer: `Open receivables as of ${asOf}: ${r.total} across ${r.items.length} invoice(s); ${r.overdueTotal} overdue (${r.overdue.length} invoice(s)). Buckets — current ${r.buckets.CURRENT}, 1-30 ${r.buckets["1-30"]}, 31-60 ${r.buckets["31-60"]}, 61-90 ${r.buckets["61-90"]}, 90+ ${r.buckets["90+"]}.`,
      numbers: [moneyFigure("Total AR", r.total, calc.id), moneyFigure("Overdue", r.overdueTotal), textFigure("Open invoices", r.items.length), textFigure("Overdue invoices", r.overdue.length)],
      why: r.rows.slice(0, 8).map((row) => `${row.counterpartyName}: ${row.total} (overdue ${sub(row.total, row.buckets.CURRENT)})`),
      risks: [...(r.overdue.length ? ["Overdue receivables strain cash; reminders should be drafted for review."] : []), ...(relatedOpen.length ? [`Related-party customer balances open: ${relatedOpen.map((x) => x.counterpartyName).join(", ")} — collection terms must be arm's length and documented for the CPA.`] : [])],
      educationKey: "ar_aging",
      confidence: 0.92,
      structured: { value: r.total, values: { total: r.total, overdue: r.overdueTotal, ...r.buckets }, rows: r.rows, overdue: r.overdue.map((i) => i.id) },
    }, { calcs: [calc] });
  },
});

export const matchPaymentTool = defineTool({
  name: "match_payment",
  description: "Match a received customer payment to open invoices (exact, partial or overpayment) and propose MATCH_PAYMENT.",
  riskLevel: "YELLOW",
  capabilityKey: "receipt_matching",
  inputSchema: TASKS["ar.match_payment"].params,
  async execute(input, ctx) {
    const amount = money(input.paymentAmount);
    if (D(amount).lte(0)) return ok(insufficient(["positive payment amount"], "The payment amount must be positive."));
    const paymentDate = input.paymentDate ?? ctx.asOfDate;
    let candidates = ctx.dataset.invoices.filter((i) => OPEN.includes(i.status) && gt(sub(i.total, i.amountPaid), 0));
    if (input.customerId) candidates = candidates.filter((i) => i.customerId === input.customerId);
    if (input.invoiceId) candidates = candidates.filter((i) => i.id === input.invoiceId);
    if (!candidates.length) return ok(insufficient(["an open invoice to apply the payment to"], `No open invoice${input.customerId ? ` for customer ${input.customerId}` : ""}${input.invoiceId ? ` with id ${input.invoiceId}` : ""}; the payment of ${amount} would be unapplied cash pending review.`));
    const openOf = (i: Invoice) => sub(i.total, i.amountPaid);
    const exact = candidates.find((i) => eq(openOf(i), amount));
    const sorted = [...candidates].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    let matchType: "EXACT" | "PARTIAL" | "OVERPAYMENT" | "MULTI";
    const applications: { invoiceId: string; number: string; amount: DecimalString; remaining: DecimalString }[] = [];
    let unapplied = "0.0000";
    if (exact) {
      matchType = "EXACT";
      applications.push({ invoiceId: exact.id, number: exact.number, amount, remaining: "0.0000" });
    } else if (input.invoiceId || candidates.length === 1) {
      const inv = sorted[0];
      const open = openOf(inv);
      if (lt(amount, open)) {
        matchType = "PARTIAL";
        applications.push({ invoiceId: inv.id, number: inv.number, amount, remaining: sub(open, amount) });
      } else {
        matchType = "OVERPAYMENT";
        applications.push({ invoiceId: inv.id, number: inv.number, amount: open, remaining: "0.0000" });
        unapplied = sub(amount, open);
      }
    } else {
      matchType = "MULTI";
      let left = D(amount);
      for (const inv of sorted) {
        if (left.lte(0)) break;
        const open = D(openOf(inv));
        const applied = left.gte(open) ? open : left;
        applications.push({ invoiceId: inv.id, number: inv.number, amount: applied.toFixed(4), remaining: open.minus(applied).toFixed(4) });
        left = left.minus(applied);
      }
      unapplied = left.gt(0) ? left.toFixed(4) : "0.0000";
      if (left.gt(0)) matchType = "OVERPAYMENT";
    }
    const applied = applications.reduce((acc, a) => acc.plus(D(a.amount)), D(0)).toFixed(4);
    const calc = makeCalc<DecimalString>({ name: "payment_applied", value: applied, unit: "USD", formula: "applied = min(payment, open invoice balances in due-date order); unapplied = payment - applied", inputs: { paymentAmount: amount, paymentDate, matchType, applications }, asOfDate: paymentDate, sourceIds: applications.map((a) => a.invoiceId) });
    const entry = { date: paymentDate, description: `Customer payment ${amount} applied (${matchType.toLowerCase()})`, source: "AR" as const, lines: [line(ACCT.CHECKING, "debit", amount, "Payment received"), line(ACCT.AR, "credit", applied, "Applied to invoices"), ...(D(unapplied).gt(0) ? [line(ACCT.DEFERRED_REVENUE, "credit", unapplied, "Unapplied customer credit (review)")] : [])] };
    const se = structuredEntry(ctx, entry);
    const action = propose(ctx, { kind: "MATCH_PAYMENT", description: `Apply payment ${amount} (${paymentDate}) to ${applications.map((a) => `${a.number} ${a.amount}`).join(", ")}${D(unapplied).gt(0) ? `; ${unapplied} unapplied` : ""}`, reason: `${matchType} match against open invoices.`, amount, targetIds: applications.map((a) => a.invoiceId), payload: { matchType, exactMatch: matchType === "EXACT", applications, unapplied, entry, accountIds: se.accountIds }, context: { isExactMatch: matchType === "EXACT" }, confidence: matchType === "EXACT" ? 0.95 : 0.7 });
    const risks: string[] = [];
    if (matchType === "PARTIAL") risks.push(`Short payment: ${applications[0].remaining} remains open on ${applications[0].number}; confirm whether a dispute or discount explains it.`);
    if (D(unapplied).gt(0)) risks.push(`Overpayment of ${unapplied}: hold as customer credit (not revenue) until the customer confirms refund or application.`);
    if (matchType === "MULTI") risks.push("Payment covers several invoices; applied oldest-due first — confirm with the remittance advice.");
    return ok({
      answer: `${matchType === "EXACT" ? "Exact match" : matchType === "PARTIAL" ? "Partial payment" : matchType === "OVERPAYMENT" ? "Overpayment" : "Multi-invoice application"}: ${amount} received ${paymentDate} applies ${applied} to ${applications.map((a) => `${a.number} (${a.amount})`).join(", ")}${D(unapplied).gt(0) ? ` leaving ${unapplied} unapplied` : ""}.`,
      numbers: [moneyFigure("Payment", amount), moneyFigure("Applied", applied, calc.id), moneyFigure("Unapplied", unapplied), textFigure("Match type", matchType)],
      why: [`Open invoices considered: ${candidates.map((i) => `${i.number} ${openOf(i)}`).join(", ")}.`],
      risks,
      confidence: matchType === "EXACT" ? 0.95 : 0.7,
      structured: { value: applied, values: { payment: amount, applied, unapplied }, matchType, applications, journalEntry: { date: se.date, description: se.description, source: se.source, lines: se.lines, balanced: se.balanced, totalDebits: se.totalDebits, totalCredits: se.totalCredits } },
    }, { calcs: [calc], proposedActions: [action], sourceIds: applications.map((a) => a.invoiceId) });
  },
});

export const createInvoiceTool = defineTool({
  name: "create_invoice_draft",
  description: "Draft a customer invoice and its AR entry (RECORD_INVOICE).",
  riskLevel: "YELLOW",
  capabilityKey: "ar_invoicing",
  inputSchema: TASKS["ar.create_invoice"].params,
  async execute(input, ctx) {
    const customer = ctx.dataset.customers.find((c) => c.id === input.customerId || c.name.toLowerCase() === input.customerId.toLowerCase());
    if (!customer) return ok(insufficient([`customer ${input.customerId}`], `No customer ${input.customerId}; create the customer first.`));
    const amount = money(input.amount);
    if (D(amount).lte(0)) return ok(insufficient(["positive invoice amount"], "Invoice amount must be positive."));
    const issueDate = input.issueDate ?? ctx.asOfDate;
    const dueDate = addDays(issueDate, input.termsDays ?? customer.paymentTermsDays);
    const seq = ctx.dataset.invoices.length + 1;
    const number = `INV-${issueDate.slice(0, 4)}-${String(seq).padStart(4, "0")}`;
    const draft = { number, customerId: customer.id, customerName: customer.name, issueDate, dueDate, total: amount, description: input.description, lines: [{ description: input.description, quantity: "1.0000", unitPrice: amount, amount, revenueAccountId: accountIdForCode(ACCT.SERVICE_REVENUE) }], status: "DRAFT" };
    const entry = { date: issueDate, description: `Invoice ${number} — ${customer.name}: ${input.description}`, source: "AR" as const, lines: [line(ACCT.AR, "debit", amount, `Invoice ${number}`), line(ACCT.SERVICE_REVENUE, "credit", amount, input.description)] };
    const se = structuredEntry(ctx, entry);
    const action = propose(ctx, { kind: "RECORD_INVOICE", description: `Issue invoice ${number} to ${customer.name} for ${amount} due ${dueDate}`, reason: "Invoice drafted from request.", amount, targetIds: [customer.id], payload: { invoice: draft, entry, accountIds: se.accountIds }, context: { involvesRelatedParty: customer.relatedParty } });
    return ok({
      answer: `Drafted invoice ${number} to ${customer.name} for ${amount} (issued ${issueDate}, due ${dueDate}, terms ${input.termsDays ?? customer.paymentTermsDays} days). Recording it books Dr 1100 AR / Cr 4000 Service Revenue.`,
      numbers: [moneyFigure("Invoice total", amount), textFigure("Due date", dueDate)],
      risks: customer.relatedParty ? [`${customer.name} is a related party${customer.relatedPartyNote ? ` (${customer.relatedPartyNote})` : ""}: pricing and terms must be arm's length and documented for the CPA.`] : [],
      confidence: 0.9,
      structured: { value: amount, invoice: draft, journalEntry: { date: se.date, description: se.description, source: se.source, lines: se.lines, balanced: se.balanced, totalDebits: se.totalDebits, totalCredits: se.totalCredits } },
    }, { proposedActions: [action], sourceIds: [customer.id] });
  },
});

export const collectionReminderTool = defineTool({
  name: "collection_reminder_draft",
  description: "Draft (never send) a collection reminder for an overdue invoice; proposes SEND_COLLECTION_REMINDER for review.",
  riskLevel: "YELLOW",
  capabilityKey: "ar_collections",
  inputSchema: TASKS["ar.collection_reminder"].params,
  async execute(input, ctx) {
    const inv = ctx.dataset.invoices.find((i) => i.id === input.invoiceId || i.number === input.invoiceId);
    if (!inv) return ok(insufficient([`invoice ${input.invoiceId}`], `No invoice ${input.invoiceId}.`));
    const customer = ctx.dataset.customers.find((c) => c.id === inv.customerId);
    const open = sub(inv.total, inv.amountPaid);
    const days = daysBetween(inv.dueDate, ctx.asOfDate);
    if (!OPEN.includes(inv.status) || D(open).lte(0)) return ok({ answer: `Invoice ${inv.number} is ${inv.status} with ${open} open; no reminder is needed.`, confidence: 0.9, structured: { value: open, invoiceId: inv.id, status: inv.status } });
    if (days <= 0) return ok({ answer: `Invoice ${inv.number} (${open} open) is not yet due (due ${inv.dueDate}); a reminder now would be premature. I can draft a courtesy notice if you want.`, escalation: esc("APPROVAL_REQUIRED", "Invoice is not overdue; confirm you still want a reminder."), confidence: 0.85, structured: { value: open, invoiceId: inv.id, daysOverdue: days } });
    const tone = days > 60 ? "final" : days > 30 ? "second" : "first";
    const text = `Subject: ${tone === "final" ? "Final notice — " : ""}Invoice ${inv.number} past due\n\nHello ${customer?.name ?? "there"},\n\nOur records show invoice ${inv.number} issued ${inv.issueDate} for ${inv.total} was due on ${inv.dueDate}; ${open} remains open (${days} days past due). If payment has already been sent, thank you — please disregard this note. Otherwise, could you let us know when we can expect payment?\n\nWith thanks,\n${ctx.dataset.profile.displayName}`;
    const action = propose(ctx, { kind: "SEND_COLLECTION_REMINDER", description: `Send ${tone} reminder for invoice ${inv.number} (${open} open, ${days} days overdue)`, reason: "Overdue receivable.", amount: open, targetIds: [inv.id], payload: { invoiceId: inv.id, text, tone }, context: { involvesRelatedParty: customer?.relatedParty } });
    return ok({
      answer: `Drafted a ${tone} reminder for invoice ${inv.number}: ${open} open, ${days} days past due. It will not be sent until approved.`,
      numbers: [moneyFigure("Open balance", open), textFigure("Days overdue", days)],
      risks: customer?.relatedParty ? ["Related-party customer: keep collection communications documented for the CPA."] : [],
      confidence: 0.9,
      educationKey: "ar_aging",
      structured: { value: open, invoiceId: inv.id, daysOverdue: days, tone, reminderText: text },
    }, { proposedActions: [action], sourceIds: [inv.id] });
  },
});

export const arTools = [arAgingTool, matchPaymentTool, createInvoiceTool, collectionReminderTool];
export { abs };
