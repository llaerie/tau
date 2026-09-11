/**
 * Accounts payable tools: aging, bill intake with duplicate detection, payment schedule
 * recommendation (no money moves), pay-bill (EXECUTE_PAYMENT — RED, blocked in Phase One) and
 * vendor creation (YELLOW).
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { addDays, daysBetween } from "@/lib/core/dates";
import { D, abs, eq, money, sub } from "@/lib/core/money";
import type { Bill, DecimalString, Vendor } from "@/lib/core/types";
import { apAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { normalizeMerchant } from "../classification";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, line, moneyFigure, ok, propose, structuredEntry, textFigure, toDec } from "./common";
import { ledgerCash } from "./treasury-tools";

export function findVendorByName(vendors: Vendor[], name: string): Vendor | undefined {
  const n = normalizeMerchant(name);
  return vendors.find((v) => normalizeMerchant(v.name) === n) ?? vendors.find((v) => [v.name, ...v.normalizedNames].some((a) => normalizeMerchant(a) === n || (n.length >= 4 && normalizeMerchant(a).includes(n)) || (normalizeMerchant(a).length >= 4 && n.includes(normalizeMerchant(a)))));
}

export const apAgingTool = defineTool({
  name: "ap_aging",
  description: "Accounts payable aging by vendor and bucket.",
  riskLevel: "GREEN",
  capabilityKey: "ap_bill_intake",
  inputSchema: TASKS["ap.aging"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const calc = apAging(ctx.dataset.bills, asOf, ctx.dataset.vendors);
    const r = calc.value;
    return ok({
      answer: `Open payables as of ${asOf}: ${r.total} across ${r.items.length} bill(s); ${r.overdueTotal} overdue (${r.overdue.length} bill(s)). Buckets — current ${r.buckets.CURRENT}, 1-30 ${r.buckets["1-30"]}, 31-60 ${r.buckets["31-60"]}, 61-90 ${r.buckets["61-90"]}, 90+ ${r.buckets["90+"]}.`,
      numbers: [moneyFigure("Total AP", r.total, calc.id), moneyFigure("Overdue", r.overdueTotal), textFigure("Open bills", r.items.length), textFigure("Overdue bills", r.overdue.length)],
      why: r.rows.slice(0, 8).map((row) => `${row.counterpartyName}: ${row.total} (overdue ${sub(row.total, row.buckets.CURRENT)})`),
      risks: r.overdue.length ? ["Overdue bills risk late fees and vendor relationships; nothing is paid without approval."] : [],
      confidence: 0.92,
      structured: { value: r.total, values: { total: r.total, overdue: r.overdueTotal, ...r.buckets }, rows: r.rows, overdue: r.overdue.map((i) => i.id) },
    }, { calcs: [calc] });
  },
});

export function findDuplicateBills(bills: Bill[], vendorId: string | undefined, amount: DecimalString, billNumber: string | undefined, billDate: string): Bill[] {
  return bills.filter((b) => b.status !== "VOID" && (vendorId ? b.vendorId === vendorId : true) && eq(b.total, amount) && ((billNumber && b.number.toLowerCase() === billNumber.toLowerCase()) || Math.abs(daysBetween(b.billDate, billDate)) <= 14));
}

export const billIntakeTool = defineTool({
  name: "bill_intake",
  description: "Record a vendor bill (RECORD_BILL) with duplicate detection by vendor + amount + number/date window.",
  riskLevel: "YELLOW",
  capabilityKey: "ap_bill_intake",
  inputSchema: TASKS["ap.bill_intake"].params,
  async execute(input, ctx) {
    const amount = money(input.amount);
    if (D(amount).lte(0)) return ok(insufficient(["positive bill amount"], "A bill amount must be positive."));
    const vendor = findVendorByName(ctx.dataset.vendors, input.vendorName);
    const dupes = findDuplicateBills(ctx.dataset.bills, vendor?.id, amount, input.billNumber, input.billDate);
    const expenseCode = input.expenseAccountCode ?? (vendor?.defaultAccountId ? ctx.ledger.getAccount(vendor.defaultAccountId)?.code : undefined) ?? ACCT.SUSPENSE;
    if (!ctx.ledger.getAccount(expenseCode)) return ok(insufficient([`expense account ${expenseCode}`], `Unknown expense account ${expenseCode}.`));
    const dueDate = input.dueDate ?? addDays(input.billDate, vendor?.paymentTermsDays ?? 30);
    const entry = { date: input.billDate, description: `Bill ${input.billNumber ?? "(no number)"} — ${input.vendorName}: ${input.description ?? ""}`.trim(), source: "AP" as const, lines: [line(expenseCode, "debit", amount, input.description), line(ACCT.AP, "credit", amount, `Bill ${input.billNumber ?? ""}`)] };
    const se = structuredEntry(ctx, entry);
    const bill = { vendorId: vendor?.id ?? null, vendorName: input.vendorName, number: input.billNumber ?? null, billDate: input.billDate, dueDate, total: amount, expenseAccountCode: expenseCode, description: input.description ?? "" };
    if (dupes.length) {
      return ok({
        answer: `This looks like a duplicate: ${dupes.map((d) => `bill ${d.number} dated ${d.billDate} for ${d.total} (${d.status})`).join("; ")} already exists for ${vendor?.name ?? input.vendorName}. I have not recorded it.`,
        escalation: esc("APPROVAL_REQUIRED", `Possible duplicate of ${dupes.map((d) => d.id).join(", ")}; a human must confirm it is a distinct bill.`, { requiredRole: "FINANCE_OPERATOR" }),
        risks: ["Recording a duplicate bill would overstate payables and could lead to a double payment."],
        recommendation: "Compare invoice numbers and service periods with the existing bill; if distinct, resubmit with the bill number.",
        confidence: 0.85,
        structured: { value: amount, duplicate: true, duplicateOf: dupes.map((d) => d.id), bill, journalEntry: { ...se, lines: se.lines } },
      }, { sourceIds: dupes.map((d) => d.id) });
    }
    const action = propose(ctx, {
      kind: "RECORD_BILL",
      description: `Record bill ${input.billNumber ?? "(no number)"} from ${vendor?.name ?? input.vendorName}: ${amount} due ${dueDate}`,
      reason: vendor ? `Known vendor ${vendor.name}; expense ${expenseCode}.` : `New vendor "${input.vendorName}" — vendor record must be created first.`,
      amount,
      targetIds: vendor ? [vendor.id] : [],
      payload: { bill, entry, isNewCounterparty: !vendor, accountIds: se.accountIds },
      context: { isNewVendor: !vendor, isNonStandard: expenseCode === ACCT.SUSPENSE },
      confidence: vendor ? 0.9 : 0.6,
    });
    const risks: string[] = [];
    if (!vendor) risks.push(`"${input.vendorName}" is not a known vendor; a CREATE_VENDOR (YELLOW) step is needed and W-9 status is unknown.`);
    if (expenseCode === ACCT.SUSPENSE) risks.push("No expense account given; suspense 9999 used until categorized.");
    if (vendor?.taxDocStatus === "UNKNOWN" || vendor?.taxDocStatus === "REQUESTED") risks.push(`Vendor tax documentation status is ${vendor.taxDocStatus}; confirm before year-end information returns.`);
    return ok({
      answer: `Bill from ${vendor?.name ?? input.vendorName} for ${amount} dated ${input.billDate}, due ${dueDate}, coded to ${expenseCode}: no duplicate found; proposed as RECORD_BILL (Dr ${expenseCode} / Cr 2000 Accounts Payable).`,
      numbers: [moneyFigure("Bill amount", amount), textFigure("Due date", dueDate), textFigure("Vendor", vendor?.name ?? `${input.vendorName} (NEW)`), textFigure("Duplicate check", "clear")],
      why: [`Checked ${ctx.dataset.bills.length} existing bill(s) for the same vendor and amount within 14 days or with the same number.`],
      risks,
      confidence: vendor ? 0.9 : 0.65,
      structured: { value: amount, duplicate: false, bill, journalEntry: { date: se.date, description: se.description, source: se.source, lines: se.lines, balanced: se.balanced, totalDebits: se.totalDebits, totalCredits: se.totalCredits } },
    }, { proposedActions: [action], sourceIds: vendor ? [vendor.id] : [] });
  },
});

export const schedulePaymentTool = defineTool({
  name: "schedule_payment_recommendation",
  description: "Recommend a payment schedule for open bills against available cash (recommendation only; no money moves).",
  riskLevel: "GREEN",
  capabilityKey: "ap_payment_scheduling",
  inputSchema: TASKS["ap.schedule_payment"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const cash = toDec(input.availableCash) ?? ledgerCash(ctx, asOf).total;
    const open = ctx.dataset.bills.filter((b) => ["RECEIVED", "APPROVED", "SCHEDULED"].includes(b.status) && D(sub(b.total, b.amountPaid)).gt(0)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (!open.length) return ok({ answer: "There are no open bills to schedule.", confidence: 0.95, structured: { value: "0.0000", schedule: [] } });
    const vendorName = new Map(ctx.dataset.vendors.map((v) => [v.id, v.name]));
    let running = D(cash);
    const reserve = ctx.thresholds.minimumCashReserve;
    const schedule = open.map((b) => {
      const openAmt = sub(b.total, b.amountPaid);
      running = running.minus(D(openAmt));
      const overdue = b.dueDate < asOf;
      const belowReserve = reserve !== null && running.lt(D(reserve));
      return { billId: b.id, vendor: vendorName.get(b.vendorId) ?? b.vendorId, number: b.number, amount: openAmt, dueDate: b.dueDate, recommendedPayDate: overdue ? asOf : b.dueDate, status: b.status, overdue, cashAfter: running.toFixed(4), belowReserve, approved: b.status === "APPROVED" || b.status === "SCHEDULED" };
    });
    const total = schedule.reduce((acc, s) => acc.plus(D(s.amount)), D(0)).toFixed(4);
    const calc = makeCalc<DecimalString>({ name: "scheduled_payments_total", value: total, unit: "USD", formula: "sum(open bill balances) ordered by due date; cash_after = available_cash - cumulative", inputs: { asOf, availableCash: cash, bills: schedule.map((s) => ({ billId: s.billId, amount: s.amount, dueDate: s.dueDate })) }, asOfDate: asOf, sourceIds: open.map((b) => b.id) });
    const unapproved = schedule.filter((s) => !s.approved);
    const risks: string[] = [];
    if (running.lt(0)) risks.push(`Paying everything on schedule would take cash to ${running.toFixed(4)}.`);
    if (schedule.some((s) => s.belowReserve)) risks.push("Some payments would push cash below the minimum reserve.");
    if (unapproved.length) risks.push(`${unapproved.length} bill(s) are not yet APPROVED and must be approved before scheduling.`);
    return ok({
      answer: `${open.length} open bill(s) totaling ${total}; available cash ${cash}. Recommended order is by due date: ${schedule.slice(0, 5).map((s) => `${s.vendor} ${s.amount} on ${s.recommendedPayDate}${s.overdue ? " (overdue)" : ""}`).join("; ")}. Cash after all payments: ${running.toFixed(4)}. No money moves — this is a recommendation.`,
      numbers: [moneyFigure("Open bills", total, calc.id), moneyFigure("Available cash", cash), moneyFigure("Cash after schedule", running.toFixed(4)), textFigure("Overdue bills", schedule.filter((s) => s.overdue).length)],
      why: ["Bills are ordered by due date; overdue bills are recommended for immediate payment once approved.", reserve === null ? "Minimum cash reserve is unknown, so reserve breaches cannot be checked." : `Minimum reserve ${reserve} is checked after each payment.`],
      risks,
      recommendation: "Approve the bills you intend to pay; payments are executed by a human through the bank.",
      confidence: 0.85,
      structured: { value: total, values: { openBills: total, availableCash: cash, cashAfter: running.toFixed(4) }, schedule },
    }, { calcs: [calc] });
  },
});

export const payBillTool = defineTool({
  name: "pay_bill",
  description: "Request to pay a bill: always proposes EXECUTE_PAYMENT (RED), which is blocked in Phase One; returns the prepared payment package.",
  riskLevel: "RED",
  capabilityKey: "payment_execution",
  inputSchema: TASKS["ap.pay_bill"].params,
  async execute(input, ctx) {
    const explicitBill = input.billId ? ctx.dataset.bills.find((b) => b.id === input.billId) : undefined;
    const vendor = explicitBill ? ctx.dataset.vendors.find((v) => v.id === explicitBill.vendorId) : input.vendorName ? findVendorByName(ctx.dataset.vendors, input.vendorName) : undefined;
    let bill = explicitBill;
    if (!bill && vendor) bill = ctx.dataset.bills.filter((b) => b.vendorId === vendor.id && ["RECEIVED", "APPROVED", "SCHEDULED"].includes(b.status) && D(sub(b.total, b.amountPaid)).gt(0)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    const amount = bill ? sub(bill.total, bill.amountPaid) : toDec(input.amount);
    if (input.billId && !bill) return ok(insufficient([`bill ${input.billId}`], `No bill ${input.billId} exists.`));
    if (amount === null) return ok(insufficient(["bill id or amount"], `Tell me which bill (id) or the amount and vendor${vendor ? ` — ${vendor.name} has no open bills` : ""}. No payment was made.`, { structured: { riskLevel: "RED", actionsExecuted: 0 } }));
    const pkg = { billId: bill?.id ?? null, billNumber: bill?.number ?? null, vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? input.vendorName ?? null, amount, dueDate: bill?.dueDate ?? null, billStatus: bill?.status ?? null, cashBefore: ledgerCash(ctx, ctx.asOfDate).total, vendorTaxDocStatus: vendor?.taxDocStatus ?? null };
    const action = propose(ctx, { kind: "EXECUTE_PAYMENT", description: `Pay ${vendor?.name ?? input.vendorName ?? "vendor"} ${amount}${bill ? ` for bill ${bill.number}` : ""}`, reason: "Payment requested.", amount, targetIds: bill ? [bill.id] : [], payload: { package: pkg }, context: { movesMoney: true, isNewVendor: !vendor }, reversible: false });
    const cashAfter = sub(pkg.cashBefore, amount);
    return ok({
      answer: `I can't execute payments — moving money is prohibited in Phase One and always requires an approved RED request. Here is the prepared payment package instead: ${vendor?.name ?? input.vendorName ?? "vendor"} ${amount}${bill ? ` for bill ${bill.number} due ${bill.dueDate} (status ${bill.status})` : ""}; cash before ${pkg.cashBefore}, after ${cashAfter}.`,
      escalation: esc("REFUSED_CONTROL_VIOLATION", "EXECUTE_PAYMENT cannot execute in Phase One (simulation only); the prepared package is returned for a human to pay through the bank after approval.", { requiredRole: "OWNER" }),
      numbers: [moneyFigure("Payment amount", amount), moneyFigure("Cash before", pkg.cashBefore), moneyFigure("Cash after", cashAfter)],
      why: ["Payments are RED actions: owner approval plus human execution through the bank; the system only prepares the package."],
      risks: [...(bill && bill.status !== "APPROVED" && bill.status !== "SCHEDULED" ? [`Bill status is ${bill.status}; approve it first.`] : []), ...(vendor?.taxDocStatus === "UNKNOWN" ? ["Vendor tax documentation status is UNKNOWN."] : [])],
      recommendation: "Approve the bill and have an authorized person release the payment from the bank; I will match the outflow when it appears.",
      confidence: 0.95,
      structured: { value: amount, riskLevel: "RED", paymentPackage: pkg, actionsExecuted: 0 },
    }, { proposedActions: [action], sourceIds: bill ? [bill.id] : [] });
  },
});

export const vendorCreateTool = defineTool({
  name: "vendor_create",
  description: "Create a vendor record (CREATE_VENDOR, YELLOW).",
  riskLevel: "YELLOW",
  capabilityKey: "ap_bill_intake",
  inputSchema: TASKS["ap.vendor_create"].params,
  async execute(input, ctx) {
    const existing = findVendorByName(ctx.dataset.vendors, input.name);
    if (existing) return ok({ answer: `Vendor "${existing.name}" already exists (${existing.id}); no new record is needed.`, confidence: 0.9, structured: { value: null, vendorId: existing.id, existing: true } }, { sourceIds: [existing.id] });
    const code = input.defaultAccountCode;
    if (code && !ctx.ledger.getAccount(code)) return ok(insufficient([`account ${code}`], `Unknown default account ${code}.`));
    const draft = { name: input.name, normalizedNames: [normalizeMerchant(input.name)], defaultAccountId: code ? accountIdForCode(code) : undefined, country: input.country ?? "US", taxDocStatus: "UNKNOWN" as const, isRecurring: false, active: true };
    const action = propose(ctx, { kind: "CREATE_VENDOR", description: `Create vendor ${input.name} (${draft.country})${code ? ` default account ${code}` : ""}`, reason: "New vendor requested.", payload: { vendor: draft }, context: { isNewVendor: true } });
    return ok({
      answer: `Prepared vendor record for "${input.name}" (${draft.country}${code ? `, default account ${code}` : ""}). Creating a vendor is a YELLOW action; tax documentation status starts as UNKNOWN until a W-9/W-8 is on file.`,
      risks: [draft.country !== "US" ? "Non-US vendor: withholding and documentation questions are for the CPA." : "Request a W-9 before the first payment so information-return decisions are not blocked."],
      confidence: 0.9,
      structured: { value: null, vendor: draft },
    }, { proposedActions: [action] });
  },
});

export const apTools = [apAgingTool, billIntakeTool, schedulePaymentTool, payBillTool, vendorCreateTool];
export { abs };
