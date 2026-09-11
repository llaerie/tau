/** Accounts payable agent. */
import type { RouteRule } from "../intent";
import { apAgingTool, billIntakeTool, payBillTool, schedulePaymentTool, vendorCreateTool } from "../tools/ap-tools";
import { Specialist, guessExpenseCode, nameAfter } from "./shared";

const rules: RouteRule[] = [
  { kind: "ap.pay_bill", weight: 3.2, any: [/\bpay\b[^.?!]{0,40}\b(bill|vendor|invoice|them|it)\b/i, /\bpay (the |our )?[A-Z][\w&]+\b/, /\b(wire|send|release) (the |a )?(payment|money|funds)\b/i, /\bsettle (the )?(bill|invoice)\b/i, /\bpay .* now\b/i, /\bmake (a |the )?payment\b/i], none: [/\bschedule\b/i, /\bwhen should\b/i, /\bpayroll\b/i, /\bmyself\b/i, /\bdistribution\b/i], params: (m, e, _asOf) => ({ billId: e.ids.find((i) => i.startsWith("bill_")), vendorName: nameAfter(m, /(?:pay|to)/) ?? m, amount: e.amounts[0] }) },
  { kind: "ap.vendor_create", weight: 3, any: [/\b(create|add|set up|new|onboard)\b[^.?!]{0,20}\bvendor\b/i, /\bvendor record\b/i], params: (m, e, _asOf) => ({ name: nameAfter(m, /(?:vendor|for|called|named)/) ?? m, country: /\b(uk|canada|china|india|germany|eu)\b/i.exec(m)?.[1]?.toUpperCase(), defaultAccountCode: guessExpenseCode(m, e.accountCodes) }) },
  { kind: "ap.bill_intake", weight: 3, any: [/\b(record|enter|add|log|book|received|got|intake)\b[^.?!]{0,30}\b(bill|vendor invoice|invoice from)\b/i, /\bbill from\b/i, /\binvoice from\b/i, /\bnew bill\b/i], none: [/\bpay\b(?! ?terms)/i], params: (m, e, asOf) => ({ vendorName: nameAfter(m, /from/) ?? m, amount: e.amounts[0], billNumber: /\b(?:#|no\.?|number|invoice)\s*([A-Z]{0,4}-?\d[\w-]*)/i.exec(m)?.[1], billDate: e.dates[0] ?? asOf, dueDate: e.dates[1], description: m, expenseAccountCode: guessExpenseCode(m, e.accountCodes) }) },
  { kind: "ap.schedule_payment", weight: 2.8, any: [/\bpayment (schedule|plan|run)\b/i, /\bschedule (the |our )?(payments?|bills?)\b/i, /\bwhen should (we|i) pay\b/i, /\bwhich bills? (should|to) pay\b/i, /\bprioriti[sz]e (the |our )?(bills|payments)\b/i, /\bcan we afford to pay\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], availableCash: e.amounts[0] }) },
  { kind: "ap.aging", weight: 2.5, any: [/\b(ap|a\/p|payables?|accounts payable)\b[^.?!]{0,20}\b(aging|report|outstanding|balance|overdue)\b/i, /\baging\b[^.?!]{0,10}\b(ap|payables?)\b/i, /\bwhich bills?\b/i, /\bbills? (are )?(due|overdue|outstanding|open|unpaid|coming)\b/i, /\bwhat do we owe\b/i, /\bwho do we owe\b/i, /\bopen bills\b/i, /\bupcoming bills\b/i, /\bvendor balances\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
];

export function createApAgent(): Specialist {
  return new Specialist({
    name: "ap",
    description: "Accounts payable: AP aging, bill intake with duplicate checks, payment scheduling recommendations, vendor records; payments are never executed.",
    keywords: [/\bbill/i, /\bvendor/i, /\bpayable/i, /\bap\b/i, /\bowe\b/i, /\bpay\b/i, /\bsupplier/i, /\bdue\b/i],
    rules,
    tools: [
      [apAgingTool, "ap.aging"],
      [billIntakeTool, "ap.bill_intake"],
      [schedulePaymentTool, "ap.schedule_payment"],
      [payBillTool, "ap.pay_bill"],
      [vendorCreateTool, "ap.vendor_create"],
    ],
  });
}
